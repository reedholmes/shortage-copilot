/**
 * Runs the eval scorecard as part of `npm test`, so a change that breaks a customer
 * rule fails the normal test run, not just `npm run evals`.
 */
import { describe, expect, it } from 'vitest'
import { runAll } from './runner'
import { SCENARIOS } from './scenarios'

describe('Eval scorecard', () => {
  const card = runAll(SCENARIOS)
  it('has between 12 and 15 scenarios, with every edge case from the brief', () => {
    expect(card.scenarios.length).toBeGreaterThanOrEqual(12)
    expect(card.scenarios.length).toBeLessThanOrEqual(15)
    const titles = card.scenarios.map((s) => s.title.toLowerCase()).join(' | ')
    for (const edge of ['zero supply', 'late production run', 'priority accounts at risk', 'negative on hand']) expect(titles).toContain(edge)
  })
  for (const s of card.scenarios)
    it(`${s.id} ${s.title}`, () => {
      const failed = s.checks.filter((c) => !c.passed).map((c) => `${c.label}: expected ${c.expected}, got ${c.actual}`)
      expect(s.error ?? null).toBeNull()
      expect(failed).toEqual([])
    })
})