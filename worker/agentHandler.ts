/**
 * POST /api/agent-run   body: { customerId, skuId }
 *
 * Streams the agent's work as it happens, one JSON event per line (start, step..., done).
 *
 * Guardrails, in order:
 *  1. Validate: a known customer and one of the shortage events. No free text.
 *  2. Saved runs: each customer + event is run live once, then replayed (instant, free)
 *     until the rules or the agent prompt change.
 *  3. Per-visitor rate limit, then a site-wide daily cap on live agent runs.
 *  4. No key, a limit hit, or a failure part way: a scripted run of the same tools takes
 *     over, clearly labeled. The plan and approval queue are identical either way,
 *     because they come from the engine and the routing code, not from the AI.
 */
import { z } from 'zod'
import worldJson from '../src/data/world.json'
import { planSku } from '../src/engine/allocation'
import { CUSTOMERS, getCustomer, settingsFromConfig } from '../src/engine/customerConfig'
import type { AgentEvent, RunFallbackReason, SavedRun, TraceStep } from '../src/engine/agentTypes'
import type { World } from '../src/engine/types'
import { claudeCaller, runAgent, scriptedRun, systemPrompt } from './agent'
import type { CallModel } from './agent'
import { AgentSession, TOOLS } from './agentTools'
import type { DraftFn } from './agentTools'
import { DAY, dailyCount, hash, json, noteCacheKey } from './handler'
import type { Env } from './handler'
import { draftWithClaude, templateNote } from './note'
import type { Draft, NoteStyle } from './note'

const world = worldJson as World

/** Bump this when the agent prompt or tools change, so saved runs are redone. */
export const AGENT_VERSION = 'v1'

/** Only real shortage events can be run (whether a SKU is short doesn't depend on the customer). */
export const SHORT_SKUS = world.skus.filter((s) => planSku(world, s.id, settingsFromConfig(CUSTOMERS[0])).summary.isShort).map((s) => s.id)

const RequestSchema = z.object({
  customerId: z.enum(CUSTOMERS.map((c) => c.customer.id) as [string, ...string[]]),
  skuId: z.enum(SHORT_SKUS as [string, ...string[]]),
})

export interface AgentDeps {
  callModel: (apiKey: string) => CallModel
  draft: (facts: Parameters<typeof draftWithClaude>[0], apiKey: string, style: NoteStyle) => Promise<Draft>
}
const LIVE: AgentDeps = { callModel: claudeCaller, draft: draftWithClaude }

export async function handleAgentRun(
  request: Request,
  env: Env,
  ctx?: { waitUntil(p: Promise<unknown>): void },
  deps: AgentDeps = LIVE,
): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Use POST' }, 405)
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Body must be JSON' }, 400)
  }
  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) return json({ error: 'Invalid request' }, 400)
  const { customerId, skuId } = parsed.data
  const config = getCustomer(customerId)

  // Notes inside an agent run: saved draft if there is one, else AI (when allowed), else template.
  const notes = (aiAllowed: boolean): DraftFn => async (facts, style) => {
    const key = await noteCacheKey(facts, style)
    const cached = await env.NOTES.get<Draft>(key, 'json')
    if (cached) return { draft: cached, source: 'cache' }
    if (aiAllowed && env.ANTHROPIC_API_KEY) {
      try {
        const draft = await deps.draft(facts, env.ANTHROPIC_API_KEY, style)
        await env.NOTES.put(key, JSON.stringify(draft), { expirationTtl: 7 * DAY })
        await (await dailyCount(env, 'count')).bump()
        return { draft, source: 'ai' }
      } catch (err) {
        console.error('Agent note failed:', err instanceof Error ? err.message : err)
      }
    }
    return { draft: templateNote(facts, style), source: 'template' }
  }

  // A saved run is valid only for these exact rules, prompt and tools.
  const sessionForKey = new AgentSession(world, config, skuId, notes(false))
  const runKey = `agent:${AGENT_VERSION}:${await hash(JSON.stringify({ config, skuId, prompt: systemPrompt(sessionForKey), tools: TOOLS }))}`

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const writer = writable.getWriter()
  const enc = new TextEncoder()
  const send = (e: AgentEvent) => writer.write(enc.encode(JSON.stringify(e) + '\n'))
  const emitStep = (step: TraceStep) => void send({ type: 'step', step })

  const scripted = async (reason: RunFallbackReason, announce = true) => {
    if (announce) await send({ type: 'start', source: 'scripted', reason, customerId, skuId })
    const run = await scriptedRun(new AgentSession(world, config, skuId, notes(false)), emitStep)
    await send({ type: 'done', summary: run.summary, routing: run.routing })
  }

  const work = (async () => {
    try {
      // 2. Saved run
      const saved = await env.NOTES.get<SavedRun>(runKey, 'json')
      if (saved) {
        await send({ type: 'start', source: 'cache', customerId, skuId })
        for (const step of saved.steps) await send({ type: 'step', step })
        await send({ type: 'done', summary: saved.summary, routing: saved.routing, model: saved.model, usage: saved.usage })
        return
      }
      // 3. Limits
      const ip = request.headers.get('CF-Connecting-IP') ?? 'local'
      if (!(await env.DRAFT_LIMITER.limit({ key: `agent:${ip}` })).success) return await scripted('rate_limited')
      const counter = await dailyCount(env, 'agentcount')
      if (counter.used >= Number(env.AGENT_DAILY_CAP ?? '40')) return await scripted('daily_cap')
      if (!env.ANTHROPIC_API_KEY) return await scripted('not_configured')

      // 4. Live agent
      await send({ type: 'start', source: 'ai', customerId, skuId })
      await counter.bump()
      try {
        const run = await runAgent(new AgentSession(world, config, skuId, notes(true)), deps.callModel(env.ANTHROPIC_API_KEY), emitStep)
        await env.NOTES.put(runKey, JSON.stringify(run), { expirationTtl: 30 * DAY })
        await send({ type: 'done', summary: run.summary, routing: run.routing, model: run.model, usage: run.usage })
      } catch (err) {
        console.error('Agent run failed:', err instanceof Error ? err.message : err)
        await send({ type: 'reset', reason: 'ai_unavailable' })
        await scripted('ai_unavailable', false)
      }
    } catch (err) {
      console.error('Agent handler error:', err instanceof Error ? err.message : err)
      await send({ type: 'error', message: 'Something went wrong running the agent.' })
    } finally {
      await writer.close()
    }
  })()
  ctx?.waitUntil(work)

  return new Response(readable, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
  })
}
