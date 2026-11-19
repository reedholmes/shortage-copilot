/**
 * THE AGENT'S SIX TOOLS
 * =====================
 * Each tool is a thin, read-only window onto the tested allocation engine. The agent
 * chooses which to call and says why; the numbers always come from here.
 *
 * Guardrails built into the tools themselves:
 *  - No tool accepts a quantity. The agent cannot change an allocation, only read it.
 *  - A run is scoped to one shortage event (one SKU). Asking about another SKU is refused.
 *  - draft_customer_note works only after propose_allocation, only for lines that
 *    auto-execute (lines waiting for approval may still change), and at most twice a run.
 */
import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { fmtDate, planSku } from '../src/engine/allocation'
import { routeApprovals } from '../src/engine/approvals'
import type { Routing } from '../src/engine/approvals'
import type { CustomerConfig } from '../src/engine/customerConfig'
import { settingsFromConfig } from '../src/engine/customerConfig'
import { buildNoteFacts } from '../src/engine/noteFacts'
import type { NoteFacts } from '../src/engine/noteFacts'
import type { NoteDraft, TraceStep, TraceTable } from '../src/engine/agentTypes'
import type { Plan, World } from '../src/engine/types'

export type NoteStyle = { tone: string; signOff: string }
/** Drafts one note. Supplied by the caller so tests can run without the AI. */
export type DraftFn = (facts: NoteFacts, style: NoteStyle) => Promise<{ draft: NoteDraft; source: 'ai' | 'cache' | 'template' }>

const MAX_NOTES = 2
const reason = { type: 'string', description: 'One sentence, for the planner, on why you are calling this tool now.' } as const
const skuId = { type: 'string', description: 'The SKU id of this shortage event.' } as const

const skuTool = (name: string, description: string): Anthropic.Beta.BetaTool => ({
  name,
  description,
  strict: true,
  input_schema: { type: 'object', properties: { sku_id: skuId, reason }, required: ['sku_id', 'reason'], additionalProperties: false },
})

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  skuTool('get_inventory', 'Cases on hand to ship now, the next production run, and each distributor market\'s on-hand and in-transit stock. Flags bad inventory data.'),
  skuTool('get_forecast', 'Each market\'s blended daily demand (depletions near term, shipments further out), using the customer\'s forecast settings.'),
  skuTool('get_open_orders', 'Open orders by market and in total, compared with on hand. Tells you whether this is really a shortage.'),
  skuTool('calc_days_on_hand', 'Days on hand today and days of cover until the run for every market, and which markets would run out before the next available supply.'),
  skuTool(
    'propose_allocation',
    "Runs the customer's configured allocation rules and returns the recommended plan, any intracompany transfers, and which lines must go to a human for approval. Quantities come only from this tool and cannot be changed.",
  ),
  {
    name: 'draft_customer_note',
    description:
      'Drafts the out-of-stock email for one backordered market, in the customer\'s configured tone. Only for markets whose line auto-executes. Call after propose_allocation; at most 2 per run.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { market_id: { type: 'string', description: 'Market id from propose_allocation, e.g. "D15-FL".' }, reason },
      required: ['market_id', 'reason'],
      additionalProperties: false,
    },
  },
]

const SkuInput = z.object({ sku_id: z.string(), reason: z.string() })
const NoteInput = z.object({ market_id: z.string(), reason: z.string() })

export interface ToolResult {
  /** What the model reads (compact JSON). */
  content: string
  step: Omit<TraceStep, 'n'>
}

const r1 = (x: number) => Math.round(x * 10) / 10
const r0 = (x: number) => Math.round(x)

/**
 * One agent run's tool belt. The plan is computed once, up front, with the customer's
 * rules; the tools reveal it piece by piece in whatever order the agent asks.
 */
export class AgentSession {
  readonly plan: Plan
  readonly routing: Routing
  private proposed = false
  private notes = 0

  constructor(
    private world: World,
    readonly config: CustomerConfig,
    readonly skuId: string,
    private draft: DraftFn,
  ) {
    this.plan = planSku(world, skuId, settingsFromConfig(config))
    this.routing = routeApprovals(this.plan, config)
  }

  get skuName() {
    return this.world.skus.find((s) => s.id === this.skuId)!.name
  }

