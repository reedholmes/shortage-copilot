/**
 * EVAL RUNNER
 * ===========
 * Runs every shortage scenario in /evals/scenarios through the engine and the approval
 * routing, then scores each expected outcome. Used by `npm run evals` and the Evals screen.
 *
 * Each scenario is a small hand-built shortage with an answer worked out by hand from the
 * customer's rules. The expected answers are written down BEFORE looking at engine output,
 * so a pass means the engine agrees with the rule book, not with itself.
 */
import { planSku } from '../engine/allocation'
import { routeApprovals } from '../engine/approvals'
import { getCustomer, settingsFromConfig } from '../engine/customerConfig'
import type { Plan, World } from '../engine/types'

export interface ScenarioMarket {
  id: string
  /** Markets that share a distributor can transfer stock. Defaults to its own distributor. */
  distributor?: string
  priority?: 'National account' | 'Key distributor'
  casesPerDay: number
  daysOnHand: number
  /** Raw on-hand cases, to inject bad data. Overrides daysOnHand. */
  onHandCases?: number
  ordered: number
}

export type Check =
  | { market: string; ship: number; tolerance?: number }
  | { market: string; rule: string }
  | { market: string; needsApproval: boolean }
  | { transfer: { from: string; to: string; qty: number } }
  | { transferCount: number }
  | { summary: 'marketsAtRiskAfter' | 'unallocated' | 'overAllocated' | 'totalShipped'; equals: number }

export interface Scenario {
  id: string
  title: string
  category: 'Core rule' | 'Customer rules' | 'Edge case'
  story: string
  customer: string
  event: { supplyCases: number; runInWeeks: number }
  markets: ScenarioMarket[]
  expect: Check[]
}

export interface CheckResult {
  label: string
  expected: string
  actual: string
  passed: boolean
}

export interface ScenarioResult {
  id: string
  title: string
  category: Scenario['category']
  customer: string
  story: string
  passed: boolean
  checks: CheckResult[]
  /** Set when the scenario couldn't run at all (bad file, engine crash). */
  error?: string
}

export interface Scorecard {
  ranAt: string
  scenarios: ScenarioResult[]
  scenariosPassed: number
  checksPassed: number
  checksTotal: number
  /** Share of all expected outcomes the engine got right. */
  accuracy: number
}

const WEEKS = 13

/** Turn a scenario into a one-SKU world. Three bigger filler SKUs keep the test SKU out of the
 *  top-quartile velocity band, so its buffer is just the customer's minimum (easy to check by hand). */
export function scenarioWorld(s: Scenario): World {
  const w: World = { asOf: '2026-11-16', horizonWeeks: WEEKS, skus: [], distributors: [], markets: [], positions: [], scenarios: [] }
  w.skus.push({ id: 'EVAL', name: s.title, category: 'Eval', availableNow: s.event.supplyCases, nextRun: { inWeeks: s.event.runInWeeks, qty: 1000 } })
  for (const m of s.markets) {
    const distId = m.distributor ?? `D-${m.id}`
    if (!w.distributors.find((d) => d.id === distId)) w.distributors.push({ id: distId, name: distId })
    w.markets.push({ id: m.id, distributorId: distId, state: m.id })
    const weekly = Array(WEEKS).fill(m.casesPerDay * 7)
    w.positions.push({
      skuId: 'EVAL',
      marketId: m.id,
      onHand: m.onHandCases ?? m.casesPerDay * m.daysOnHand,
      inTransit: [],
      shipFcst: weekly,
      depFcst: weekly,
      openOrders: m.ordered ? [{ id: `PO-${m.id}`, qty: m.ordered, requestedWeek: 0 }] : [],
    })
  }
  for (let k = 0; k < 3; k++) {
    w.skus.push({ id: `FILL${k}`, name: 'Filler', category: 'Eval', availableNow: 0, nextRun: { inWeeks: 4, qty: 0 } })
    w.positions.push({
      skuId: `FILL${k}`, marketId: s.markets[0].id, onHand: 0, inTransit: [],
      shipFcst: Array(WEEKS).fill(1e5), depFcst: Array(WEEKS).fill(1e5), openOrders: [],
    })
  }
  return w
}

