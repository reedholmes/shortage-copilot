/**
 * The facts a customer note is allowed to state, computed by the allocation engine.
 * Shared by the browser (to show "facts sent to the AI") and the server (which
 * recomputes them itself, so a visitor can't slip made-up facts or text to the AI).
 */
import { addDays, planSku } from './allocation'
import type { Overrides } from './allocation'
import type { Settings, World } from './types'

export interface NoteFacts {
  distributor: string
  market: string
  sku: string
  orderedCases: number
  shippingNowCases: number
  backorderedCases: number
  nextAvailableSupply: string
  daysOrdersWillSit: number
  incomingTransfer?: { cases: number; fromMarket: string; arrivesInDays: number }
}

function longDate(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** Returns null when the market has nothing backordered (no note needed). */
export function buildNoteFacts(
  world: World,
  skuId: string,
  marketId: string,
  settings: Settings,
  overrides: Overrides = {},
): NoteFacts | null {
  const sku = world.skus.find((s) => s.id === skuId)
  if (!sku) return null
  const plan = planSku(world, skuId, settings, overrides)
  const line = plan.lines.find((l) => l.marketId === marketId)
  if (!line || line.backorderQty <= 0) return null
  const transfer = plan.transfers.find((t) => t.toMarketId === marketId)
  return {
    distributor: line.distributorName,
    market: line.state,
    sku: sku.name,
    orderedCases: line.orderQty,
    shippingNowCases: line.ship,
    backorderedCases: line.backorderQty,
    nextAvailableSupply: longDate(addDays(world.asOf, plan.summary.daysToRun)),
    daysOrdersWillSit: plan.summary.daysToRun,
    ...(transfer && {
      incomingTransfer: { cases: transfer.qty, fromMarket: transfer.fromState, arrivesInDays: transfer.arrivesInDays },
    }),
  }
}