  async execute(name: string, rawInput: unknown): Promise<ToolResult> {
    const input = (rawInput ?? {}) as Record<string, unknown>
    const fail = (msg: string): ToolResult => ({
      content: JSON.stringify({ error: msg }),
      step: { tool: name, reason: String(input.reason ?? ''), input, summary: msg, isError: true },
    })
    if (name === 'draft_customer_note') {
      const p = NoteInput.safeParse(input)
      return p.success ? this.draftNote(p.data.market_id, p.data.reason) : fail('Invalid input')
    }
    const p = SkuInput.safeParse(input)
    if (!p.success) return fail('Invalid input')
    if (p.data.sku_id !== this.skuId) return fail(`This run is scoped to ${this.skuId}. Other SKUs are out of bounds.`)
    const readers: Record<string, () => { content: string; step: Pick<TraceStep, 'summary' | 'table'> }> = {
      get_inventory: () => this.inventory(),
      get_forecast: () => this.forecast(),
      get_open_orders: () => this.orders(),
      calc_days_on_hand: () => this.daysOnHand(),
      propose_allocation: () => {
        this.proposed = true
        return this.proposal()
      },
    }
    const read = readers[name]
    if (!read) return fail(`Unknown tool ${name}`)
    const r = read()
    return { content: r.content, step: { tool: name, reason: p.data.reason, input, ...r.step } }
  }

  private lines() {
    return this.plan.lines
  }

  private inventory(): { content: string; step: Pick<TraceStep, 'summary' | 'table'> } {
    const s = this.plan.summary
    const bad = this.lines().filter((l) => l.dataIssues.length)
    const rows = this.lines().map((l) => ({
      market: l.marketId,
      distributor: l.distributorName,
      on_hand_incl_7day_transit: r0(l.effOnHand),
      inbound_later: r0(l.inboundBeforeRun),
      ...(l.dataIssues.length && { data_issue: l.dataIssues.join('; ') }),
    }))
    const summary =
      `${s.availableNow.toLocaleString()} cs on hand to ship now; next run of ${s.runQty.toLocaleString()} cs lands ${fmtDate(s.runDate)} (${s.daysToRun} days).` +
      (bad.length ? ` Data issue in ${bad.map((l) => l.marketId).join(', ')}.` : '')
    return {
      content: JSON.stringify({ on_hand_to_ship_now: s.availableNow, next_run: { lands: s.runDate, in_days: s.daysToRun, qty: s.runQty }, markets: rows }),
      step: { summary, table: table(['Market', 'Distributor on hand', 'Inbound later'], this.lines().map((l) => [label(l), r0(l.effOnHand), r0(l.inboundBeforeRun)])) },
    }
  }

  private forecast() {
    const w = this.config.forecast.depletionWeightWeek1
    const total = this.lines().reduce((a, l) => a + (l.dataIssues.length ? 0 : l.avgDaily), 0)
    return {
      content: JSON.stringify({
        blend: `${Math.round(w * 100)}% depletions in week 1 sliding to ${Math.round((1 - w) * 100)}% by week 13`,
        markets: this.lines().map((l) => ({ market: l.marketId, cases_per_day: r1(l.avgDaily) })),
      }),
      step: {
        summary: `Network demand about ${r0(total)} cs/day across ${this.lines().length} markets (blend ${Math.round(w * 100)}% depletions in week 1).`,
        table: table(['Market', 'Cs/day'], this.lines().map((l) => [label(l), r1(l.avgDaily)])),
      },
    }
  }

  private orders() {
    const s = this.plan.summary
    const ordering = this.lines().filter((l) => l.orderQty > 0)
    return {
      content: JSON.stringify({
        total_open_orders: s.openOrderQty,
        on_hand_to_ship_now: s.availableNow,
        is_shortage: s.isShort,
        fill_rate_possible: Math.round(s.fillRate * 100) / 100,
        markets: ordering.map((l) => ({ market: l.marketId, ordered: l.orderQty })),
      }),
      step: {
        summary: s.isShort
          ? `${s.openOrderQty.toLocaleString()} cs ordered vs ${s.availableNow.toLocaleString()} on hand: a real shortage, ${Math.round(s.fillRate * 100)}% fill possible.`
          : `Supply covers all ${s.openOrderQty.toLocaleString()} cs ordered. No shortage.`,
        table: table(['Market', 'Ordered'], ordering.map((l) => [label(l), l.orderQty])),
      },
    }
  }

