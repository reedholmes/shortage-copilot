/**
 * Agent: works a shortage step by step, then hands the planner a briefing and an
 * approval queue. Steps stream in from /api/agent-run as they happen.
 * Each step is one line; the agent's reason, the data and any email open on click.
 *
 * The queue comes from the approval-routing code on the server, not from the AI.
 * Approve/Reject here is demo state only (nothing is sent anywhere).
 */
import { useEffect, useRef, useState } from 'react'
import { planSku } from '../engine/allocation'
import { getCustomer, settingsFromConfig } from '../engine/customerConfig'
import type { Routing } from '../engine/approvals'
import type { AgentEvent, RunFallbackReason, RunSource, RunUsage, TraceStep } from '../engine/agentTypes'
import type { World } from '../engine/types'
import { n } from '../ui/format'

interface Props {
  world: World
  customerId: string
  skuId: string
  setSkuId: (id: string) => void
  onOpenAllocation: () => void
}

type Decision = 'approved' | 'rejected'

const SOURCE: Record<RunSource, { label: string; cls: string }> = {
  ai: { label: 'Live · Claude Opus 5.5', cls: 'pill green' },
  cache: { label: 'Replay of a live run', cls: 'pill blue' },
  scripted: { label: 'Scripted · no AI', cls: 'pill amber' },
}
const REASON: Record<RunFallbackReason, string> = {
  rate_limited: 'Demo rate limit reached.',
  daily_cap: 'Daily AI budget used up.',
  not_configured: 'AI not configured here.',
  ai_unavailable: "AI didn't finish; restarted without it.",
}
const PACE_MS = 450

