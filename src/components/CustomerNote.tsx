/**
 * Screen 3: Customer note.
 * The engine computes the facts; the server recomputes them and asks Claude to write
 * the email as JSON (subject, body, summary). The AI only writes words, never numbers.
 */
import { useState } from 'react'
import { planSku } from '../engine/allocation'
import type { Overrides } from '../engine/allocation'
import { buildNoteFacts } from '../engine/noteFacts'
import type { Settings, World } from '../engine/types'
import { n } from '../ui/format'

interface Props {
  customerId: string
  world: World
  skuId: string
  setSkuId: (id: string) => void
  settings: Settings
  overrides: Overrides
  marketId: string | null
  setMarketId: (id: string | null) => void
  onBack: () => void
}

interface DraftResult {
  source: 'ai' | 'cache' | 'fallback'
  reason?: 'rate_limited' | 'daily_cap' | 'not_configured' | 'ai_unavailable'
  draft: { subject: string; body: string; summary: string }
}

const SOURCE_LABEL: Record<DraftResult['source'], string> = {
  ai: 'Drafted by Claude Opus 5.5',
  cache: 'Claude draft (saved copy for these exact facts)',
  fallback: 'Template version',
}
const REASON_LABEL: Record<NonNullable<DraftResult['reason']>, string> = {
  rate_limited: 'You hit the demo limit of 5 AI drafts a minute. Showing the template version.',
  daily_cap: "The demo's daily AI budget is used up. Showing the template version.",
  not_configured: 'AI drafting is not configured here. Showing the template version.',
  ai_unavailable: "The AI service didn't respond. Showing the template version.",
}

export default function CustomerNote({ customerId, world, skuId, setSkuId, settings, overrides, marketId, setMarketId, onBack }: Props) {
  const plan = planSku(world, skuId, settings, overrides)
  const affected = plan.lines.filter((l) => l.backorderQty > 0)
  const line = affected.find((l) => l.marketId === marketId) ?? affected[0]
  const facts = line ? buildNoteFacts(world, skuId, line.marketId, settings, overrides) : null

  // A draft belongs to the exact facts it was written from; if the facts change, it is stale.
  const factsKey = customerId + JSON.stringify(facts)
  const [result, setResult] = useState<{ key: string; data: DraftResult } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const current = result?.key === factsKey ? result.data : null

  async function draft() {
    if (!line) return
    setLoading(true)
    setError(null)
    setCopied(false)
    try {
      const res = await fetch('/api/draft-note', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerId,
          skuId,
          marketId: line.marketId,
          nearDepletionWeight: settings.nearDepletionWeight,
          overrides,
        }),
      })
      if (!res.ok) throw new Error(`Server returned ${res.status}`)
      setResult({ key: factsKey, data: (await res.json()) as DraftResult })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  async function copy() {
    if (!current) return
    try {
      await navigator.clipboard.writeText(`Subject: ${current.draft.subject}\n\n${current.draft.body}`)
      setCopied(true)
    } catch {
      /* clipboard can be blocked; nothing else to do */
    }
  }

  return (
    <section>
      <button className="link back" onClick={onBack}>
        ← Back to allocation
      </button>
      <div className="page-h">
        <h2>Customer note</h2>
        <p>The engine supplies the facts. Claude writes the words.</p>
      </div>
      <div className="toolbar">
        <label className="field">
          <span>SKU</span>
          <select value={skuId} onChange={(e) => setSkuId(e.target.value)}>
            {world.skus.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Distributor with a backorder</span>
          <select
            value={line?.marketId ?? ''}
            onChange={(e) => setMarketId(e.target.value)}
            disabled={!affected.length}
          >
            {affected.map((l) => (
              <option key={l.marketId} value={l.marketId}>
                {l.distributorName} ({l.state}): {n(l.backorderQty)} cs backordered
              </option>
            ))}
          </select>
        </label>
      </div>

      {!facts ? (
        <p className="muted">No backorders on this SKU. Every open order ships in full.</p>
      ) : (
        <div className="note-grid">
          <div className="card">
            <h3 title="The server recomputes these with the same engine, so the browser can't send made-up facts.">
              Facts sent to the AI
            </h3>
            <pre className="json">{JSON.stringify(facts, null, 2)}</pre>
          </div>
          <div className="card draft-card">
            <div className="draft-head">
              <h3>Draft email</h3>
              <button className="primary" onClick={draft} disabled={loading}>
                {loading ? 'Drafting…' : current ? 'Redraft' : 'Draft with AI'}
              </button>
            </div>
            {error && <div className="banner alert">Couldn't reach the server ({error}). Try again.</div>}
            {loading && <p className="muted">Claude is writing…</p>}
            {!loading && current && (
              <>
                <div className="draft-meta">
                  <span className={current.source === 'fallback' ? 'pill amber' : 'pill green'}>
                    {SOURCE_LABEL[current.source]}
                  </span>
                  {current.reason && <span className="muted">{REASON_LABEL[current.reason]}</span>}
                </div>
                <div className="email">
                  <div className="email-subject">
                    <span className="muted">Subject:</span> {current.draft.subject}
                  </div>
                  <div className="email-body">{current.draft.body}</div>
                </div>
                <div className="draft-foot">
                  <button className="secondary" onClick={copy}>
                    {copied ? 'Copied ✓' : 'Copy email'}
                  </button>
                </div>
                <details className="raw-json">
                  <summary>Raw JSON response</summary>
                  <pre className="json">{JSON.stringify(current.draft, null, 2)}</pre>
                </details>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
