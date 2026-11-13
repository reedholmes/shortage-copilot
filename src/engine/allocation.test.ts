/**
 * Tests for the allocation engine. Each test builds a tiny hand-made world so the
 * expected answer is obvious, then checks one planning rule.
 * Run with:  npm test
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, blendWeights, planSku, skuContext, summarizeAll, waterFill } from './allocation'
import type { Distributor, Market, Position, PriorityType, World } from './types'

const WEEKS = 13

interface MarketSpec {
  id: string
  dist?: string
  priority?: PriorityType
  /** Flat cases per day (applied to both forecasts so the blend doesn't matter). */
  rate: number
  /** Days on hand today. */
  doh: number
  order: number
  inTransit?: { qty: number; arrivesInDays: number }[]
}

/** Build a one-SKU world. Demand is flat so days-on-hand math is easy to check by hand. */
function world(specs: MarketSpec[], availableNow: number, runInWeeks = 4, extraSkus = 0): World {
  const distributors: Distributor[] = []
  const markets: Market[] = []
  const positions: Position[] = []
  for (const s of specs) {
    const distId = s.dist ?? `D-${s.id}`
    if (!distributors.find((d) => d.id === distId))
      distributors.push({ id: distId, name: distId, priority: s.priority ?? null })
    markets.push({ id: s.id, distributorId: distId, state: s.id })
    const weekly = Array(WEEKS).fill(s.rate * 7)
    positions.push({
      skuId: 'A',
      marketId: s.id,
      onHand: s.rate * s.doh,
      inTransit: s.inTransit ?? [],
      shipFcst: weekly,
      depFcst: weekly,
      openOrders: s.order ? [{ id: `PO-${s.id}`, qty: s.order, requestedWeek: 0 }] : [],
    })
  }
  // Optional filler SKUs (bigger volume) so SKU "A" is not automatically top-quartile velocity.
  const skus = [{ id: 'A', name: 'Test SKU', category: 'Test', availableNow, nextRun: { inWeeks: runInWeeks, qty: 1000 } }]
  for (let k = 0; k < extraSkus; k++) {
    skus.push({ id: `F${k}`, name: `Filler ${k}`, category: 'Test', availableNow: 0, nextRun: { inWeeks: 4, qty: 0 } })
    positions.push({
      skuId: `F${k}`, marketId: specs[0].id, onHand: 0, inTransit: [],
      shipFcst: Array(WEEKS).fill(100000), depFcst: Array(WEEKS).fill(100000), openOrders: [],
    })
  }
  return { asOf: '2026-11-16', horizonWeeks: WEEKS, skus, distributors, markets, positions, scenarios: [] }
}

const line = (plan: ReturnType<typeof planSku>, id: string) => plan.lines.find((l) => l.marketId === id)!

describe('Step 1: forecast blend', () => {
  it('weights depletions most in week 1 and least in the last week', () => {
    const w = blendWeights(0.75, 13)
    expect(w[0]).toBeCloseTo(0.75)
    expect(w[12]).toBeCloseTo(0.25)
    expect(w[6]).toBeCloseTo(0.5)
  })
  it('a 50% slider means a flat 50/50 blend', () => {
    expect(blendWeights(0.5, 13).every((x) => Math.abs(x - 0.5) < 1e-9)).toBe(true)
  })
})

describe('Step 2: days on hand', () => {
  it('counts in-transit arriving within 7 days as on hand, but not later arrivals', () => {
    const w = world(
      [{ id: 'X', rate: 10, doh: 10, order: 50, inTransit: [{ qty: 50, arrivesInDays: 3 }, { qty: 100, arrivesInDays: 12 }] }],
      1000,
    )
    const l = line(planSku(w, 'A'), 'X')
    expect(l.effOnHand).toBe(150) // 100 on hand + 50 arriving in 3 days
    expect(l.dohToday).toBeCloseTo(15)
    expect(l.inboundBeforeRun).toBe(100) // the 12-day arrival is inbound, not on hand
  })
})

describe('Safety buffer', () => {
  it('is 7 days for an ordinary SKU', () => {
    const w = world([{ id: 'X', rate: 10, doh: 10, order: 50 }], 1000, 4, 4)
    expect(skuContext(w, w.skus[0], DEFAULT_SETTINGS).bufferDays).toBe(7)
  })
  it('adds 3 days for a top-quartile volume SKU', () => {
    const w = world([{ id: 'X', rate: 10, doh: 10, order: 50 }], 1000) // only SKU, so it is the top seller
    expect(skuContext(w, w.skus[0], DEFAULT_SETTINGS).bufferDays).toBe(10)
  })
  it('adds 4 days when demand is volatile', () => {
    const w = world([{ id: 'X', rate: 10, doh: 10, order: 50 }], 1000, 4, 4)
    w.positions[0].depFcst = [20, 120, 20, 120, 20, 120, 20, 120, 20, 120, 20, 120, 20]
    expect(skuContext(w, w.skus[0], DEFAULT_SETTINGS).bufferDays).toBe(11)
  })
})