export default function AgentRun({ world, customerId, skuId, setSkuId, onOpenAllocation }: Props) {
  const customer = getCustomer(customerId)
  const settings = settingsFromConfig(customer)
  const shortSkus = world.skus.filter((s) => planSku(world, s.id, settings).summary.isShort)
  const activeSku = shortSkus.some((s) => s.id === skuId) ? skuId : shortSkus[0].id
  const plan = planSku(world, activeSku, settings)
  const lineById = new Map(plan.lines.map((l) => [l.marketId, l]))

  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [source, setSource] = useState<{ source: RunSource; reason?: RunFallbackReason } | null>(null)
  const [steps, setSteps] = useState<TraceStep[]>([])
  const [final, setFinal] = useState<{ summary: string; routing: Routing; model?: string; usage?: RunUsage } | null>(null)
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [openStep, setOpenStep] = useState<number | null>(null)
  const runId = useRef(0)

  // A new customer or event clears the old run.
  useEffect(() => {
    runId.current++
    setStatus('idle')
    setSource(null)
    setSteps([])
    setFinal(null)
    setDecisions({})
  }, [customerId, activeSku])

  async function run() {
    const id = ++runId.current
    setStatus('running')
    setSource(null)
    setSteps([])
    setFinal(null)
    setDecisions({})
    setOpenStep(null)
    const alive = () => id === runId.current
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
    try {
      const res = await fetch('/api/agent-run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ customerId, skuId: activeSku }),
      })
      if (!res.ok || !res.body) throw new Error(`Server returned ${res.status}`)
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      let last = 0
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let nl
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (!line || !alive()) continue
          const e = JSON.parse(line) as AgentEvent
          // Pace the reveal so a replay reads like the run it came from.
          const gap = Date.now() - last
          if ((e.type === 'step' || e.type === 'done') && gap < PACE_MS) await wait(PACE_MS - gap)
          last = Date.now()
          if (!alive()) return
          if (e.type === 'start') setSource({ source: e.source, reason: e.reason })
          else if (e.type === 'step') setSteps((s) => [...s, e.step])
          else if (e.type === 'reset') {
            setSteps([])
            setSource({ source: 'scripted', reason: e.reason })
          } else if (e.type === 'done') {
            setFinal({ summary: e.summary, routing: e.routing, model: e.model, usage: e.usage })
            setStatus('done')
          } else if (e.type === 'error') throw new Error(e.message)
        }
      }
      if (alive()) setStatus((s) => (s === 'running' ? 'error' : s))
    } catch {
      if (alive()) setStatus('error')
    }
  }

  const queue = final?.routing.queue ?? []
  const decided = queue.filter((q) => decisions[q.id]).length
  const approved = queue.filter((q) => decisions[q.id] === 'approved').length
  const rejected = queue.filter((q) => decisions[q.id] === 'rejected').length
  const cost = final?.usage ? (final.usage.inputTokens * 4 + final.usage.outputTokens * 20) / 1e6 : null

  return (
    <section>
      <div className="page-h">
        <h2>Agent</h2>
        <p>Claude works the shortage under {customer.customer.name}'s rules. The engine sets every number.</p>
      </div>

      <div className="toolbar">
        <label className="field">
          <span>Shortage</span>
          <select value={activeSku} onChange={(e) => setSkuId(e.target.value)} disabled={status === 'running'}>
            {shortSkus.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button className="primary run-btn" onClick={run} disabled={status === 'running'}>
          {status === 'running' ? 'Working…' : status === 'done' ? '↻ Run again' : '▶ Run the agent'}
        </button>
        {source && (
          <p className="run-source">
            <span className={SOURCE[source.source].cls}>{SOURCE[source.source].label}</span>
            {source.reason && <span className="muted"> {REASON[source.reason]}</span>}
          </p>
        )}
      </div>

      {status === 'error' && <p className="banner alert">The agent run failed to load. Try again in a moment.</p>}

      {steps.length > 0 && (
        <ol className="trace">
          {steps.map((s) => {
            const isOpen = openStep === s.n
            return (
              <li key={s.n} className={s.isError ? 'trace-step err' : 'trace-step'}>
                <div className="trace-row" onClick={() => setOpenStep(isOpen ? null : s.n)}>
                  <span className="trace-n">{s.n}</span>
                  <code className="tool-name">{s.tool}</code>
                  <span className="trace-result">{s.summary}</span>
                  <span className="caret">{isOpen ? '▾' : '▸'}</span>
                </div>
                {isOpen && (
                  <div className="trace-detail">
                    <p className="trace-why">Why: {s.reason}</p>
                    {s.note && (
                      <div className="trace-note">
                        <strong>{s.note.draft.subject}</strong>
                        <pre>{s.note.draft.body}</pre>
                      </div>
                    )}
                    {s.table && (
                      <table className="mini trace-table">
                        <thead>
                          <tr>
                            {s.table.columns.map((c) => (
                              <th key={c}>{c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {s.table.rows.map((r, i) => (
                            <tr key={i}>
                              {r.map((v, j) => (
                                <td key={j} className={typeof v === 'number' ? 'num' : ''}>
                                  {typeof v === 'number' ? n(v) : v}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </li>
            )
          })}
          {status === 'running' && <li className="trace-step pending">Working…</li>}
        </ol>
      )}

      {final && (
        <>
          <div className="card briefing">
            <h3>Briefing</h3>
            <p>{final.summary}</p>
            {final.usage && cost !== null && (
              <p className="tiny muted usage">
                {final.usage.turns} turns · {n(final.usage.inputTokens + final.usage.outputTokens)} tokens · ≈ $
                {cost.toFixed(2)} per live run · replays free
              </p>
            )}
          </div>

          <h3 className="section-h">
            Approval queue
            <span className="muted tiny">
              {queue.length ? `${decided}/${queue.length} decided` : 'empty'} · routed by code · demo only
            </span>
          </h3>
          {queue.length === 0 ? (
            <p className="muted">Nothing needs a person.</p>
          ) : (
            <div className="queue">
              {queue.map((q) => {
                const l = lineById.get(q.id)
                const d = decisions[q.id]
                return (
                  <div key={q.id} className={`queue-item ${d ?? ''}`}>
                    <div>
                      <strong>{q.title}</strong>{' '}
                      {q.kind === 'transfer' ? (
                        <span className="pill blue small">Transfer</span>
                      ) : (
                        l && (
                          <span className="muted mono">
                            {n(l.ship)}/{n(l.orderQty)} cs
                          </span>
                        )
                      )}
                      <div className="queue-why">{q.why.join(' · ')}</div>
                    </div>
                    <div className="queue-actions">
                      {d === 'approved' && <span className="pill green">Approved</span>}
                      {d === 'rejected' && <span className="pill red">Sent back</span>}
                      {!d ? (
                        <>
                          <button className="primary small-btn" onClick={() => setDecisions((x) => ({ ...x, [q.id]: 'approved' }))}>
                            Approve
                          </button>
                          <button className="secondary small-btn" onClick={() => setDecisions((x) => ({ ...x, [q.id]: 'rejected' }))}>
                            Reject
                          </button>
                        </>
                      ) : (
                        <button className="link tiny" onClick={() => setDecisions(({ [q.id]: _gone, ...rest }) => rest)}>
                          Undo
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {queue.length > 0 && decided === queue.length && (
            <p className="banner release">
              Ready to release: {final.routing.autoExecute.length} auto + {approved} approved.
              {rejected > 0 && (
                <>
                  {' '}
                  {rejected} sent back.{' '}
                  <button className="link" onClick={onOpenAllocation}>
                    Set quantities →
                  </button>
                </>
              )}
            </p>
          )}
          <details className="auto-list">
            <summary>{final.routing.autoExecute.length} lines execute without sign-off</summary>
            <p>
              {final.routing.autoExecute
                .map((id) => lineById.get(id))
                .filter((l) => l)
                .map((l) => `${l!.distributorName} ${l!.state} ${n(l!.ship)}/${n(l!.orderQty)}`)
                .join(' · ')}
            </p>
          </details>
        </>
      )}
    </section>
  )
}
