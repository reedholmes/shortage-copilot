/**
 * Tests for customer configs: the loader rejects bad files, each config-driven rule
 * behaves as written, and the two shipped customers really get different plans.
 * Run with:  npm test
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import acmeJson from '../../config/customer_acme_beverage.json'
import { DEFAULT_SETTINGS, planSku } from './allocation'
import { CUSTOMERS, loadConfig, settingsFromConfig } from './customerConfig'
import type { PriorityType, Settings, World } from './types'

const WEEKS = 13
interface Spec { id: string; dist?: string; priority?: PriorityType; rate: number; doh: number; order: number }

/** One-SKU world with flat demand, plus filler SKUs so velocity extras don't kick in. */
function world(specs: Spec[], availableNow: number, runInWeeks = 4): World {
  const w: World = { asOf: '2026-11-16', horizonWeeks: WEEKS, skus: [], distributors: [], markets: [], positions: [], scenarios: [] }
  w.skus.push({ id: 'A', name: 'Test', category: 'Test', availableNow, nextRun: { inWeeks: runInWeeks, qty: 1000 } })
  for (const s of specs) {
    const distId = s.dist ?? `D-${s.id}`
    if (!w.distributors.find((d) => d.id === distId)) w.distributors.push({ id: distId, name: distId, priority: s.priority ?? null })
    w.markets.push({ id: s.id, distributorId: distId, state: s.id })
    const weekly = Array(WEEKS).fill(s.rate * 7)
    w.positions.push({
      skuId: 'A', marketId: s.id, onHand: s.rate * s.doh, inTransit: [], shipFcst: weekly, depFcst: weekly,
      openOrders: s.order ? [{ id: `PO-${s.id}`, qty: s.order, requestedWeek: 0 }] : [],
    })
  }
  for (let k = 0; k < 4; k++) {
    w.skus.push({ id: `F${k}`, name: 'Filler', category: 'Test', availableNow: 0, nextRun: { inWeeks: 4, qty: 0 } })
    w.positions.push({
      skuId: `F${k}`, marketId: specs[0].id, onHand: 0, inTransit: [],
      shipFcst: Array(WEEKS).fill(1e5), depFcst: Array(WEEKS).fill(1e5), openOrders: [],
    })
  }
  return w
}
const line = (plan: ReturnType<typeof planSku>, id: string) => plan.lines.find((l) => l.marketId === id)!
const withRules = (r: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...r })

describe('Loading customer configs', () => {
  it('loads both shipped customers', () => {
    expect(CUSTOMERS.map((c) => c.customer.id)).toEqual(['acme_beverage', 'bluestone_spirits'])
  })

  it("Acme's config is the same rule set the engine was built and tested on", () => {
    const { priorityAccounts, ...acme } = settingsFromConfig(CUSTOMERS[0])
    expect(acme).toEqual(DEFAULT_SETTINGS)
    expect(Object.keys(priorityAccounts!)).toEqual(['D01', 'D02', 'D03', 'D04'])
  })

  const bad = (mutate: (c: any) => void) => {
    const c = structuredClone(acmeJson) as any
    mutate(c)
    return () => loadConfig(c, 'test.json')
  }
  it('rejects a missing rule, naming the field', () => {
    expect(bad((c) => delete c.safetyBuffer.minimumDaysPastRun)).toThrow(/safetyBuffer\.minimumDaysPastRun/)
  })
  it('rejects an unknown policy', () => {
    expect(bad((c) => (c.allocation.policy = 'first_come_first_served'))).toThrow(/allocation\.policy/)
  })
  it('rejects negative days', () => {
    expect(bad((c) => (c.transfers.leadTimeDays = -3))).toThrow(/transfers\.leadTimeDays/)
  })
  it('rejects a misspelled top-level section instead of ignoring it', () => {
    expect(bad((c) => (c.aproval = c.approval))).toThrow()
  })
})