describe('No shortage', () => {
  it('ships every open order in full', () => {
    const w = world([{ id: 'X', rate: 10, doh: 5, order: 80 }, { id: 'Y', rate: 10, doh: 60, order: 40 }], 500)
    const plan = planSku(w, 'A')
    expect(plan.summary.isShort).toBe(false)
    expect(plan.lines.every((l) => l.ship === l.orderQty)).toBe(true)
    expect(plan.summary.marketsAtRiskAfter).toBe(0)
  })
})

describe('Step 3: backorders', () => {
  it('backorders the unfilled part and expects it when the run lands', () => {
    const w = world([{ id: 'X', rate: 10, doh: 5, order: 300 }], 100, 4, 4)
    const l = line(planSku(w, 'A'), 'X')
    expect(l.ship).toBe(100)
    expect(l.backorderQty).toBe(200)
    expect(l.orders[0]).toMatchObject({ filled: 100, backordered: 200 })
    expect(l.reasons.join(' ')).toContain('Dec 14') // 4 weeks after Nov 16
  })
})

describe('Step 5: hold', () => {
  it('holds orders for markets covered to the run plus buffer', () => {
    // Run in 28 days + 7-day buffer = 35. Y has 50 days, so it is held.
    const w = world([{ id: 'X', rate: 10, doh: 5, order: 300 }, { id: 'Y', rate: 10, doh: 50, order: 300 }], 200, 4, 4)
    const plan = planSku(w, 'A')
    expect(line(plan, 'Y').rule).toBe('HOLD')
    expect(line(plan, 'Y').ship).toBe(0)
    expect(line(plan, 'X').ship).toBe(200)
  })
})

describe('Step 6: priority and spreading', () => {
  it('priority accounts at stockout risk jump the line', () => {
    // Both at 5 days. Only 100 cases. The national account gets served first.
    const w = world(
      [
        { id: 'P', priority: 'National account', rate: 10, doh: 5, order: 300 },
        { id: 'N', rate: 10, doh: 5, order: 300 },
      ],
      100, 4, 4,
    )
    const plan = planSku(w, 'A')
    expect(line(plan, 'P').ship).toBe(100)
    expect(line(plan, 'P').rule).toBe('PRIORITY')
    expect(line(plan, 'N').ship).toBe(0)
  })

  it('healthy priority accounts are treated like everyone else', () => {
    // Priority account has 30 days (run is 28 days away), so it is not at risk.
    const w = world(
      [
        { id: 'P', priority: 'Key distributor', rate: 10, doh: 30, order: 300 },
        { id: 'N', rate: 10, doh: 5, order: 300 },
      ],
      100, 4, 4,
    )
    const plan = planSku(w, 'A')
    expect(line(plan, 'P').rule).not.toBe('PRIORITY')
    expect(line(plan, 'N').ship).toBe(100) // lowest cover gets the stock
  })

  it('spreads supply so low-cover markets end at equal days of cover', () => {
    // X: 5 days, Y: 15 days, Z: 20 days, all 10 cs/day. 300 cases to share.
    // Level L where (L-5)*10 + (L-15)*10 + (L-20)*10 = 300 -> L = 23.3 days.
    const w = world(
      [
        { id: 'X', rate: 10, doh: 5, order: 500 },
        { id: 'Y', rate: 10, doh: 15, order: 500 },
        { id: 'Z', rate: 10, doh: 20, order: 500 },
      ],
      300, 4, 4,
    )
    const plan = planSku(w, 'A')
    const after = ['X', 'Y', 'Z'].map((id) => line(plan, id).coverAfter)
    for (const c of after) expect(c).toBeCloseTo(23.3, 0)
    expect(plan.spreadLevelDays).toBeCloseTo(23.33, 1)
  })

  it('never ships more than a market ordered, and never more than the plant has', () => {
    const w = world(
      [
        { id: 'X', rate: 10, doh: 1, order: 40 }, // tiny order, will be capped
        { id: 'Y', rate: 10, doh: 10, order: 500 },
      ],
      300, 4, 4,
    )
    const plan = planSku(w, 'A')
    expect(line(plan, 'X').ship).toBe(40)
    expect(line(plan, 'Y').ship).toBe(260)
    expect(plan.lines.reduce((s, l) => s + l.ship, 0)).toBe(300)
    expect(plan.unallocated).toBe(0)
  })

  it('water-fill hands out exactly the supply in whole cases', () => {
    const { ships } = waterFill(
      [
        { id: 'a', base: 0, rate: 3, cap: 1000 },
        { id: 'b', base: 10, rate: 7, cap: 1000 },
        { id: 'c', base: 5, rate: 1.3, cap: 1000 },
      ],
      101,
    )
    const vals = [...ships.values()]
    expect(vals.every(Number.isInteger)).toBe(true)
    expect(vals.reduce((a, b) => a + b, 0)).toBe(101)
  })
})

