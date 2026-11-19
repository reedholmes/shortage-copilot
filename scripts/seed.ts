/**
 * SEED SCRIPT: builds 100% synthetic demo data.
 * Run with:  npm run seed   ->  writes src/data/world.json
 *
 * A fixed random seed means the same data every time, so the demo and tests are stable.
 * All company and brand names are invented.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Distributor, Market, Position, Scenario, Sku, World } from '../src/engine/types'

// --- Deterministic random numbers (mulberry32) ------------------------------
function makeRng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = makeRng(20261116)
const between = (lo: number, hi: number) => lo + (hi - lo) * rand()
/** Roughly bell-shaped noise around 0 with the given spread. */
const noise = (sd: number) => (rand() + rand() + rand() - 1.5) * sd * 2
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]

const AS_OF = '2026-11-16' // a Monday
const WEEKS = 13

// --- Distributors and their markets (25 markets, 12 states) -----------------
// Which distributors are priority accounts is a customer rule, so it lives in /config, not here.
const DISTRIBUTORS: (Distributor & { states: string[] })[] = [
  { id: 'D01', name: 'Summit Crest Distributing', states: ['TX', 'FL', 'AZ'] },
  { id: 'D02', name: 'Gulfline Wine & Spirits', states: ['FL', 'GA'] },
  { id: 'D03', name: 'Pacific Bluff Beverage', states: ['CA', 'CO'] },
  { id: 'D04', name: 'Empire Harbor Distributors', states: ['NY', 'NJ'] },
  { id: 'D05', name: 'Lakefront Beverage Co.', states: ['IL', 'OH'] },
  { id: 'D06', name: 'Keystone Valley Wine & Spirits', states: ['PA', 'NJ'] },
  { id: 'D07', name: 'Piedmont Spirits Group', states: ['NC', 'GA'] },
  { id: 'D08', name: 'Front Range Beverage', states: ['CO'] },
  { id: 'D09', name: 'Buckeye Junction Distributing', states: ['OH'] },
  { id: 'D10', name: 'Desert Mesa Wine Co.', states: ['AZ'] },
  { id: 'D11', name: 'Prairie Lantern Beverage', states: ['IL'] },
  { id: 'D12', name: 'Longhorn Plains Beverage', states: ['TX'] },
  { id: 'D13', name: 'Golden Coast Fine Wine', states: ['CA'] },
  { id: 'D14', name: 'Hudson & Pine Spirits', states: ['NY'] },
  { id: 'D15', name: 'Magnolia Coast Distributing', states: ['FL'] },
  { id: 'D16', name: 'Tidewater Atlantic Beverage', states: ['NC', 'PA'] },
]

/** Relative market size by state. */
const STATE_SIZE: Record<string, number> = {
  CA: 1.5, TX: 1.4, FL: 1.3, NY: 1.2, IL: 1.0, PA: 0.9,
  GA: 0.8, NJ: 0.8, OH: 0.8, NC: 0.8, AZ: 0.7, CO: 0.6,
}

// --- SKUs --------------------------------------------------------------------
interface SkuSpec {
  id: string
  name: string
  category: string
  /** Weekly depletions (cases) for a market of size 1.0. */
  base: number
  /** Week-to-week noise. */
  sd: number
  /** Optional demand multiplier by week (holiday ramps etc.). */
  season?: (week: number) => number
  runInWeeks: number
  /** On hand as a share of open orders. Below 1 means short. */
  supplyRatio: number
}

