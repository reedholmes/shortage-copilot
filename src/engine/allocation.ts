/**
 * SHORTAGE ALLOCATION ENGINE
 * ==========================
 * Plain-language version of the planner's method. For one SKU it:
 *
 *   1. Blends shipment and depletion forecasts into one demand signal
 *   2. Calculates days on hand per distributor market
 *   3. Flags open orders the shortage will backorder
 *   4. Ranks markets by days of cover, lowest first
 *   5. Holds orders for markets with enough cover to reach the next run (plus buffer)
 *   6. Ships priority accounts at stockout risk first, then spreads the rest so
 *      cover levels rise together (lowest first, toward equal days on hand)
 *   7. Suggests transfers between a distributor's own markets (long -> short)
 *
 * Every line gets a list of plain-English reasons. No black box.
 * Nothing here touches the screen, so it can be tested on its own.
 */
import type {
  AccountLine,
  Distributor,
  Market,
  OrderFill,
  Plan,
  Position,
  PriorityType,
  Settings,
  Sku,
  SkuSummary,
  Transfer,
  World,
} from './types'

/** Same rules as config/customer_acme_beverage.json, minus the priority list (tests tag distributors directly). */
export const DEFAULT_SETTINGS: Settings = {
  allocationPolicy: 'equal_days_of_cover',
  holdCoveredMarkets: true,
  priorityRule: 'only_when_at_risk',
  transfersEnabled: true,
  nearDepletionWeight: 0.75,
  baseBufferDays: 7,
  highVelocityExtraDays: 3,
  highVariabilityExtraDays: 4,
  highVariabilityCv: 0.3,
  longThresholdDays: 90,
  transferLeadDays: 7,
  inTransitOnHandDays: 7,
  minTransferQty: 10,
}

/** Planner overrides: market id -> cases to ship. */
export type Overrides = Record<string, number>

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
const cs = (n: number) => `${Math.round(n).toLocaleString('en-US')} cs`
const days = (n: number) => `${Math.round(n)} ${Math.round(n) === 1 ? 'day' : 'days'}`
/** Guard against divide-by-zero for markets with no demand. */
const MIN_RATE = 0.01

