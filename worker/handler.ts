/**
 * POST /api/draft-note
 *
 * Guardrails, in order:
 *  1. Validate input. The browser sends only IDs and numbers, never free text.
 *  2. Recompute the facts here with the same engine, so they can't be faked.
 *  3. Cache: identical facts reuse a saved draft (free and instant).
 *  4. Per-visitor rate limit (a few drafts a minute).
 *  5. Site-wide daily cap on AI drafts.
 *  6. Any failure (no key, API down, limit hit) returns the template note, labeled as such.
 */
import { z } from 'zod'
import worldJson from '../src/data/world.json'
import { CUSTOMERS, DEFAULT_CUSTOMER_ID, getCustomer, settingsFromConfig } from '../src/engine/customerConfig'
import { buildNoteFacts } from '../src/engine/noteFacts'
import type { NoteFacts } from '../src/engine/noteFacts'
import type { World } from '../src/engine/types'
import { draftWithClaude, templateNote } from './note'
import type { Draft, NoteStyle } from './note'

const world = worldJson as World

export interface Env {
  ASSETS: Fetcher
  NOTES: KVNamespace
  DRAFT_LIMITER: RateLimit
  ANTHROPIC_API_KEY?: string
  DAILY_AI_CAP?: string
  /** Site-wide cap on fresh (not replayed) agent runs per day. */
  AGENT_DAILY_CAP?: string
}

export type Source = 'ai' | 'cache' | 'fallback'
export type FallbackReason = 'rate_limited' | 'daily_cap' | 'not_configured' | 'ai_unavailable'

export interface DraftResponse {
  source: Source
  reason?: FallbackReason
  facts: NoteFacts
  draft: Draft
}

const customerIds = CUSTOMERS.map((c) => c.customer.id) as [string, ...string[]]

const RequestSchema = z.object({
  /** Which customer's rules to apply. Must be one of the known configs. */
  customerId: z.enum(customerIds).default(DEFAULT_CUSTOMER_ID),
  skuId: z.string().max(20),
  marketId: z.string().max(20),
  nearDepletionWeight: z.number().min(0.5).max(1),
  overrides: z.record(z.string().max(20), z.number().int().min(0).max(100_000)).default({}),
})

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

export async function hash(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

export const DAY = 86_400

/** Saved drafts are keyed by the exact facts AND the customer's tone, so one customer's email is never reused for another. */
export async function noteCacheKey(facts: NoteFacts, style: NoteStyle): Promise<string> {
  return `note:${await hash(JSON.stringify({ facts, style }))}`
}

/** Daily counter for fresh AI calls (saved drafts and replays don't count). */
export async function dailyCount(env: Env, prefix: string): Promise<{ used: number; bump: () => Promise<void> }> {
  const key = `${prefix}:${new Date().toISOString().slice(0, 10)}`
  const used = Number((await env.NOTES.get(key)) ?? '0')
  return { used, bump: () => env.NOTES.put(key, String(used + 1), { expirationTtl: 2 * DAY }) }
}

export async function handleDraftNote(
  request: Request,
  env: Env,
  draft: (facts: NoteFacts, apiKey: string, style: NoteStyle) => Promise<Draft> = draftWithClaude,
): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Use POST' }, 405)

  // 1. Validate
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Body must be JSON' }, 400)
  }
  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) return json({ error: 'Invalid request' }, 400)
  const { customerId, skuId, marketId, nearDepletionWeight, overrides } = parsed.data
  if (Object.keys(overrides).length > 30) return json({ error: 'Too many overrides' }, 400)

  // 2. Recompute facts server-side, with that customer's rules
  const customer = getCustomer(customerId)
  const settings = { ...settingsFromConfig(customer), nearDepletionWeight }
  const style: NoteStyle = { tone: customer.customerEmail.tone, signOff: customer.customerEmail.signOff }
  const facts = buildNoteFacts(world, skuId, marketId, settings, overrides)
  if (!facts) return json({ error: 'No backorder for that SKU and market' }, 400)
  const fallback = (reason: FallbackReason): Response =>
    json({ source: 'fallback', reason, facts, draft: templateNote(facts, style) } satisfies DraftResponse)

  // 3. Cache
  const cacheKey = await noteCacheKey(facts, style)
  const cached = await env.NOTES.get<Draft>(cacheKey, 'json')
  if (cached) return json({ source: 'cache', facts, draft: cached } satisfies DraftResponse)

  // 4. Per-visitor rate limit
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local'
  const { success } = await env.DRAFT_LIMITER.limit({ key: ip })
  if (!success) return fallback('rate_limited')

  // 5. Daily cap
  const counter = await dailyCount(env, 'count')
  if (counter.used >= Number(env.DAILY_AI_CAP ?? '150')) return fallback('daily_cap')

  // 6. Call Claude
  if (!env.ANTHROPIC_API_KEY) return fallback('not_configured')
  try {
    const result = await draft(facts, env.ANTHROPIC_API_KEY, style)
    await env.NOTES.put(cacheKey, JSON.stringify(result), { expirationTtl: 7 * DAY })
    await counter.bump()
    return json({ source: 'ai', facts, draft: result } satisfies DraftResponse)
  } catch (err) {
    console.error('AI draft failed:', err instanceof Error ? err.message : err)
    return fallback('ai_unavailable')
  }
}
