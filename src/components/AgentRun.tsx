/**
 * Agent run: the agent works a shortage event step by step, then hands the planner a
 * briefing and an approval queue. Steps stream in from /api/agent-run as they happen.
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
  ai: { label: 'Live run · Claude Opus 5.5', cls: 'pill green' },
  cache: { label: 'Saved run · replayed from its first live run', cls: 'pill blue' },
  scripted: { label: 'Scripted run · no AI', cls: 'pill amber' },
}
const REASON: Record<RunFallbackReason, string> = {
  rate_limited: 'You hit the demo limit on agent runs per minute, so the same tools ran in a fixed order without AI.',
  daily_cap: "The demo's daily AI budget is used up, so the same tools ran in a fixed order without AI.",
  not_configured: 'AI is not configured here, so the same tools ran in a fixed order without AI.',
  ai_unavailable: "The AI didn't finish cleanly, so the run restarted with the same tools in a fixed order.",
}
const TOOL_ICON: Record<string, string> = {
  get_inventory: '📦',
  get_forecast: '📈',
  get_open_orders: '🧾',
  calc_days_on_hand: '⏳',
  propose_allocation: '⚖️',
  draft_customer_note: '✉️',
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
  const [restarted, setRestarted] = useState(false)
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
    setRestarted(false)
  }, [customerId, activeSku])

  async function run() {
    const id = ++runId.current
    setStatus('running')
    setSource(null)
    setSteps([])
    setFinal(null)
    setDecisions({})
    setRestarted(false)
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
            setRestarted(true)
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

  return (
    <section>
      <div className="intro">
        <h2>Agent run</h2>
        <p>
          The agent works the shortage the way a planner would: it checks inventory, demand, orders and cover, then asks
          the allocation engine for a plan under <strong>{customer.customer.name}</strong>'s rules. Claude chooses the
          steps and explains them; every number comes from the tested engine, and code decides what needs a human.
        </p>
      </div>

      <div className="toolbar">
        <label className="field">
          <span>Shortage event</span>
          <select value={activeSku} onChange={(e) => setSkuId(e.target.value)} disabled={status === 'running'}>
            {shortSkus.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button className="primary run-btn" onClick={run} disabled={status === 'running'}>
          {status === 'running' ? 'Agent working…' : status === 'done' ? 'Run again' : 'Run the agent'}
        </button>
      </div>

      {source && (
        <p className="run-source">
          <span className={SOURCE[source.source].cls}>{SOURCE[source.source].label}</span>
          {source.reason && <span className="muted"> {REASON[source.reason]}</span>}
          {restarted && <span className="muted"> (restarted)</span>}
        </p>
      )}
      {status === 'error' && <p className="banner alert">The agent run failed to load. Try again in a moment.</p>}

      {steps.length > 0 && (
        <ol className="trace">
          {steps.map((s) => (
            <li key={s.n} className={s.isError ? 'trace-step err' : 'trace-step'}>
              <div className="trace-head">
                <span className="trace-n">{s.n}</span>
                <code className="tool-name">
                  {TOOL_ICON[s.tool] ?? '🔧'} {s.tool}
                </code>
              </div>
              <p className="trace-why">
                <span className="muted">Why:</span> {s.reason}
              </p>
              <p className="trace-result">{s.summary}</p>
              {s.note && (
                <div className="trace-note">
                  <div className="tiny muted">
                    {s.note.source === 'template' ? 'Template email' : 'Claude draft'} to {s.note.title}
                  </div>
                  <strong>{s.note.draft.subject}</strong>
                  <pre>{s.note.draft.body}</pre>
                </div>
              )}
              {s.table && (
                <>
                  <button className="link tiny" onClick={() => setOpenStep(openStep === s.n ? null : s.n)}>
                    {openStep === s.n ? 'Hide data' : `Show what the tool returned (${s.table.rows.length} rows)`}
                  </button>
                  {openStep === s.n && (
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
                </>
              )}
            </li>
          ))}
          {status === 'running' && <li className="trace-step pending">Working…</li>}
        </ol>
      )}

      {final && (
        <>
          <div className="card briefing">
            <h3>Agent briefing</h3>
            <p>{final.summary}</p>
            {final.usage && (
              <p className="tiny muted usage">
                Cost of the live run: {final.usage.turns} agent turns, {n(final.usage.inputTokens)} input and{' '}
                {n(final.usage.outputTokens)} output tokens, about $
                {((final.usage.inputTokens * 4 + final.usage.outputTokens * 20) / 1e6).toFixed(2)} at Claude Opus 5.5 rates
                (email drafts not included). Replays are free.
              </p>
            )}
          </div>

          <h3 className="section-h">
            Approval queue{' '}
            <span className="muted tiny">
              {queue.length ? `${decided} of ${queue.length} decided` : 'empty'} · routed by code, not by the AI
            </span>
          </h3>
          {queue.length === 0 && <p className="muted">Nothing needs a human: every line can execute.</p>}
          <div className="queue">
            {queue.map((q) => {
              const l = lineById.get(q.id)
              const d = decisions[q.id]
              return (
                <div key={q.id} className={`queue-item ${d ?? ''}`}>
                  <div className="queue-main">
                    <div>
                      <strong>{q.title}</strong>{' '}
                      {q.kind === 'transfer' ? (
                        <span className="pill blue small">Transfer</span>
                      ) : (
                        l && (
                          <span className="muted">
                            ships {n(l.ship)} of {n(l.orderQty)} cs
                          </span>
                        )
                      )}
                    </div>
                    <ul className="queue-why">
                      {q.why.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="queue-actions">
                    {d === 'approved' && <span className="pill green">Approved</span>}
                    {d === 'rejected' && (
                      <span className="pill red" title="Set a different quantity on the Allocation screen">
                        Sent back to planner
                      </span>
                    )}
                    {!d && (
                      <>
                        <button className="primary small-btn" onClick={() => setDecisions((x) => ({ ...x, [q.id]: 'approved' }))}>
                          Approve
                        </button>
                        <button className="secondary small-btn" onClick={() => setDecisions((x) => ({ ...x, [q.id]: 'rejected' }))}>
                          Reject
                        </button>
                      </>
                    )}
                    {d && (
                      <button className="link tiny" onClick={() => setDecisions(({ [q.id]: _gone, ...rest }) => rest)}>
                        Undo
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          {queue.length > 0 && decided === queue.length && (
            <p className="banner release">
              Ready to release: {final.routing.autoExecute.length} lines that needed no sign-off, plus {approved} approved
              item{approved === 1 ? '' : 's'}.
              {rejected > 0 && (
                <>
                  {' '}
                  {rejected} sent back.{' '}
                  <button className="link" onClick={onOpenAllocation}>
                    Set those quantities on the Allocation screen →
                  </button>
                </>
              )}
            </p>
          )}
          <details className="auto-list">
            <summary>{final.routing.autoExecute.length} lines execute without sign-off</summary>
            <ul>
              {final.routing.autoExecute.map((id) => {
                const l = lineById.get(id)
                return l ? (
                  <li key={id}>
                    {l.distributorName} {l.state}: ships {n(l.ship)} of {n(l.orderQty)} cs
                  </li>
                ) : null
              })}
            </ul>
          </details>
          <p className="muted hint compare-note">Approve and Reject are demo state only. Nothing is sent anywhere.</p>
        </>
      )}
    </section>
  )
}