const SKUS: SkuSpec[] = [
  { id: 'HRB-750', name: 'Harbor Ridge Bourbon 750ml', category: 'Bourbon', base: 60, sd: 0.08, runInWeeks: 6, supplyRatio: 0.58 },
  { id: 'AGS-750', name: 'Agave Sol Blanco Tequila 750ml', category: 'Tequila', base: 45, sd: 0.1, runInWeeks: 5, supplyRatio: 0.62 },
  {
    id: 'NSB-750', name: 'North Shore Sparkling Brut 750ml', category: 'Sparkling wine', base: 30, sd: 0.12,
    // Holiday spike: weeks 2 to 6 run hot (Thanksgiving through New Year).
    season: (w) => (w >= 1 && w <= 6 ? 1.9 : 0.85),
    runInWeeks: 4, supplyRatio: 0.55,
  },
  { id: 'CVK-1L', name: 'Coastline Vodka 1L', category: 'Vodka', base: 70, sd: 0.07, runInWeeks: 3, supplyRatio: 1.4 },
  { id: 'IBR-750', name: 'Ironbridge Rye 750ml', category: 'Rye whiskey', base: 15, sd: 0.1, runInWeeks: 6, supplyRatio: 1.3 },
  { id: 'HFG-750', name: 'Highfield Dry Gin 750ml', category: 'Gin', base: 20, sd: 0.09, runInWeeks: 4, supplyRatio: 1.5 },
  { id: 'CPN-750', name: 'Cascade Pinot Noir 750ml', category: 'Red wine', base: 25, sd: 0.09, runInWeeks: 5, supplyRatio: 1.25 },
  { id: 'VCB-750', name: 'Valley Crest Cabernet 750ml', category: 'Red wine', base: 35, sd: 0.08, runInWeeks: 8, supplyRatio: 1.35 },
]

/**
 * Scenario tweaks: target "days on hand" for specific markets (sku -> market -> days),
 * and markets that have no open order. This is where the story lives.
 */
const COVER_OVERRIDES: Record<string, Record<string, number>> = {
  // 1. National bourbon shortage: a mix of desperate, average and well-stocked markets.
  'HRB-750': { 'D12-TX': 6, 'D14-NY': 9, 'D01-FL': 8, 'D13-CA': 75, 'D09-OH': 70, 'D05-IL': 14, 'D03-CA': 31 },
  // 2. Long/short: Summit Crest over-bought tequila in Texas while Florida is nearly dry.
  'AGS-750': { 'D01-TX': 140, 'D01-FL': 6, 'D01-AZ': 30, 'D02-FL': 11, 'D15-FL': 13, 'D06-PA': 64 },
  // 3. Holiday sparkling crunch: two national-account markets nearly out.
  'NSB-750': { 'D03-CA': 5, 'D01-FL': 7, 'D04-NY': 10, 'D11-IL': 45, 'D07-NC': 40 },
}
const NO_ORDER: Record<string, string[]> = {
  'AGS-750': ['D01-TX'], // the long market isn't ordering
}

const SCENARIOS: Scenario[] = [
  {
    skuId: 'HRB-750',
    title: 'National bourbon shortage',
    story:
      'A bottling line outage cut Harbor Ridge output. On hand covers about 58% of open orders, and the next run lands in 6 weeks. Some markets are nearly dry while others are sitting on plenty.',
  },
  {
    skuId: 'AGS-750',
    title: 'One market long, another short',
    story:
      'Summit Crest bought heavily into Texas ahead of a promotion that slipped, leaving about 140 days on hand there while its Florida market is nearly out. An intracompany transfer can fix Florida faster than the next production run can.',
  },
  {
    skuId: 'NSB-750',
    title: 'Holiday sparkling crunch',
    story:
      'Holiday demand for North Shore Brut came in well above plan. Supply covers about 55% of orders until the next run in 4 weeks, and two national-account markets are close to stocking out.',
  },
]

/**
 * Week-by-week shipment multiplier vs depletions, by SKU and market. Real-world stories:
 *  - Sparkling: distributors load ahead of the holidays, then stop ordering in January.
 *  - Bourbon: gift-season pre-load in the first weeks, flat after.
 *  - Tequila: Summit Crest TX is destocking after the slipped promo; Florida markets are
 *    loading for a spring promo, so their shipment forecast runs well above depletions.
 */
function shipPattern(skuId: string, marketId: string): (week: number) => number {
  if (skuId === 'NSB-750') return (w) => (w <= 2 ? 1.45 : w <= 5 ? 1.0 : 0.6)
  if (skuId === 'HRB-750') return (w) => (w <= 3 ? 1.3 : 0.95)
  if (skuId === 'AGS-750') {
    if (marketId === 'D01-TX') return () => 0.35
    if (marketId.endsWith('-FL')) return (w) => (w <= 5 ? 1.5 : 1.1)
  }
  return () => 1
}