describe('Config-driven rules', () => {
  it('fair share: every market gets the same percentage of its order', () => {
    // Both markets low on cover. 200 cases for 400 ordered = 50% each.
    const w = world([{ id: 'X', rate: 10, doh: 5, order: 100 }, { id: 'Y', rate: 10, doh: 20, order: 300 }], 200)
    const plan = planSku(w, 'A', withRules({ allocationPolicy: 'fair_share' }))
    expect(line(plan, 'X').ship).toBe(50)
    expect(line(plan, 'Y').ship).toBe(150)
    expect(line(plan, 'X').rule).toBe('FAIR SHARE')
    expect(plan.fairSharePct).toBe(0.5)
    // Same event under equal days of cover: the 5-day market is protected first.
    const eq = planSku(w, 'A', DEFAULT_SETTINGS)
    expect(line(eq, 'X').ship).toBe(100)
  })

  it('always_first: a healthy priority account is served before anyone, even if it would be held', () => {
    // P has 60 days (past the 28-day run + buffer), N is nearly out. Only 100 cases.
    const w = world([{ id: 'P', priority: 'National account', rate: 10, doh: 60, order: 100 }, { id: 'N', rate: 10, doh: 3, order: 300 }], 100)
    const atRisk = planSku(w, 'A', DEFAULT_SETTINGS)
    expect(line(atRisk, 'P').ship).toBe(0)
    expect(line(atRisk, 'N').ship).toBe(100)
    const always = planSku(w, 'A', withRules({ priorityRule: 'always_first' }))
    expect(line(always, 'P').ship).toBe(100)
    expect(line(always, 'P').rule).toBe('PRIORITY')
    expect(line(always, 'N').ship).toBe(0)
  })

  it('priority list comes from the config, not the distributor data', () => {
    const w = world([{ id: 'P', priority: 'National account', rate: 10, doh: 5, order: 300 }, { id: 'N', rate: 10, doh: 5, order: 300 }], 100)
    const plan = planSku(w, 'A', withRules({ priorityAccounts: { 'D-N': 'Key distributor' } }))
    expect(line(plan, 'N').ship).toBe(100)
    expect(line(plan, 'N').priority).toBe('Key distributor')
    expect(line(plan, 'P').priority).toBeNull()
  })

  it('two priority accounts at risk with too little for both: they share toward equal cover', () => {
    const w = world([{ id: 'P1', priority: 'National account', rate: 10, doh: 2, order: 300 }, { id: 'P2', priority: 'Key distributor', rate: 10, doh: 8, order: 300 }], 100)
    const plan = planSku(w, 'A', DEFAULT_SETTINGS)
    // Level L: (L-2)*10 + (L-8)*10 = 100 -> L = 10 days. P1 gets 80, P2 gets 20.
    expect(line(plan, 'P1').ship).toBe(80)
    expect(line(plan, 'P2').ship).toBe(20)
  })

  it('transfers switched off: no transfer even when one market is long and another short', () => {
    const w = world([{ id: 'L', dist: 'D1', rate: 10, doh: 200, order: 0 }, { id: 'S', dist: 'D1', rate: 10, doh: 3, order: 300 }], 50)
    expect(planSku(w, 'A', DEFAULT_SETTINGS).transfers.length).toBe(1)
    expect(planSku(w, 'A', withRules({ transfersEnabled: false })).transfers.length).toBe(0)
  })
})

describe('Seeded demo: same shortage, two customers', () => {
  const seeded: World = JSON.parse(readFileSync(resolve(__dirname, '../data/world.json'), 'utf8'))
  const [acme, bluestone] = CUSTOMERS.map(settingsFromConfig)

  it('produces a different allocation for every short SKU', () => {
    for (const sku of ['AGS-750', 'HRB-750', 'NSB-750']) {
      const a = planSku(seeded, sku, acme).lines.map((l) => l.ship)
      const h = planSku(seeded, sku, bluestone).lines.map((l) => l.ship)
      expect(h).not.toEqual(a)
    }
  })

  it('Acme moves tequila Texas to Florida; Bluestone (no transfers) does not', () => {
    expect(planSku(seeded, 'AGS-750', acme).transfers.length).toBeGreaterThan(0)
    expect(planSku(seeded, 'AGS-750', bluestone).transfers.length).toBe(0)
  })

  it('both customers ship exactly the supply available, no more', () => {
    for (const s of [acme, bluestone]) {
      const plan = planSku(seeded, 'HRB-750', s)
      expect(plan.overAllocated).toBe(0)
      expect(plan.unallocated).toBe(0)
    }
  })
})
