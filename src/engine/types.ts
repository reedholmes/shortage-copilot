// Data shapes shared by the seed script, the allocation engine and the UI.
// All quantities are 9L cases. All "weeks" are weekly buckets starting at World.asOf.

export interface InTransit {
  qty: number
  /** Days from the as-of date until this shipment arrives at the distributor. */
  arrivesInDays: number
}

export interface OpenOrder {
  id: string
  qty: number
  /** Week (0 = this week) the distributor asked for the order to ship. */
  requestedWeek: number
}

export type PriorityType = 'National account' | 'Key distributor' | null

export interface Distributor {
  id: string
  name: string
  /** Only used when no customer config supplies a priority list (unit tests). */
  priority?: PriorityType
}

/** One distributor operating in one state. A distributor can have several markets. */
export interface Market {
  id: string
  distributorId: string
  state: string
}

export interface Sku {
  id: string
  name: string
  category: string
  /** Cases at the plant, free to ship today. */
  availableNow: number
  nextRun: {
    /** Weeks from the as-of date until the next production run lands at distributors. */
    inWeeks: number
    qty: number
  }
}

/** One SKU in one market: the planner's row-level inputs. */
export interface Position {
  skuId: string
  marketId: string
  onHand: number
  inTransit: InTransit[]
  /** Our shipments to the distributor, by week (13 values). */
  shipFcst: number[]
  /** The distributor's sales to retail, by week (13 values). */
  depFcst: number[]
  openOrders: OpenOrder[]
}

export interface Scenario {
  skuId: string
  title: string
  story: string
}

export interface World {
  asOf: string
  horizonWeeks: number
  skus: Sku[]
  distributors: Distributor[]
  markets: Market[]
  positions: Position[]
  scenarios: Scenario[]
}

/**
 * Every planning knob in one place. Built from a customer config file
 * (see src/engine/customerConfig.ts). The UI exposes the blend slider.
 */
export interface Settings {
  /** How plant supply is split among markets that need it. */
  allocationPolicy: 'equal_days_of_cover' | 'fair_share'
  /** Hold orders for markets already covered past the run plus buffer. */
  holdCoveredMarkets: boolean
  /** When priority accounts jump the line. */
  priorityRule: 'only_when_at_risk' | 'always_first'
  /** Distributor id -> priority tier. If absent, the distributor's own tag is used. */
  priorityAccounts?: Record<string, Exclude<PriorityType, null>>
  transfersEnabled: boolean
  /** Depletion weight in week 1. It slides linearly to (1 - this) by the last week. */
  nearDepletionWeight: number
  baseBufferDays: number
  highVelocityExtraDays: number
  highVariabilityExtraDays: number
  /** Coefficient of variation above which a SKU counts as "volatile". */
  highVariabilityCv: number
  /** Days on hand above which a market is "long". */
  longThresholdDays: number
  transferLeadDays: number
  /** In-transit arriving within this many days counts as on hand. */
  inTransitOnHandDays: number
  /** Ignore transfers smaller than this (not worth a truck). */
  minTransferQty: number
}

export type Action = 'SHIP' | 'PARTIAL' | 'HOLD' | 'NO ORDER' | 'REVIEW'

export interface OrderFill {
  id: string
  qty: number
  requestedWeek: number
  filled: number
  backordered: number
}

export interface AccountLine {
  marketId: string
  distributorId: string
  distributorName: string
  state: string
  priority: PriorityType
  avgDaily: number
  effOnHand: number
  inboundBeforeRun: number
  dohToday: number
  orderQty: number
  transferIn: number
  transferOut: number
  /** Days of cover before any plant shipment (includes inbound and transfers). */
  coverBefore: number
  recommendedShip: number
  ship: number
  overridden: boolean
  backorderQty: number
  coverAfter: number
  stockoutBeforeRun: boolean
  /** The rule that decided this line. */
  rule: 'FULL' | 'HOLD' | 'PRIORITY' | 'SPREAD' | 'FAIR SHARE' | 'RELEASED' | 'OVERRIDE' | 'NO ORDER' | 'DATA ISSUE'
  action: Action
  reasons: string[]
  /** Problems found in this market's input data. If any, nothing ships until a human reviews it. */
  dataIssues: string[]
  orders: OrderFill[]
}

export interface Transfer {
  distributorId: string
  distributorName: string
  fromMarketId: string
  fromState: string
  toMarketId: string
  toState: string
  qty: number
  arrivesInDays: number
  reason: string
}

export interface SkuSummary {
  skuId: string
  name: string
  category: string
  isShort: boolean
  openOrderQty: number
  availableNow: number
  gapQty: number
  fillRate: number
  daysToRun: number
  runDate: string
  runQty: number
  bufferDays: number
  bufferWhy: string[]
  cv: number
  highVelocity: boolean
  marketsAtRiskBefore: number
  marketsAtRiskAfter: number
  /** Cases of consumer demand that go unserved before the run lands (lost-sales risk). */
  demandAtRiskCases: number
  backorderQty: number
  transferCount: number
}

export interface Plan {
  summary: SkuSummary
  lines: AccountLine[]
  transfers: Transfer[]
  /** Plant cases left unshipped. */
  unallocated: number
  /** Cases shipped beyond what the plant has (only possible through overrides). */
  overAllocated: number
  /** Common cover level (days) reached by the spread step, if it ran. */
  spreadLevelDays: number | null
  /** Share of each order filled, when the customer uses the fair-share policy. */
  fairSharePct: number | null
}
