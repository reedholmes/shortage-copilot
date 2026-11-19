/**
 * EVAL SCORECARD:  npm run evals
 * Runs every scenario in /evals/scenarios, prints a scorecard, and saves it to
 * evals/scorecard.md (readable) and evals/scorecard.json (for tools).
 * Exits with an error code if anything fails, so it can gate a release.
 */
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runAll } from '../src/evals/runner'
import { SCENARIOS } from '../src/evals/scenarios'

const card = runAll(SCENARIOS)
const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const out: string[] = []
const log = (s = '') => out.push(s)

log('# Eval scorecard')
log()
log(`Ran ${card.scenarios.length} scenarios on ${card.ranAt.slice(0, 10)}.`)
log()
log(`- **Scenarios passed:** ${card.scenariosPassed} / ${card.scenarios.length}`)
log(`- **Accuracy (expected outcomes matched):** ${card.checksPassed} / ${card.checksTotal} = ${pct(card.accuracy)}`)
log()
log('| ID | Scenario | Type | Customer | Checks | Result |')
log('|---|---|---|---|---|---|')
for (const s of card.scenarios) {
  const ok = s.checks.filter((c) => c.passed).length
  log(`| ${s.id} | ${s.title} | ${s.category} | ${s.customer} | ${ok}/${s.checks.length} | ${s.passed ? 'PASS' : 'FAIL'} |`)
}
const failures = card.scenarios.filter((s) => !s.passed)
if (failures.length) {
  log()
  log('## Failures')
  for (const s of failures) {
    log()
    log(`**${s.id} ${s.title}**`)
    if (s.error) log(`- Could not run: ${s.error}`)
    for (const c of s.checks.filter((x) => !x.passed)) log(`- ${c.label}: expected ${c.expected}, got ${c.actual}`)
  }
}

const here = dirname(fileURLToPath(import.meta.url))
writeFileSync(resolve(here, '../evals/scorecard.md'), out.join('\n') + '\n')
writeFileSync(resolve(here, '../evals/scorecard.json'), JSON.stringify(card, null, 2) + '\n')
console.log(out.join('\n'))
process.exitCode = failures.length ? 1 : 0