function score(check: Check, plan: Plan, queued: Set<string>): CheckResult {
  const line = (id: string) => {
    const l = plan.lines.find((x) => x.marketId === id)
    if (!l) throw new Error(`No market "${id}" in the scenario`)
    return l
  }
  if ('ship' in check) {
    const actual = line(check.market).ship
    const tol = check.tolerance ?? 0
    return {
      label: `${check.market} ships`,
      expected: tol ? `${check.ship} cs (±${tol})` : `${check.ship} cs`,
      actual: `${actual} cs`,
      passed: Math.abs(actual - check.ship) <= tol,
    }
  }
  if ('rule' in check) {
    const actual = line(check.market).rule
    return { label: `${check.market} decided by`, expected: check.rule, actual, passed: actual === check.rule }
  }
  if ('needsApproval' in check) {
    const actual = queued.has(check.market)
    const show = (b: boolean) => (b ? 'approval queue' : 'auto-execute')
    return { label: `${check.market} routed to`, expected: show(check.needsApproval), actual: show(actual), passed: actual === check.needsApproval }
  }
  if ('transfer' in check) {
    const { from, to, qty } = check.transfer
    const t = plan.transfers.find((x) => x.fromMarketId === from && x.toMarketId === to)
    return { label: `Transfer ${from} to ${to}`, expected: `${qty} cs`, actual: t ? `${t.qty} cs` : 'none', passed: t?.qty === qty }
  }
  if ('transferCount' in check) {
    const actual = plan.transfers.length
    return { label: 'Transfers suggested', expected: String(check.transferCount), actual: String(actual), passed: actual === check.transferCount }
  }
  const actual =
    check.summary === 'totalShipped'
      ? plan.lines.reduce((a, l) => a + l.ship, 0)
      : check.summary === 'marketsAtRiskAfter'
        ? plan.summary.marketsAtRiskAfter
        : plan[check.summary]
  const LABEL = { marketsAtRiskAfter: 'Markets out before the run', unallocated: 'Cases left unallocated', overAllocated: 'Cases over-allocated', totalShipped: 'Total cases shipped' }
  return { label: LABEL[check.summary], expected: String(check.equals), actual: String(actual), passed: actual === check.equals }
}

export function runScenario(s: Scenario): ScenarioResult {
  const base = { id: s.id, title: s.title, category: s.category, customer: s.customer, story: s.story }
  try {
    const config = getCustomer(s.customer)
    // Customer rules come from the config. Which test distributors are priority accounts is
    // part of the scenario, since these are made-up markets.
    const priorityAccounts = Object.fromEntries(
      s.markets.filter((m) => m.priority).map((m) => [m.distributor ?? `D-${m.id}`, m.priority!]),
    )
    const plan = planSku(scenarioWorld(s), 'EVAL', { ...settingsFromConfig(config), priorityAccounts })
    const routing = routeApprovals(plan, config)
    const queued = new Set(routing.queue.filter((q) => q.kind === 'line').map((q) => q.id))
    const checks = s.expect.map((c) => {
      try {
        return score(c, plan, queued)
      } catch (e) {
        return { label: 'Check', expected: JSON.stringify(c), actual: e instanceof Error ? e.message : 'error', passed: false }
      }
    })
    return { ...base, checks, passed: checks.every((c) => c.passed) }
  } catch (e) {
    return { ...base, checks: [], passed: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function runAll(scenarios: Scenario[]): Scorecard {
  const results = scenarios.map(runScenario)
  const all = results.flatMap((r) => r.checks)
  const checksTotal = all.length + results.filter((r) => r.error).length
  const checksPassed = all.filter((c) => c.passed).length
  return {
    ranAt: new Date().toISOString(),
    scenarios: results,
    scenariosPassed: results.filter((r) => r.passed).length,
    checksPassed,
    checksTotal,
    accuracy: checksTotal ? checksPassed / checksTotal : 0,
  }
}
