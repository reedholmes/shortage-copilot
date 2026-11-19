/** Every eval scenario. To add one: drop a JSON file in /evals/scenarios and list it here. */
import s01 from '../../evals/scenarios/01_no_shortage.json'
import s02 from '../../evals/scenarios/02_equal_days_of_cover.json'
import s03 from '../../evals/scenarios/03_hold_covered_market.json'
import s04 from '../../evals/scenarios/04_priority_at_risk.json'
import s05 from '../../evals/scenarios/05_healthy_priority_waits.json'
import s06 from '../../evals/scenarios/06_priority_conflict.json'
import s07 from '../../evals/scenarios/07_intracompany_transfer.json'
import s08 from '../../evals/scenarios/08_zero_supply.json'
import s09 from '../../evals/scenarios/09_late_production_run.json'
import s10 from '../../evals/scenarios/10_bad_data_negative_on_hand.json'
import s11 from '../../evals/scenarios/11_fair_share.json'
import s12 from '../../evals/scenarios/12_same_event_equal_cover.json'
import s13 from '../../evals/scenarios/13_priority_always_first.json'
import s14 from '../../evals/scenarios/14_transfers_off.json'
import s15 from '../../evals/scenarios/15_large_line.json'
import type { Scenario } from './runner'

export const SCENARIOS = [s01, s02, s03, s04, s05, s06, s07, s08, s09, s10, s11, s12, s13, s14, s15] as Scenario[]