describe('Step 7: transfers', () => {
  it('moves stock from a long market to a short sister market with a 1-week lead time', () => {
    const w = world(
      [
        { id: 'TX', dist: 'D1', rate: 10, doh: 150, order: 0 },
        { id: 'FL', dist: 'D1', rate: 10, doh: 5, order: 300 },
        { id: 'GA', rate: 10, doh: 20, order: 300 },
      ],
      200, 4, 4,
    )
    const plan = planSku(w, 'A')
    expect(plan.transfers).toHaveLength(1)
    const t = plan.transfers[0]
    expect(t).toMatchObject({ fromMarketId: 'TX', toMarketId: 'FL', arrivesInDays: 7 })
    // FL needs 35 days (28 run + 7 buffer) = 350 cs, has 50, so the gap is 300.
    expect(t.qty).toBe(300)
    // TX keeps at least run + buffer worth of stock.
    expect(1500 - t.qty).toBeGreaterThanOrEqual(350)
    // FL also gets a warning: 5 days on hand, transfer lands in 7.
    expect(line(plan, 'FL').reasons.join(' ')).toContain('Watch')
  })

  it('never transfers between different distributors', () => {
    const w = world(
      [
        { id: 'TX', dist: 'D1', rate: 10, doh: 150, order: 0 },
        { id: 'FL', dist: 'D2', rate: 10, doh: 5, order: 300 },
      ],
      100, 4, 4,
    )
    expect(planSku(w, 'A').transfers).toHaveLength(0)
  })
})

describe('Planner overrides', () => {
  it('locks the override and re-spreads the rest', () => {
    const w = world([{ id: 'X', rate: 10, doh: 5, order: 500 }, { id: 'Y', rate: 10, doh: 5, order: 500 }], 200, 4, 4)
    const base = planSku(w, 'A')
    expect(line(base, 'X').ship).toBe(100)
    const over = planSku(w, 'A', DEFAULT_SETTINGS, { X: 150 })
    expect(line(over, 'X').ship).toBe(150)
    expect(line(over, 'X').overridden).toBe(true)
    expect(line(over, 'X').recommendedShip).toBe(100)
    expect(line(over, 'Y').ship).toBe(50)
  })

  it('flags over-allocation when overrides exceed plant supply', () => {
    const w = world([{ id: 'X', rate: 10, doh: 5, order: 500 }, { id: 'Y', rate: 10, doh: 5, order: 500 }], 200, 4, 4)
    const plan = planSku(w, 'A', DEFAULT_SETTINGS, { X: 260 })
    expect(plan.overAllocated).toBe(60)
    expect(line(plan, 'Y').ship).toBe(0)
  })
})

describe('Seeded demo data', () => {
  const seeded: World = JSON.parse(readFileSync(resolve(__dirname, '../data/world.json'), 'utf8'))

  it('has the agreed shape: 8 SKUs, 25 markets, 12 states, 13 weeks', () => {
    expect(seeded.skus).toHaveLength(8)
    expect(seeded.markets).toHaveLength(25)
    expect(new Set(seeded.markets.map((m) => m.state)).size).toBe(12)
    expect(seeded.positions.every((p) => p.depFcst.length === 13 && p.shipFcst.length === 13)).toBe(true)
  })

  it('makes exactly the three scenario SKUs short', () => {
    const short = summarizeAll(seeded).filter((s) => s.isShort).map((s) => s.skuId).sort()
    expect(short).toEqual(['AGS-750', 'HRB-750', 'NSB-750'])
  })

  it('the long/short tequila scenario produces a Summit Crest TX -> FL transfer', () => {
    const t = planSku(seeded, 'AGS-750').transfers
    expect(t.some((x) => x.fromMarketId === 'D01-TX' && x.toMarketId === 'D01-FL')).toBe(true)
  })

  it('every line on every SKU has written reasoning', () => {
    for (const s of seeded.skus) for (const l of planSku(seeded, s.id).lines) expect(l.reasons.length).toBeGreaterThan(1)
  })
})
