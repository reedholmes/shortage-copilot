/**
 * CUSTOMER CONFIGS
 * ================
 * Each customer's operating rules live in a JSON file in /config, not in the code.
 * This module checks every file against a strict format when it loads (a typo or a
 * missing rule fails loudly instead of quietly changing allocations), then turns the
 * business-readable rules into the engine's Settings.
 *
 * To onboard a new customer: copy a config file, change the rules, add it to CUSTOMERS.
 */
import { z } from 'zod'
import acmeJson from '../../config/customer_acme_beverage.json'
import bluestoneJson from '../../config/customer_bluestone_spirits.json'
import type { Settings } from './types'

const days = z.number().int().min(0).max(365)

export const CustomerConfigSchema = z
  .object({
    customer: z.object({
      id: z.string().regex(/^[a-z0-9_]+$/),
      name: z.string().min(1),
      summary: z.string().min(1),
    }),
    forecast: z.object({
      depletionWeightWeek1: z.number().min(0.5).max(1),
      inTransitCountsAsOnHandWithinDays: days,
    }),
    allocation: z.object({
      policy: z.enum(['equal_days_of_cover', 'fair_share']),
      holdMarketsCoveredPastRun: z.boolean(),
    }),
    safetyBuffer: z.object({
      minimumDaysPastRun: days,
      highVelocityExtraDays: days,
      volatileDemandExtraDays: days,
      volatileDemandThreshold: z.number().min(0).max(5),
    }),
    priorityAccounts: z.object({
      rule: z.enum(['only_when_at_risk', 'always_first']),
      accounts: z.array(
        z.object({
          distributorId: z.string(),
          name: z.string(),
          tier: z.enum(['National account', 'Key distributor']),
        }),
      ),
    }),
    transfers: z.object({
      enabled: z.boolean(),
      longThresholdDays: days,
      leadTimeDays: days,
      minimumCases: z.number().int().min(0),
    }),
    approval: z.object({
      priorityAccounts: z.boolean(),
      transfers: z.boolean(),
      fillRateBelow: z.number().min(0).max(1),
      lineOverCases: z.number().int().min(0),
    }),
    customerEmail: z.object({
      tone: z.string().min(1).max(60),
      signOff: z.string().min(1).max(60),
    }),
  })
  .strict()

export type CustomerConfig = z.infer<typeof CustomerConfigSchema>

/** Parse and check one config. Throws a readable error naming the bad field. */
export function loadConfig(raw: unknown, label = 'config'): CustomerConfig {
  const result = CustomerConfigSchema.safeParse(raw)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
    throw new Error(`Invalid customer config ${label}: ${issues}`)
  }
  return result.data
}

/** Turn business rules into the engine's settings. */
export function settingsFromConfig(c: CustomerConfig): Settings {
  return {
    allocationPolicy: c.allocation.policy,
    holdCoveredMarkets: c.allocation.holdMarketsCoveredPastRun,
    priorityRule: c.priorityAccounts.rule,
    priorityAccounts: Object.fromEntries(c.priorityAccounts.accounts.map((a) => [a.distributorId, a.tier])),
    transfersEnabled: c.transfers.enabled,
    nearDepletionWeight: c.forecast.depletionWeightWeek1,
    baseBufferDays: c.safetyBuffer.minimumDaysPastRun,
    highVelocityExtraDays: c.safetyBuffer.highVelocityExtraDays,
    highVariabilityExtraDays: c.safetyBuffer.volatileDemandExtraDays,
    highVariabilityCv: c.safetyBuffer.volatileDemandThreshold,
    longThresholdDays: c.transfers.longThresholdDays,
    transferLeadDays: c.transfers.leadTimeDays,
    inTransitOnHandDays: c.forecast.inTransitCountsAsOnHandWithinDays,
    minTransferQty: c.transfers.minimumCases,
  }
}

/** Every customer the demo knows about, in display order. */
export const CUSTOMERS: CustomerConfig[] = [
  loadConfig(acmeJson, 'customer_acme_beverage.json'),
  loadConfig(bluestoneJson, 'customer_bluestone_spirits.json'),
]
export type CustomerId = string
export const DEFAULT_CUSTOMER_ID = CUSTOMERS[0].customer.id

export function getCustomer(id: CustomerId): CustomerConfig {
  const c = CUSTOMERS.find((x) => x.customer.id === id)
  if (!c) throw new Error(`Unknown customer ${id}`)
  return c
}