  private daysOnHand() {
    const s = this.plan.summary
    const atRisk = this.lines().filter((l) => l.orderQty > 0 && !l.dataIssues.length && l.coverBefore < s.daysToRun)
    return {
      content: JSON.stringify({
        days_until_run: s.daysToRun,
        safety_buffer_days: s.bufferDays,
        markets: this.lines().map((l) => ({
          market: l.marketId,
          days_on_hand: r0(l.dohToday),
          days_of_cover_before_plant_supply: r0(l.coverBefore),
          runs_out_before_run_if_nothing_ships: l.coverBefore < s.daysToRun,
        })),
      }),
      step: {
        summary: `${atRisk.length} ordering markets would run out before the run lands in ${s.daysToRun} days if nothing ships.`,
        table: table(['Market', 'Days on hand', 'Cover to run'], [...this.lines()].sort((a, b) => a.coverBefore - b.coverBefore).map((l) => [label(l), r0(l.dohToday), r0(l.coverBefore)])),
      },
    }
  }

  private proposal() {
    const p = this.plan
    const s = p.summary
    const queued = new Set(this.routing.queue.map((q) => q.id))
    const c = this.config
    return {
      content: JSON.stringify({
        customer_rules_applied: {
          split_policy: c.allocation.policy,
          priority_rule: c.priorityAccounts.rule,
          minimum_days_past_run: c.safetyBuffer.minimumDaysPastRun,
          transfers: c.transfers.enabled,
        },
        outcome: {
          markets_out_before_run_with_plan: s.marketsAtRiskAfter,
          markets_out_if_nothing_ships: s.marketsAtRiskBefore,
          sales_at_risk_cases: s.demandAtRiskCases,
          backordered_cases: s.backorderQty,
        },
        transfers: p.transfers.map((t) => ({ from: t.fromMarketId, to: t.toMarketId, cases: t.qty, needs_approval: c.approval.transfers })),
        lines: p.lines
          .filter((l) => l.orderQty > 0 || l.dataIssues.length)
          .map((l) => ({
            market: l.marketId,
            distributor: l.distributorName,
            ordered: l.orderQty,
            ship: l.ship,
            backordered: l.backorderQty,
            rule: l.rule,
            runs_out_before_run: l.stockoutBeforeRun,
            routing: queued.has(l.marketId) ? 'approval_queue' : 'auto_execute',
          })),
        approval_queue: this.routing.queue.map((q) => ({ id: q.id, why: q.why })),
      }),
      step: {
        summary:
          `Plan: ${s.marketsAtRiskAfter} markets out before the run (vs ${s.marketsAtRiskBefore} if nothing ships), ${s.demandAtRiskCases.toLocaleString()} cs sales at risk. ` +
          `${this.routing.autoExecute.length} lines auto-execute, ${this.routing.queue.length} items need approval` +
          (p.transfers.length ? `, ${p.transfers.length} transfer${p.transfers.length > 1 ? 's' : ''} suggested.` : '.'),
        table: table(
          ['Market', 'Ordered', 'Ship', 'Rule', 'Routing'],
          p.lines.filter((l) => l.orderQty > 0).map((l) => [label(l), l.orderQty, l.ship, l.rule, queued.has(l.marketId) ? 'Approval' : 'Auto']),
        ),
      },
    }
  }

  private async draftNote(marketId: string, why: string): Promise<ToolResult> {
    const base = { tool: 'draft_customer_note', reason: why, input: { market_id: marketId } }
    const refuse = (msg: string): ToolResult => ({ content: JSON.stringify({ error: msg }), step: { ...base, summary: msg, isError: true } })
    if (!this.proposed) return refuse('Call propose_allocation first: notes must reflect the final plan.')
    if (this.notes >= MAX_NOTES) return refuse(`Note limit reached (${MAX_NOTES} per run).`)
    if (this.routing.queue.some((q) => q.id === marketId))
      return refuse(`${marketId} is waiting for human approval; its quantity may change, so no note yet.`)
    const facts = buildNoteFacts(this.world, this.skuId, marketId, settingsFromConfig(this.config))
    if (!facts) return refuse(`${marketId} has nothing backordered, so no note is needed.`)
    this.notes++
    const { draft, source } = await this.draft(facts, { tone: this.config.customerEmail.tone, signOff: this.config.customerEmail.signOff })
    return {
      content: JSON.stringify({ drafted: true, market: marketId, subject: draft.subject }),
      step: {
        ...base,
        summary: `Drafted a ${this.config.customerEmail.tone} note to ${facts.distributor} (${facts.market}): ${facts.backorderedCases} cs backordered until ${facts.nextAvailableSupply}.`,
        note: { marketId, title: `${facts.distributor} ${facts.market}`, draft, source },
      },
    }
  }
}

function label(l: { distributorName: string; state: string }) {
  return `${l.distributorName} ${l.state}`
}
function table(columns: string[], rows: (string | number)[][]): TraceTable {
  return { columns, rows }
}
