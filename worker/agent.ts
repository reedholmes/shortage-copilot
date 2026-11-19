/**
 * THE SHORTAGE AGENT
 * ==================
 * Claude investigates a shortage event with the six tools, gets the plan, drafts notes,
 * and writes a short summary for the planner. Every tool call is streamed to the screen
 * as it happens.
 *
 * Division of labour (the key design choice):
 *  - Claude decides WHAT to look at and explains WHY, in a planner's words.
 *  - The tested engine decides every number (Claude can't pass a quantity to any tool).
 *  - Code decides what needs a human (approval routing runs after, whatever Claude says).
 *
 * scriptedRun() walks the same tools in a fixed order with no AI. It is the fallback when
 * the AI is unavailable or a limit is hit, and it is clearly labeled on screen.
 */
import Anthropic from '@anthropic-ai/sdk'
import type { AgentSession } from './agentTools'
import { TOOLS } from './agentTools'
import { MODEL } from './note'
import type { SavedRun, TraceStep } from '../src/engine/agentTypes'

const MAX_TURNS = 12

export type CallModel = (params: {
  system: string
  tools: Anthropic.Beta.BetaTool[]
  messages: Anthropic.Beta.BetaMessageParam[]
}) => Promise<Anthropic.Beta.BetaMessage>

export function systemPrompt(s: AgentSession): string {
  return `You are a shortage allocation agent deployed for ${s.config.customer.name}, a beverage alcohol supplier. A planner has handed you one shortage event. Investigate it with your tools, get the allocation proposal, draft customer notes where allowed, and brief the planner.

How to work:
- Look before you propose: check inventory, forecast, open orders and days on hand, then call propose_allocation. Call each of these once.
- Every number comes from a tool. Never calculate, adjust or invent quantities. propose_allocation applies ${s.config.customer.name}'s configured rules, which you cannot change.
- After the proposal, draft customer notes for up to 2 backordered markets whose lines auto-execute, choosing the largest backorders. Request both notes in the same turn. Lines in the approval queue get no note until a human decides.
- Give every tool call a one-sentence reason a planner would understand.
- When you name a market, use the distributor name and state (for example "Magnolia Coast FL"), never the market id.

Finish with a briefing for the planner, under 100 words, plain text without headings or bullet symbols: the situation, what the plan protects, what waits for approval and why, and which notes you drafted.`
}

/** Runs the live agent. Emits each step as it completes. Throws if the run can't finish cleanly. */
export async function runAgent(
  session: AgentSession,
  callModel: CallModel,
  emit: (step: TraceStep) => void,
): Promise<SavedRun> {
  const system = systemPrompt(session)
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: 'user',
      content: `Shortage event: ${session.skuName} (sku_id "${session.skuId}"). Customer: ${session.config.customer.name}. Work the event.`,
    },
  ]
  const steps: TraceStep[] = []
  let model: string | undefined
  const usage = { inputTokens: 0, outputTokens: 0, turns: 0 }

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await callModel({ system, tools: TOOLS, messages })
    model = response.model
    usage.turns++
    usage.inputTokens += (response.usage?.input_tokens ?? 0) + (response.usage?.cache_read_input_tokens ?? 0) + (response.usage?.cache_creation_input_tokens ?? 0)
    usage.outputTokens += response.usage?.output_tokens ?? 0
    if (response.stop_reason === 'refusal') throw new Error('Model declined the request')
    if (response.stop_reason === 'max_tokens') throw new Error('Response cut off at max_tokens')
    messages.push({ role: 'assistant', content: response.content })

    const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
    if (!calls.length) {
      const summary = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim()
      // Guardrail: a briefing is only valid once the plan has actually been computed.
      if (!steps.some((s) => s.tool === 'propose_allocation' && !s.isError)) throw new Error('Agent finished without proposing a plan')
      if (!summary) throw new Error('Agent finished without a briefing')
      console.log(`agent run ok: ${usage.turns} turns, ${usage.inputTokens} in / ${usage.outputTokens} out tokens, model ${model}`)
      return { steps, summary, routing: session.routing, model, usage }
    }

    // Run this turn's calls side by side (two notes draft in parallel), then report them in
    // order. All results go back in one message.
    const outcomes = await Promise.all(calls.map((call) => session.execute(call.name, call.input)))
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
    calls.forEach((call, i) => {
      const r = outcomes[i]
      const step: TraceStep = { n: steps.length + 1, ...r.step }
      steps.push(step)
      emit(step)
      results.push({ type: 'tool_result', tool_use_id: call.id, content: r.content, ...(r.step.isError && { is_error: true }) })
    })
    messages.push({ role: 'user', content: results })
  }
  throw new Error(`Agent did not finish within ${MAX_TURNS} turns`)
}

/** Production model call: Claude Opus 5.5 with server-side refusal fallback. */
export function claudeCaller(apiKey: string): CallModel {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 })
  return (p) =>
    client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      // Low effort: the tools do the hard math; the agent only sequences them and explains.
      output_config: { effort: 'low' },
      system: p.system,
      tools: p.tools,
      messages: p.messages,
    })
}

/** Same tools, fixed order, no AI. Used when the live agent can't run. */
export async function scriptedRun(session: AgentSession, emit: (step: TraceStep) => void): Promise<SavedRun> {
  const steps: TraceStep[] = []
  const sku = session.skuId
  const run = async (tool: string, input: Record<string, unknown>) => {
    const r = await session.execute(tool, input)
    const step: TraceStep = { n: steps.length + 1, ...r.step }
    steps.push(step)
    emit(step)
  }
  await run('get_inventory', { sku_id: sku, reason: 'Start with what the plant can ship now and when the next run lands.' })
  await run('get_forecast', { sku_id: sku, reason: "Get each market's daily demand so stock can be turned into days of cover." })
  await run('get_open_orders', { sku_id: sku, reason: 'Confirm orders really exceed supply before allocating anything.' })
  await run('calc_days_on_hand', { sku_id: sku, reason: 'Find which markets would run out before the run if nothing ships.' })
  await run('propose_allocation', { sku_id: sku, reason: "Apply the customer's configured rules to get the recommended plan and approvals." })

  const auto = new Set(session.routing.autoExecute)
  const targets = session.plan.lines
    .filter((l) => auto.has(l.marketId) && l.backorderQty > 0)
    .sort((a, b) => b.backorderQty - a.backorderQty)
    .slice(0, 2)
  for (const l of targets)
    await run('draft_customer_note', { market_id: l.marketId, reason: `${l.distributorName} ${l.state} has one of the largest backorders on a line that auto-executes.` })

  return { steps, summary: scriptedSummary(session, targets.map((l) => `${l.distributorName} ${l.state}`)), routing: session.routing }
}

function scriptedSummary(s: AgentSession, notes: string[]): string {
  const p = s.plan.summary
  const q = s.routing.queue
  return (
    `${p.name} is short: ${p.openOrderQty.toLocaleString()} cs ordered against ${p.availableNow.toLocaleString()} available (${Math.round(p.fillRate * 100)}% fill). ` +
    `Under ${s.config.customer.name}'s rules the plan leaves ${p.marketsAtRiskAfter} markets short of the run, versus ${p.marketsAtRiskBefore} if nothing ships, with about ${p.demandAtRiskCases.toLocaleString()} cs of lost sales. ` +
    `${s.routing.autoExecute.length} lines can execute now; ${q.length} item${q.length === 1 ? '' : 's'} wait${q.length === 1 ? 's' : ''} for approval. ` +
    (notes.length ? `Drafted notes to ${notes.join(' and ')}.` : 'No notes drafted: every backordered line is waiting for approval.')
  )
}