export function addDays(isoDate: string, n: number): string {
  const d = new Date(isoDate + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function fmtDate(isoDate: string): string {
  return new Date(isoDate + 'T00:00:00Z').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

// ---------------------------------------------------------------------------
// Step 1: blend the two forecasts
// ---------------------------------------------------------------------------

/**
 * Week-by-week weight on the DEPLETION forecast.
 * Near term we trust depletions (what consumers are actually buying).
 * Further out we lean on shipments (what the distributor plans to order).
 * Example at 0.75: week 1 = 75% depletions, week 13 = 25% depletions.
 */
export function blendWeights(nearDepletionWeight: number, weeks: number): number[] {
  const near = clamp(nearDepletionWeight, 0, 1)
  const far = 1 - near
  if (weeks <= 1) return [near]
  return Array.from({ length: weeks }, (_, t) => near + ((far - near) * t) / (weeks - 1))
}

export function blendDemand(pos: Position, weights: number[]): number[] {
  return weights.map((w, t) => w * (pos.depFcst[t] ?? 0) + (1 - w) * (pos.shipFcst[t] ?? 0))
}

/** Standard deviation divided by the mean: a unit-free measure of how jumpy demand is. */
export function coefficientOfVariation(xs: number[]): number {
  if (!xs.length) return 0
  const mean = sum(xs) / xs.length
  if (mean <= 0) return 0
  const variance = sum(xs.map((x) => (x - mean) ** 2)) / xs.length
  return Math.sqrt(variance) / mean
}

// ---------------------------------------------------------------------------
// SKU-level context: run date, safety buffer, demand window
// ---------------------------------------------------------------------------

export interface SkuContext {
  sku: Sku
  daysToRun: number
  runDate: string
  bufferDays: number
  bufferWhy: string[]
  cv: number
  highVelocity: boolean
  /** Number of weeks averaged into "average daily demand". */
  windowWeeks: number
  weights: number[]
}

export function skuContext(world: World, sku: Sku, settings: Settings): SkuContext {
  const daysToRun = sku.nextRun.inWeeks * 7
  const weights = blendWeights(settings.nearDepletionWeight, world.horizonWeeks)

  // Velocity: is this SKU in the top quarter of network volume?
  const volumeBySku = world.skus.map((s) => ({
    id: s.id,
    vol: sum(world.positions.filter((p) => p.skuId === s.id).map((p) => sum(p.depFcst))),
  }))
  volumeBySku.sort((a, b) => b.vol - a.vol)
  const topN = Math.ceil(world.skus.length / 4)
  const highVelocity = volumeBySku.findIndex((v) => v.id === sku.id) < topN

  // Variability: volume-weighted average CV of each market's weekly depletions.
  const positions = world.positions.filter((p) => p.skuId === sku.id)
  const totalVol = sum(positions.map((p) => sum(p.depFcst))) || 1
  const cv = sum(positions.map((p) => coefficientOfVariation(p.depFcst) * sum(p.depFcst))) / totalVol

  let bufferDays = settings.baseBufferDays
  const bufferWhy = [`${settings.baseBufferDays}-day base buffer`]
  if (highVelocity) {
    bufferDays += settings.highVelocityExtraDays
    bufferWhy.push(`+${settings.highVelocityExtraDays} days: top-quartile volume SKU`)
  }
  if (cv > settings.highVariabilityCv) {
    bufferDays += settings.highVariabilityExtraDays
    bufferWhy.push(
      `+${settings.highVariabilityExtraDays} days: volatile demand (week-to-week variation ${Math.round(cv * 100)}%)`,
    )
  }

  // Average demand over the weeks that matter: from today until the run lands plus the buffer.
  // At least 4 weeks so one odd week doesn't swing the number.
  const windowWeeks = clamp(Math.ceil((daysToRun + bufferDays) / 7), 4, world.horizonWeeks)

  return {
    sku,
    daysToRun,
    runDate: addDays(world.asOf, daysToRun),
    bufferDays,
    bufferWhy,
    cv,
    highVelocity,
    windowWeeks,
    weights,
  }
}

// ---------------------------------------------------------------------------
// Step 2: per-market starting position
// ---------------------------------------------------------------------------

interface Acct {
  pos: Position
  market: Market
  dist: Distributor
  /** Priority tier from the customer config (or the distributor's own tag in tests). */
  priority: PriorityType
  avgDaily: number
  effOnHand: number
  inboundBeforeRun: number
  inTransitCounted: number
  dohToday: number
  orderQty: number
  transferIn: number
  transferOut: number
  /** Bad input data found for this market (empty when the data is clean). */
  dataIssues: string[]
}

/**
 * Data checks. Inventory, orders and forecasts can't be negative. Rather than guess,
 * the market is left out of the allocation and flagged for a human.
 */
function findDataIssues(pos: Position): string[] {
  const issues: string[] = []
  if (pos.onHand < 0) issues.push(`On hand is negative (${pos.onHand} cs)`)
  if (pos.inTransit.some((t) => t.qty < 0)) issues.push('An in-transit shipment has a negative quantity')
  if (pos.openOrders.some((o) => o.qty < 0)) issues.push('An open order has a negative quantity')
  if ([...pos.depFcst, ...pos.shipFcst].some((x) => x < 0)) issues.push('The forecast has negative weeks')
  return issues
}

function buildAccounts(world: World, ctx: SkuContext, settings: Settings): Acct[] {
  const markets = new Map(world.markets.map((m) => [m.id, m]))
  const dists = new Map(world.distributors.map((d) => [d.id, d]))
  return world.positions
    .filter((p) => p.skuId === ctx.sku.id)
    .map((pos) => {
      const market = markets.get(pos.marketId)!
      const dist = dists.get(market.distributorId)!
      const blended = blendDemand(pos, ctx.weights)
      const avgDaily = Math.max(MIN_RATE, sum(blended.slice(0, ctx.windowWeeks)) / (ctx.windowWeeks * 7))
      // In-transit arriving within a week counts as on hand. Later arrivals are "inbound":
      // they help reach the next run but don't count as stock on the floor today.
      const inTransitCounted = sum(
        pos.inTransit.filter((t) => t.arrivesInDays <= settings.inTransitOnHandDays).map((t) => t.qty),
      )
      const inboundBeforeRun = sum(
        pos.inTransit
          .filter((t) => t.arrivesInDays > settings.inTransitOnHandDays && t.arrivesInDays < ctx.daysToRun)
          .map((t) => t.qty),
      )
      const effOnHand = pos.onHand + inTransitCounted
      const priority = settings.priorityAccounts
        ? (settings.priorityAccounts[dist.id] ?? null)
        : (dist.priority ?? null)
      return {
        pos,
        market,
        dist,
        priority,
        avgDaily,
        effOnHand,
        inboundBeforeRun,
        inTransitCounted,
        dohToday: effOnHand / avgDaily,
        orderQty: sum(pos.openOrders.map((o) => o.qty)),
        transferIn: 0,
        transferOut: 0,
        dataIssues: findDataIssues(pos),
      }
    })
}

/** Open orders from markets with clean data (bad-data markets are set aside for review). */
const cleanOrders = (accts: Acct[]) => sum(accts.filter((a) => !a.dataIssues.length).map((a) => a.orderQty))

/** Cases that will be on hand or arriving before the run, before anything ships from on hand. */
const baseCases = (a: Acct) => a.effOnHand + a.inboundBeforeRun + a.transferIn - a.transferOut

// ---------------------------------------------------------------------------
// Step 7 (run first): transfers inside one distributor
// ---------------------------------------------------------------------------

/**
 * Runs BEFORE allocation because a transfer reduces how many on-hand cases the
 * short market needs, which frees supply for everyone else.
 * Rules: same distributor only; giver must be long (over the long threshold) and keeps
 * enough to reach the run plus buffer; receiver must be on track to run out before the run.
 */
function suggestTransfers(accts: Acct[], ctx: SkuContext, settings: Settings): Transfer[] {
  const transfers: Transfer[] = []
  const target = ctx.daysToRun + ctx.bufferDays
  const byDist = new Map<string, Acct[]>()
  // Markets with bad data never give or receive transfers.
  for (const a of accts.filter((x) => !x.dataIssues.length)) byDist.set(a.dist.id, [...(byDist.get(a.dist.id) ?? []), a])

  for (const group of byDist.values()) {
    if (group.length < 2) continue
    const longs = group
      .filter((a) => a.dohToday > settings.longThresholdDays)
      .sort((x, y) => y.dohToday - x.dohToday)
    const shorts = group
      .filter((a) => baseCases(a) / a.avgDaily < ctx.daysToRun)
      .sort((x, y) => baseCases(x) / x.avgDaily - baseCases(y) / y.avgDaily)
    for (const short of shorts) {
      for (const long of longs) {
        const gap = target * short.avgDaily - baseCases(short)
        const spare = long.effOnHand - long.transferOut - target * long.avgDaily
        const qty = Math.floor(Math.min(gap, spare))
        if (qty < settings.minTransferQty) continue
        long.transferOut += qty
        short.transferIn += qty
        transfers.push({
          distributorId: long.dist.id,
          distributorName: long.dist.name,
          fromMarketId: long.market.id,
          fromState: long.market.state,
          toMarketId: short.market.id,
          toState: short.market.state,
          qty,
          arrivesInDays: settings.transferLeadDays,
          reason:
            `${long.market.state} is long at ${days(long.dohToday)} on hand. ` +
            `${short.market.state} would run out in ${days((baseCases(short) - qty) / short.avgDaily)}, ` +
            `before the run lands in ${days(ctx.daysToRun)}. ` +
            `Moving ${cs(qty)} still leaves ${long.market.state} covered to the run plus the ${ctx.bufferDays}-day buffer. ` +
            `Arrives in ${settings.transferLeadDays} days.`,
        })
      }
    }
  }
  return transfers
}

// ---------------------------------------------------------------------------
// Step 6 core: "water-fill" spreading
// ---------------------------------------------------------------------------

export interface FillItem {
  id: string
  /** Cases already covering this market. */
  base: number
  /** Average daily demand. */
  rate: number
  /** Most cases we may give it (never more than it ordered). */
  cap: number
}

/**
 * Picture each market as a glass. Its water level is days of cover. We pour supply
 * into the emptiest glass until it matches the next-emptiest, then pour into both,
 * and so on. The result: low-cover markets get stock first, and everyone who gets
 * stock ends at roughly the same days of cover (unless they hit their order cap).
 *
 * Math: find level L (days) where sum of min(cap, max(0, L*rate - base)) = supply.
 * We search for L by halving the range 100 times, then round to whole cases.
 */
export function waterFill(items: FillItem[], supply: number): { ships: Map<string, number>; level: number | null } {
  const ships = new Map(items.map((i) => [i.id, 0]))
  const live = items.filter((i) => i.cap > 0)
  const avail = Math.floor(Math.max(0, supply))
  if (avail <= 0 || !live.length) return { ships, level: null }

  if (sum(live.map((i) => i.cap)) <= avail) {
    for (const i of live) ships.set(i.id, i.cap)
    return { ships, level: null }
  }

  const rate = (i: FillItem) => Math.max(i.rate, MIN_RATE)
  const give = (L: number, i: FillItem) => clamp(L * rate(i) - i.base, 0, i.cap)
  let lo = 0
  let hi = Math.max(...live.map((i) => (i.base + i.cap) / rate(i)))
  for (let k = 0; k < 100; k++) {
    const mid = (lo + hi) / 2
    if (sum(live.map((i) => give(mid, i))) > avail) hi = mid
    else lo = mid
  }
  const level = lo

  // Round down to whole cases, then hand leftover cases to the biggest fractions.
  const raw = live.map((i) => ({ i, x: give(level, i) }))
  let left = avail
  for (const r of raw) {
    const f = Math.floor(r.x)
    ships.set(r.i.id, f)
    left -= f
  }
  raw.sort((a, b) => (b.x % 1) - (a.x % 1))
  for (const r of raw) {
    if (left <= 0) break
    const cur = ships.get(r.i.id)!
    if (cur < r.i.cap) {
      ships.set(r.i.id, cur + 1)
      left--
    }
  }
  return { ships, level }
}

/**
 * Fair share: every market gets the same percentage of what it asked for.
 * Simple and easy to defend contractually, but it ignores how close each market is
 * to running out. Rounds down to whole cases, then hands leftovers to the biggest fractions.
 */
export function fairShare(items: FillItem[], supply: number): { ships: Map<string, number>; pct: number | null } {
  const ships = new Map(items.map((i) => [i.id, 0]))
  const live = items.filter((i) => i.cap > 0)
  const avail = Math.floor(Math.max(0, supply))
  const totalCap = sum(live.map((i) => i.cap))
  if (avail <= 0 || !totalCap) return { ships, pct: avail <= 0 && totalCap ? 0 : null }
  const pct = Math.min(1, avail / totalCap)
  const raw = live.map((i) => ({ i, x: i.cap * pct }))
  let left = avail
  for (const r of raw) {
    const f = Math.min(r.i.cap, Math.floor(r.x))
    ships.set(r.i.id, f)
    left -= f
  }
  raw.sort((a, b) => (b.x % 1) - (a.x % 1))
  for (const r of raw) {
    if (left <= 0) break
    const cur = ships.get(r.i.id)!
    if (cur < r.i.cap) {
      ships.set(r.i.id, cur + 1)
      left--
    }
  }
  return { ships, pct }
}

// ---------------------------------------------------------------------------
// Steps 3 to 6: the allocation itself
// ---------------------------------------------------------------------------

type Rule = AccountLine['rule']

interface AllocResult {
  ship: Map<string, number>
  rule: Map<string, Rule>
  level: number | null
  /** Share of each order filled, when the fair-share policy ran. */
  fairPct: number | null
  supplyAfterLocks: number
}

function allocate(accts: Acct[], ctx: SkuContext, settings: Settings, overrides: Overrides): AllocResult {
  const ship = new Map<string, number>(accts.map((a) => [a.market.id, 0]))
  const rule = new Map<string, Rule>()
  const id = (a: Acct) => a.market.id
  const isShort = ctx.sku.availableNow < cleanOrders(accts)

  // Planner overrides are locked first and come off the top of supply.
  let supply = ctx.sku.availableNow
  for (const a of accts) {
    if (overrides[id(a)] !== undefined) {
      const q = Math.max(0, Math.round(overrides[id(a)]))
      ship.set(id(a), q)
      rule.set(id(a), 'OVERRIDE')
      supply -= q
    }
  }
  const supplyAfterLocks = supply
  // Bad data: ship nothing automatically (a planner override above still wins).
  for (const a of accts) if (a.dataIssues.length && !rule.has(id(a))) rule.set(id(a), 'DATA ISSUE')
  const open = accts.filter((a) => !rule.has(id(a)))
  for (const a of open) if (a.orderQty <= 0) rule.set(id(a), 'NO ORDER')
  const ordering = open.filter((a) => a.orderQty > 0)

  // No shortage: everyone ships in full.
  if (!isShort) {
    for (const a of ordering) {
      ship.set(id(a), a.orderQty)
      rule.set(id(a), 'FULL')
    }
    return { ship, rule, level: null, fairPct: null, supplyAfterLocks }
  }

  const alwaysFirst = settings.priorityRule === 'always_first'

  // Step 5: hold orders for markets already covered to the run plus buffer
  // (if the customer holds at all; an "always first" priority account is never held).
  const holdLine = ctx.daysToRun + ctx.bufferDays
  const held = settings.holdCoveredMarkets
    ? ordering.filter((a) => baseCases(a) / a.avgDaily >= holdLine && !(alwaysFirst && a.priority))
    : []
  for (const a of held) rule.set(id(a), 'HOLD')
  const candidates = ordering.filter((a) => !held.includes(a))

  // Step 6a: priority accounts jump the line.
  //  - only_when_at_risk: only if they would run out before the run, and only up to what
  //    gets them to the run date (not the buffer), capped at what they ordered.
  //  - always_first: every priority account is filled first, up to its full order.
  // If supply can't cover them all, they share it toward equal days of cover.
  const priorityFirst = candidates.filter(
    (a) => a.priority && (alwaysFirst || baseCases(a) / a.avgDaily < ctx.daysToRun),
  )
  const pItems: FillItem[] = priorityFirst.map((a) => ({
    id: id(a),
    base: baseCases(a),
    rate: a.avgDaily,
    cap: alwaysFirst ? a.orderQty : Math.min(a.orderQty, Math.ceil(ctx.daysToRun * a.avgDaily - baseCases(a))),
  }))
  const pFill = waterFill(pItems, supply)
  for (const a of priorityFirst) {
    const q = pFill.ships.get(id(a)) ?? 0
    ship.set(id(a), q)
    if (q > 0) rule.set(id(a), 'PRIORITY')
    supply -= q
  }

  // Steps 4 + 6b: split what's left across all candidates, using the customer's policy.
  //  - equal_days_of_cover: lowest cover first, rising together (water-fill)
  //  - fair_share: everyone gets the same percentage of what they still need
  const items: FillItem[] = candidates.map((a) => ({
    id: id(a),
    base: baseCases(a) + ship.get(id(a))!,
    rate: a.avgDaily,
    cap: a.orderQty - ship.get(id(a))!,
  }))
  const fair = settings.allocationPolicy === 'fair_share'
  const fill = fair ? { ...fairShare(items, supply), level: null } : { ...waterFill(items, supply), pct: null }
  for (const a of candidates) {
    const q = fill.ships.get(id(a)) ?? 0
    ship.set(id(a), ship.get(id(a))! + q)
    supply -= q
    if (!rule.has(id(a))) rule.set(id(a), fair ? 'FAIR SHARE' : 'SPREAD')
  }

  // Anything still left (rare) is released to held orders, spread the same way.
  if (supply > 0 && held.length) {
    const hFill = waterFill(
      held.map((a) => ({ id: id(a), base: baseCases(a), rate: a.avgDaily, cap: a.orderQty })),
      supply,
    )
    for (const a of held) {
      const q = hFill.ships.get(id(a)) ?? 0
      if (q > 0) {
        ship.set(id(a), q)
        rule.set(id(a), 'RELEASED')
        supply -= q
      }
    }
  }

  return { ship, rule, level: fill.level, fairPct: fill.pct, supplyAfterLocks }
}

// ---------------------------------------------------------------------------
// Step 3: which orders get backordered (earliest requested fills first)
// ---------------------------------------------------------------------------

function fillOrders(pos: Position, shipQty: number): OrderFill[] {
  let left = shipQty
  return [...pos.openOrders]
    .sort((a, b) => a.requestedWeek - b.requestedWeek || a.id.localeCompare(b.id))
    .map((o) => {
      const filled = Math.max(0, Math.min(o.qty, left))
      left -= filled
      return { id: o.id, qty: o.qty, requestedWeek: o.requestedWeek, filled, backordered: o.qty - filled }
    })
}

// ---------------------------------------------------------------------------
// Public entry point: plan one SKU
// ---------------------------------------------------------------------------

export function planSku(
  world: World,
  skuId: string,
  settings: Settings = DEFAULT_SETTINGS,
  overrides: Overrides = {},
): Plan {
  const sku = world.skus.find((s) => s.id === skuId)
  if (!sku) throw new Error(`Unknown SKU ${skuId}`)
  const ctx = skuContext(world, sku, settings)
  const accts = buildAccounts(world, ctx, settings)
  const totalOrders = cleanOrders(accts)
  const isShort = sku.availableNow < totalOrders

  const transfers = isShort && settings.transfersEnabled ? suggestTransfers(accts, ctx, settings) : []
  const recommended = allocate(accts, ctx, settings, {})
  const current = Object.keys(overrides).length ? allocate(accts, ctx, settings, overrides) : recommended

  const runDateTxt = fmtDate(ctx.runDate)
  const holdLine = ctx.daysToRun + ctx.bufferDays

  const lines: AccountLine[] = accts.map((a) => {
    const id = a.market.id
    const ship = current.ship.get(id) ?? 0
    const recommendedShip = recommended.ship.get(id) ?? 0
    const rule = current.rule.get(id) ?? 'NO ORDER'
    const coverBefore = baseCases(a) / a.avgDaily
    const coverAfter = (baseCases(a) + ship) / a.avgDaily
    const backorderQty = Math.max(0, a.orderQty - ship)
    // Stockout risk only means something when the SKU is short. If on hand can fill every
    // open order, it can also fill the market's next order, so low cover is not a shortage problem.
    const badData = a.dataIssues.length > 0
    const stockoutBeforeRun = isShort && !badData && coverAfter < ctx.daysToRun
    const reasons: string[] = []

    if (badData && rule === 'DATA ISSUE') {
      reasons.push(`Data issue: ${a.dataIssues.join('; ')}.`)
      reasons.push(
        'This market was left out of the allocation rather than guessing. Supply went to the other markets. Fix the data or set a quantity by hand.',
      )
    }

    // Starting position (skipped when the data can't be trusted)
    if (!badData) {
    reasons.push(`Demand: about ${a.avgDaily.toFixed(1)} cs/day (blended forecast over the next ${ctx.windowWeeks} weeks).`)
    reasons.push(
      `On hand: ${cs(a.effOnHand)}${a.inTransitCounted ? ` (includes ${cs(a.inTransitCounted)} arriving within ${settings.inTransitOnHandDays} days)` : ''} = ${days(a.dohToday)} on hand.`,
    )
    if (a.inboundBeforeRun) reasons.push(`Plus ${cs(a.inboundBeforeRun)} inbound later, before the run (not counted as on hand).`)
    if (a.transferIn) reasons.push(`Receives a ${cs(a.transferIn)} intracompany transfer from another of this distributor's markets (arrives in ${settings.transferLeadDays} days).`)
    if (a.transferIn && a.dohToday < settings.transferLeadDays)
      reasons.push(
        `Watch: only ${days(a.dohToday)} on hand and the transfer lands in ${settings.transferLeadDays}, so about ${days(settings.transferLeadDays - a.dohToday)} at risk unless stock arrives sooner.`,
      )
    if (a.transferOut) reasons.push(`Sends a ${cs(a.transferOut)} intracompany transfer to another of this distributor's markets that is short.`)
    }

    // Decision
    switch (rule) {
      case 'FULL':
        reasons.push('Enough supply to fill every open order on this SKU, so it ships in full.')
        break
      case 'HOLD':
        reasons.push(
          `Held: ${days(coverBefore)} of cover already reaches the next run (${days(ctx.daysToRun)}) plus the ${ctx.bufferDays}-day buffer = ${days(holdLine)}. Supply goes to markets that would run out.`,
        )
        break
      case 'RELEASED':
        reasons.push(`Covered past the run plus buffer, but supply was left after everyone else, so ${cs(ship)} released.`)
        break
      case 'PRIORITY':
        if (settings.priorityRule === 'always_first')
          reasons.push(
            `${a.priority}: customer rule serves priority accounts first, up to the full order, whatever their cover (${days(coverBefore)} today).`,
          )
        else
          reasons.push(
            `${a.priority} at stockout risk: would run out in ${days(coverBefore)}, ${days(ctx.daysToRun - coverBefore)} before the run. Served first, up to what gets it to the run date.`,
          )
        break
      case 'FAIR SHARE':
        reasons.push(
          `Customer contract: every market that needs stock gets the same share of its order (${current.fairPct !== null ? Math.round(current.fairPct * 100) + '%' : 'n/a'}). This market gets ${cs(ship)} of ${cs(a.orderQty)} ordered, whatever its cover.`,
        )
        break
      case 'SPREAD':
        if (ship >= a.orderQty) reasons.push(`Low enough cover to need stock, and the spread reached its full order.`)
        else if (ship > 0)
          reasons.push(
            `Supply spread across low-cover markets so they end at about the same cover (${current.level !== null ? days(current.level) : 'n/a'}). This market gets ${cs(ship)} of ${cs(a.orderQty)} ordered.`,
          )
        else
          reasons.push(
            `Has more cover (${days(coverBefore)}) than the level supply could lift others to (${current.level !== null ? days(current.level) : 'n/a'}), so nothing ships yet.`,
          )
        break
      case 'OVERRIDE':
        reasons.push(`Quantity set by planner: ${cs(ship)} (engine recommended ${cs(recommendedShip)}).`)
        break
      case 'NO ORDER':
        reasons.push('No open order on this SKU.')
        if (isShort && coverBefore < ctx.daysToRun)
          reasons.push(
            `But it would run out in about ${days(coverBefore)}, before the run on ${runDateTxt}. Worth a call: an order placed now would be backordered.`,
          )
        break
    }

    // Outcome
    if (!badData && (a.orderQty > 0 || a.transferIn || a.transferOut)) {
      if (stockoutBeforeRun)
        reasons.push(
          `After plan: ${days(coverAfter)} of cover. Projected to run out around ${fmtDate(addDays(world.asOf, Math.floor(coverAfter)))}, ${days(ctx.daysToRun - coverAfter)} before the next available supply on ${runDateTxt}.`,
        )
      else reasons.push(`After plan: ${days(coverAfter)} of cover, which reaches the run on ${runDateTxt}.`)
    }
    if (backorderQty > 0)
      reasons.push(`${cs(backorderQty)} backordered. Expected to ship when the run lands on ${runDateTxt} (about ${days(ctx.daysToRun)} from today).`)

    let action: AccountLine['action']
    if (rule === 'DATA ISSUE') action = 'REVIEW'
    else if (a.orderQty <= 0) action = 'NO ORDER'
    else if (ship <= 0) action = 'HOLD'
    else if (ship < a.orderQty) action = 'PARTIAL'
    else action = 'SHIP'

    return {
      marketId: id,
      distributorId: a.dist.id,
      distributorName: a.dist.name,
      state: a.market.state,
      priority: a.priority,
      avgDaily: a.avgDaily,
      effOnHand: a.effOnHand,
      inboundBeforeRun: a.inboundBeforeRun,
      dohToday: a.dohToday,
      orderQty: a.orderQty,
      transferIn: a.transferIn,
      transferOut: a.transferOut,
      coverBefore,
      recommendedShip,
      ship,
      overridden: rule === 'OVERRIDE',
      backorderQty,
      coverAfter,
      stockoutBeforeRun,
      rule,
      action,
      reasons,
      orders: fillOrders(a.pos, ship),
      dataIssues: a.dataIssues,
    }
  })

  // Step 4: rank lowest cover first (markets without orders sink to the bottom).
  lines.sort((x, y) => Number(x.orderQty <= 0) - Number(y.orderQty <= 0) || x.coverBefore - y.coverBefore)

  const shipped = sum(lines.map((l) => l.ship))
  const relevant = lines.filter((l) => l.orderQty > 0 || l.transferIn || l.transferOut)
  const summary: SkuSummary = {
    skuId: sku.id,
    name: sku.name,
    category: sku.category,
    isShort,
    openOrderQty: totalOrders,
    availableNow: sku.availableNow,
    gapQty: Math.max(0, totalOrders - sku.availableNow),
    fillRate: totalOrders ? Math.min(1, sku.availableNow / totalOrders) : 1,
    daysToRun: ctx.daysToRun,
    runDate: ctx.runDate,
    runQty: sku.nextRun.qty,
    bufferDays: ctx.bufferDays,
    bufferWhy: ctx.bufferWhy,
    cv: ctx.cv,
    highVelocity: ctx.highVelocity,
    // "If nothing shipped from on hand, how many markets would run out before the run?"
    marketsAtRiskBefore: isShort
      ? lines.filter((l) => l.orderQty > 0 && !l.dataIssues.length && (l.effOnHand + l.inboundBeforeRun) / l.avgDaily < ctx.daysToRun).length
      : 0,
    marketsAtRiskAfter: relevant.filter((l) => l.stockoutBeforeRun).length,
    // For each market that runs dry: days without stock before the run x cases per day.
    demandAtRiskCases: Math.round(
      sum(relevant.filter((l) => l.stockoutBeforeRun).map((l) => (ctx.daysToRun - l.coverAfter) * l.avgDaily)),
    ),
    backorderQty: sum(lines.filter((l) => !l.dataIssues.length).map((l) => l.backorderQty)),
    transferCount: transfers.length,
  }

  return {
    summary,
    lines,
    transfers,
    unallocated: Math.max(0, sku.availableNow - shipped),
    overAllocated: Math.max(0, shipped - sku.availableNow),
    spreadLevelDays: current.level,
    fairSharePct: current.fairPct,
  }
}

/** Overview screen: one summary per SKU, short SKUs first. */
export function summarizeAll(world: World, settings: Settings = DEFAULT_SETTINGS): SkuSummary[] {
  return world.skus
    .map((s) => planSku(world, s.id, settings).summary)
    .sort((a, b) => Number(b.isShort) - Number(a.isShort) || a.fillRate - b.fillRate)
}
