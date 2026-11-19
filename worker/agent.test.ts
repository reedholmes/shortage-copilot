/**
 * Agent tests. A fake model stands in for Claude and follows a script, so these run
 * offline, cost nothing, and can make the model misbehave on purpose.
 */
import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import worldJson from '../src/data/world.json'
import { routeApprovals } from '../src/engine/approvals'
import { getCustomer } from '../src/engine/customerConfig'
import type { AgentEvent } from '../src/engine/agentTypes'
import type { World } from '../src/engine/types'
import { runAgent, scriptedRun } from './agent'
import type { CallModel } from './agent'
import { handleAgentRun, SHORT_SKUS } from './agentHandler'
import type { AgentDeps } from './agentHandler'
import { AgentSession } from './agentTools'
import type { DraftFn } from './agentTools'
import type { Env } from './handler'

const world = worldJson as World
const ACME = getCustomer('acme_beverage')
const SKU = 'AGS-750'
const templateDraft: DraftFn = async (f) => ({ draft: { subject: `S ${f.market}`, body: 'B', summary: 'X' }, source: 'template' })
const session = () => new AgentSession(world, ACME, SKU, templateDraft)

type Call = { name: string; input: Record<string, unknown> }
/** A fake model: each turn makes the listed tool calls; the last turn writes the briefing. */
function fakeModel(turns: (Call[] | string)[]): CallModel {
  let i = 0
  return vi.fn(async () => {
    const t = turns[Math.min(i++, turns.length - 1)]
    const content = typeof t === 'string'
      ? [{ type: 'text', text: t }]
      : t.map((c, k) => ({ type: 'tool_use', id: `tu_${i}_${k}`, name: c.name, input: c.input }))
    return { model: 'fake-model', stop_reason: typeof t === 'string' ? 'end_turn' : 'tool_use', content } as unknown as Anthropic.Beta.BetaMessage
  })
}
const look = (name: string): Call => ({ name, input: { sku_id: SKU, reason: `check ${name}` } })
const autoBackordered = (s: AgentSession) =>
  s.plan.lines.filter((l) => s.routing.autoExecute.includes(l.marketId) && l.backorderQty > 0).sort((a, b) => b.backorderQty - a.backorderQty)

describe('Agent tools', () => {
  it('refuse a different SKU than the event', async () => {
    const r = await session().execute('get_inventory', { sku_id: 'HRB-750', reason: 'x' })
    expect(r.step.isError).toBe(true)
  })
  it('refuse a note before the plan exists', async () => {
    const s = session()
    const r = await s.execute('draft_customer_note', { market_id: autoBackordered(s)[0].marketId, reason: 'x' })
    expect(r.step.summary).toMatch(/propose_allocation first/)
  })
  it('refuse a note for a line waiting for approval', async () => {
    const s = session()
    await s.execute('propose_allocation', { sku_id: SKU, reason: 'x' })
    const queued = s.routing.queue.find((q) => q.kind === 'line')!
    const r = await s.execute('draft_customer_note', { market_id: queued.id, reason: 'x' })
    expect(r.step.isError).toBe(true)
    expect(r.step.summary).toMatch(/waiting for human approval/)
  })
  it('the approval queue is the routing code\'s, not something the model can edit', () => {
    const s = session()
    expect(s.routing).toEqual(routeApprovals(s.plan, ACME))
  })
})

describe('Live agent loop (fake model)', () => {
  it('records each tool call with its reason and returns the code-routed queue', async () => {
    const target = autoBackordered(session())[0].marketId
    const steps: string[] = []
    const run = await runAgent(
      session(),
      fakeModel([
        [look('get_inventory'), look('get_forecast')],
        [look('get_open_orders'), look('calc_days_on_hand')],
        [look('propose_allocation')],
        [{ name: 'draft_customer_note', input: { market_id: target, reason: 'largest auto backorder' } }],
        'Briefing for the planner.',
      ]),
      (s) => steps.push(s.tool),
    )
    expect(steps).toEqual(['get_inventory', 'get_forecast', 'get_open_orders', 'calc_days_on_hand', 'propose_allocation', 'draft_customer_note'])
    expect(run.steps[0].reason).toBe('check get_inventory')
    expect(run.steps[5].note?.marketId).toBe(target)
    expect(run.summary).toBe('Briefing for the planner.')
    expect(run.routing).toEqual(session().routing)
  })

  it('a briefing without a plan is rejected', async () => {
    await expect(runAgent(session(), fakeModel([[look('get_inventory')], 'All good!']), () => {})).rejects.toThrow(/without proposing a plan/)
  })

  it('a model that never stops is cut off', async () => {
    await expect(runAgent(session(), fakeModel([[look('get_inventory')]]), () => {})).rejects.toThrow(/did not finish/)
  })
})

