/**
 * REVIEW REPORT: runs the engine on the seeded data and writes a readable
 * Markdown file so a planner can sanity-check the recommendations.
 * Run with:  npm run report   ->  writes docs/allocation-review.md
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SETTINGS, fmtDate, planSku, summarizeAll } from '../src/engine/allocation'
import type { World } from '../src/engine/types'

const here = dirname(fileURLToPath(import.meta.url))
const world: World = JSON.parse(readFileSync(resolve(here, '../src/data/world.json'), 'utf8'))
const n = (x: number) => Math.round(x).toLocaleString('en-US')
const out: string[] = []

out.push(`# Allocation review (as of ${world.asOf})`, '')
out.push(`Blend: ${Math.round(DEFAULT_SETTINGS.nearDepletionWeight * 100)}% depletions in week 1 sliding to ${Math.round((1 - DEFAULT_SETTINGS.nearDepletionWeight) * 100)}% by week ${world.horizonWeeks}.`, '')
out.push('## Shortage overview', '')
out.push('| SKU | Short? | Open orders | Available | Gap | Fill % | Next run | Buffer | At risk before → after |')
out.push('|---|---|--:|--:|--:|--:|---|--:|---|')
for (const s of summarizeAll(world)) {
  out.push(
    `| ${s.name} | ${s.isShort ? '**YES**' : 'no'} | ${n(s.openOrderQty)} | ${n(s.availableNow)} | ${n(s.gapQty)} | ${Math.round(s.fillRate * 100)}% | ${fmtDate(s.runDate)} (${s.daysToRun}d) | ${s.bufferDays}d | ${s.marketsAtRiskBefore} → ${s.marketsAtRiskAfter} |`,
  )
}

for (const sc of world.scenarios) {
  const plan = planSku(world, sc.skuId)
  const s = plan.summary
  out.push('', `## ${sc.title}: ${s.name}`, '', sc.story, '')
  out.push(`Buffer ${s.bufferDays} days (${s.bufferWhy.join('; ')}). Hold line = ${s.daysToRun + s.bufferDays} days of cover. Spread level reached: ${plan.spreadLevelDays === null ? 'n/a' : Math.round(plan.spreadLevelDays) + ' days'}. Unallocated: ${n(plan.unallocated)} cs.`, '')
  if (plan.transfers.length) {
    out.push('**Transfers**', '')
    for (const t of plan.transfers) out.push(`- ${t.distributorName}: ${n(t.qty)} cs ${t.fromState} → ${t.toState}. ${t.reason}`)
    out.push('')
  }
  out.push('| Distributor | St | Priority | Cs/day | DOH today | Cover before | Ordered | Ship | Backorder | Cover after | Action | Rule |')
  out.push('|---|---|---|--:|--:|--:|--:|--:|--:|--:|---|---|')
  for (const l of plan.lines) {
    out.push(
      `| ${l.distributorName} | ${l.state} | ${l.priority ?? ''} | ${l.avgDaily.toFixed(1)} | ${n(l.dohToday)} | ${n(l.coverBefore)} | ${n(l.orderQty)} | ${n(l.ship)} | ${n(l.backorderQty)} | ${n(l.coverAfter)}${l.stockoutBeforeRun ? ' ⚠' : ''} | ${l.action} | ${l.rule} |`,
    )
  }
  const example = plan.lines.find((l) => l.rule === 'PRIORITY') ?? plan.lines.find((l) => l.rule === 'HOLD') ?? plan.lines[0]
  out.push('', `**Example reasoning (${example.distributorName}, ${example.state}):**`, '')
  for (const r of example.reasons) out.push(`- ${r}`)
}

const file = resolve(here, '../docs/allocation-review.md')
mkdirSync(dirname(file), { recursive: true })
writeFileSync(file, out.join('\n') + '\n')
console.log(`Wrote ${file}`)
