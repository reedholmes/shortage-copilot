// Display helpers shared by the screens.
import type { AccountLine } from '../engine/types'

export const n = (x: number) => Math.round(x).toLocaleString('en-US')
export const pct = (x: number) => `${Math.round(x * 100)}%`
export const d = (x: number) => `${Math.round(x)}d`

/** Short, human label for the rule that decided a line. */
export const RULE_LABEL: Record<AccountLine['rule'], string> = {
  FULL: 'Full supply',
  HOLD: 'Covered to run, held',
  PRIORITY: 'Priority at risk, served first',
  SPREAD: 'Spread to equal cover',
  RELEASED: 'Leftover released',
  OVERRIDE: 'Planner override',
  'NO ORDER': 'No open order',
}