// --- Build -------------------------------------------------------------------
function build(): World {
  const markets: Market[] = DISTRIBUTORS.flatMap((d) =>
    d.states.map((s) => ({ id: `${d.id}-${s}`, distributorId: d.id, state: s })),
  )
  const shareByMarket = new Map(markets.map((m) => [m.id, between(0.6, 1.2)]))

  const skus: Sku[] = []
  const positions: Position[] = []
  let orderSeq = 1000

  for (const spec of SKUS) {
    const skuPositions: Position[] = []
    for (const m of markets) {
      const size = STATE_SIZE[m.state] * shareByMarket.get(m.id)!
      const depFcst = Array.from({ length: WEEKS }, (_, w) =>
        Math.max(1, Math.round(spec.base * size * (spec.season?.(w) ?? 1) * (1 + noise(spec.sd)))),
      )
      // Shipments = depletions x a "channel" factor. This gap is what the blend slider arbitrates:
      // above 1 the distributor is loading inventory, below 1 it is drawing stock down.
      // Each market's habitual ordering pattern. On short SKUs about a third of distributors
      // inflate their orders to win a bigger share of allocation, a classic shortage behavior.
      // That is exactly why a planner trusts depletions over shipments in the near term.
      const isShortSku = spec.supplyRatio < 1
      const bias = isShortSku && rand() < 0.35 ? between(1.4, 1.8) : between(0.85, 1.15)
      const channel = shipPattern(spec.id, m.id)
      const shipFcst = depFcst.map((d, w) =>
        Math.max(0, Math.round(d * bias * channel(w) * (1 + noise(0.05)))),
      )
      const dailyNear = (depFcst[0] + depFcst[1] + depFcst[2] + depFcst[3]) / 28

      const coverDays = COVER_OVERRIDES[spec.id]?.[m.id] ?? between(22, 45)
      const inTransit: Position['inTransit'] = []
      if (rand() < 0.3 && !COVER_OVERRIDES[spec.id]?.[m.id]) {
        inTransit.push({ qty: Math.round(dailyNear * between(4, 8)), arrivesInDays: pick([2, 4, 6, 10, 12]) })
      }
      // Target cover includes in-transit arriving within a week, so subtract it from the floor stock.
      const nearInTransit = inTransit.filter((t) => t.arrivesInDays <= 7).reduce((s, t) => s + t.qty, 0)
      const onHand = Math.max(0, Math.round(dailyNear * coverDays) - nearInTransit)

      const openOrders: Position['openOrders'] = []
      const skip = NO_ORDER[spec.id]?.includes(m.id) || (rand() < 0.12 && !COVER_OVERRIDES[spec.id]?.[m.id])
      if (!skip) {
        const total = Math.round((shipFcst[0] + shipFcst[1]) * between(0.9, 1.3))
        if (rand() < 0.5) {
          openOrders.push({ id: `PO-${orderSeq++}`, qty: total, requestedWeek: 0 })
        } else {
          const first = Math.round(total * between(0.4, 0.6))
          openOrders.push({ id: `PO-${orderSeq++}`, qty: first, requestedWeek: 0 })
          openOrders.push({ id: `PO-${orderSeq++}`, qty: total - first, requestedWeek: 1 })
        }
      }
      skuPositions.push({ skuId: spec.id, marketId: m.id, onHand, inTransit, shipFcst, depFcst, openOrders })
    }
    const totalOrders = skuPositions.reduce((s, p) => s + p.openOrders.reduce((a, o) => a + o.qty, 0), 0)
    const weeklyNetwork = skuPositions.reduce((s, p) => s + p.depFcst[0], 0)
    skus.push({
      id: spec.id,
      name: spec.name,
      category: spec.category,
      availableNow: Math.round(totalOrders * spec.supplyRatio),
      nextRun: { inWeeks: spec.runInWeeks, qty: Math.round(weeklyNetwork * 6) },
    })
    positions.push(...skuPositions)
  }

  return {
    asOf: AS_OF,
    horizonWeeks: WEEKS,
    skus,
    distributors: DISTRIBUTORS.map(({ states: _states, ...d }) => d),
    markets,
    positions,
    scenarios: SCENARIOS,
  }
}

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '../src/data/world.json')
mkdirSync(dirname(out), { recursive: true })
const world = build()
writeFileSync(out, JSON.stringify(world, null, 1))
console.log(`Wrote ${out}: ${world.skus.length} SKUs, ${world.markets.length} markets, ${world.positions.length} positions`)