describe('Scripted run (no AI)', () => {
  it('walks all five tools, then notes only auto-executing backorders (max 2)', async () => {
    const s = session()
    const run = await scriptedRun(s, () => {})
    expect(run.steps.slice(0, 5).map((x) => x.tool)).toEqual(['get_inventory', 'get_forecast', 'get_open_orders', 'calc_days_on_hand', 'propose_allocation'])
    const notes = run.steps.filter((x) => x.tool === 'draft_customer_note')
    expect(notes.length).toBe(Math.min(2, autoBackordered(s).length))
    for (const n of notes) expect(s.routing.autoExecute).toContain(n.note!.marketId)
  })
})

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------
function makeEnv(opts: { key?: string | null; allow?: boolean; agentCap?: string } = {}) {
  const store = new Map<string, string>()
  const env = {
    ASSETS: {} as Fetcher,
    NOTES: {
      get: async (k: string, type?: string) => {
        const v = store.get(k)
        return v === undefined ? null : type === 'json' ? JSON.parse(v) : v
      },
      put: async (k: string, v: string) => void store.set(k, v),
    } as unknown as KVNamespace,
    DRAFT_LIMITER: { limit: async () => ({ success: opts.allow ?? true }) } as RateLimit,
    ANTHROPIC_API_KEY: opts.key === null ? undefined : (opts.key ?? 'test-key'),
    AGENT_DAILY_CAP: opts.agentCap,
  } satisfies Env
  return { env, store }
}
const post = (body: unknown) => new Request('https://demo/api/agent-run', { method: 'POST', body: JSON.stringify(body) })
async function events(res: Response): Promise<AgentEvent[]> {
  return (await res.text()).trim().split('\n').map((l) => JSON.parse(l) as AgentEvent)
}
const goodScript = (): (Call[] | string)[] => [
  [look('get_inventory'), look('get_forecast'), look('get_open_orders'), look('calc_days_on_hand')],
  [look('propose_allocation')],
  'Briefing.',
]
const deps = (callModel: CallModel): AgentDeps => ({ callModel: () => callModel, draft: async () => ({ subject: 's', body: 'b', summary: 'x' }) })

describe('/api/agent-run', () => {
  it('only allows known customers and real shortage events', async () => {
    const { env } = makeEnv()
    expect(SHORT_SKUS.sort()).toEqual(['AGS-750', 'HRB-750', 'NSB-750'])
    for (const bad of [{ customerId: 'nobody', skuId: SKU }, { customerId: 'acme_beverage', skuId: 'CVK-1L' }, { customerId: 'acme_beverage' }]) {
      expect((await handleAgentRun(post(bad), env)).status).toBe(400)
    }
  })

  it('runs live once, saves the run, then replays it without calling the model', async () => {
    const { env } = makeEnv()
    const model = fakeModel(goodScript())
    const first = await events(await handleAgentRun(post({ customerId: 'acme_beverage', skuId: SKU }), env, undefined, deps(model)))
    expect(first[0]).toMatchObject({ type: 'start', source: 'ai' })
    expect(first.filter((e) => e.type === 'step').length).toBe(5)
    expect(first.at(-1)).toMatchObject({ type: 'done', summary: 'Briefing.' })
    const calls = (model as ReturnType<typeof vi.fn>).mock.calls.length

    const second = await events(await handleAgentRun(post({ customerId: 'acme_beverage', skuId: SKU }), env, undefined, deps(model)))
    expect(second[0]).toMatchObject({ type: 'start', source: 'cache' })
    expect(second.filter((e) => e.type === 'step').length).toBe(5)
    expect((model as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls)
  })

  it('a different customer is a different saved run', async () => {
    const { env } = makeEnv()
    await handleAgentRun(post({ customerId: 'acme_beverage', skuId: SKU }), env, undefined, deps(fakeModel(goodScript()))).then((r) => r.text())
    const other = await events(await handleAgentRun(post({ customerId: 'bluestone_spirits', skuId: SKU }), env, undefined, deps(fakeModel(goodScript()))))
    expect(other[0]).toMatchObject({ source: 'ai' })
  })

  it('falls back to the scripted run with no key, when rate limited, or over the daily cap', async () => {
    for (const [opts, reason] of [[{ key: null }, 'not_configured'], [{ allow: false }, 'rate_limited'], [{ agentCap: '0' }, 'daily_cap']] as const) {
      const { env } = makeEnv(opts)
      const ev = await events(await handleAgentRun(post({ customerId: 'acme_beverage', skuId: SKU }), env, undefined, deps(fakeModel(goodScript()))))
      expect(ev[0]).toMatchObject({ type: 'start', source: 'scripted', reason })
      expect(ev.at(-1)?.type).toBe('done')
    }
  })

  it('if the AI fails part way, the screen resets and a scripted run finishes the job', async () => {
    const { env, store } = makeEnv()
    const ev = await events(await handleAgentRun(post({ customerId: 'acme_beverage', skuId: SKU }), env, undefined, deps(fakeModel([[look('get_inventory')], 'Done early.']))))
    expect(ev.map((e) => e.type)).toContain('reset')
    expect(ev.at(-1)?.type).toBe('done')
    expect([...store.keys()].some((k) => k.startsWith('agent:'))).toBe(false) // failures are never saved
  })
})
