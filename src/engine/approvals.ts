/**
 * APPROVAL ROUTING
 * ================
 * Decides which parts of a plan a human must sign off before anything ships.
 * This is plain code, not AI: the agent can explain a plan, but it can't skip this check.
 *
 * Rules come from the customer config's "approval" section:
 *  - a priority account that gets less than it ordered
 *  - a line shipping less than X% of its order AND running out before the run
 *    (a deep cut to a market that will still have stock is low risk, so it auto-executes)
 *  - any line shipping more than N cases
 *  - any intracompany transfer
 *  - always: any market with bad data
 * Tuned 11/19 to avoid approval fatigue: the first draft (every priority line, every
 * low-fill line) sent 60% to 100% of lines to a human, so the check stopped meaning anything.
 * When supply covers every order there is no shortage decision to approve, so only
 * data issues are routed.
 */
import type { CustomerConfig } from './customerConfig'
import type { Plan } from './types'

export interface ApprovalItem {
  /** Market id for a line, or "from->to" for a transfer. */
  id: string
  kind: 'line' | 'transfer'
  title: string
  /** Why it needs a human (one entry per rule it tripped). */
  why: string[]
}

export interface Routing {
  queue: ApprovalItem[]
  /** Market ids that can execute without sign-off. */
  autoExecute: string[]
}

const pct = (x: number) => `${Math.round(x * 100)}%`

export function routeApprovals(plan: Plan, config: CustomerConfig): Routing {
  const rules = config.approval
  const short = plan.summary.isShort
  const queue: ApprovalItem[] = []
  const autoExecute: string[] = []

  for (const l of plan.lines) {
    const why: string[] = []
    if (l.dataIssues.length) why.push(`Data issue: ${l.dataIssues.join('; ')}`)
    if (short && l.orderQty > 0) {
      const fill = l.ship / l.orderQty
      if (rules.priorityAccounts && l.priority && l.ship < l.orderQty)
        why.push(`${l.priority} getting ${pct(fill)} of its order`)
      if (fill < rules.fillRateBelow && l.stockoutBeforeRun)
        why.push(`Ships ${pct(fill)} of the order (under ${pct(rules.fillRateBelow)}) and runs out before the run`)
      if (l.ship > rules.lineOverCases) why.push(`Ships ${l.ship} cs, over the ${rules.lineOverCases} cs approval line`)
    }
    if (why.length) queue.push({ id: l.marketId, kind: 'line', title: `${l.distributorName} ${l.state}`, why })
    else if (l.orderQty > 0) autoExecute.push(l.marketId)
  }

  if (rules.transfers)
    for (const t of plan.transfers)
      queue.push({
        id: `${t.fromMarketId}->${t.toMarketId}`,
        kind: 'transfer',
        title: `${t.distributorName}: ${t.qty} cs ${t.fromState} to ${t.toState}`,
        why: ['Intracompany transfers always get a human check (state registration and tax)'],
      })

  return { queue, autoExecute }
}
