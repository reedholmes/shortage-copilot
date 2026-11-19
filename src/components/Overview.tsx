/**
 * Overview: which SKUs are short, and how much the plan helps. One card per shortage.
 * The scenario story is on hover (title) rather than on the card.
 */
import { fmtDate, summarizeAll } from '../engine/allocation'
import type { Settings, World } from '../engine/types'
import { n, pct } from '../ui/format'

interface Props {
  world: World
  settings: Settings
  onRunAgent: (skuId: string) => void
  onOpenAllocation: (skuId: string) => void
}

export default function Overview({ world, settings, onRunAgent, onOpenAllocation }: Props) {
  const summaries = summarizeAll(world, settings)
  const short = summaries.filter((s) => s.isShort)
  const healthy = summaries.filter((s) => !s.isShort)
  const scenario = (id: string) => world.scenarios.find((s) => s.skuId === id)

  return (
    <section>
      <div className="page-h">
        <h2>
          {short.length} of {summaries.length} SKUs short
        </h2>
        <p>Markets that run out before the next available supply, without and with the plan.</p>
      </div>

      <div className="cards">
        {short.map((s) => {
          const sc = scenario(s.skuId)
          return (
            <article key={s.skuId} className="card short" title={sc ? `${sc.title}. ${sc.story}` : undefined}>
              <div className="card-top">
                <h3>{s.name.replace(/ 750ml$/, '')}</h3>
                <span className="pill red">Short {pct(1 - s.fillRate)}</span>
              </div>
              <div>
                <div className="bigdelta">
                  <span className="from">{s.marketsAtRiskBefore}</span>
                  <span className="arrow">→</span>
                  <span className="to">{s.marketsAtRiskAfter}</span>
                </div>
                <div className="bigdelta-label">markets out before next supply</div>
              </div>
              <dl className="stats">
                <div>
                  <dt>On hand</dt>
                  <dd>{n(s.availableNow)}</dd>
                </div>
                <div>
                  <dt>Ordered</dt>
                  <dd>{n(s.openOrderQty)}</dd>
                </div>
                <div>
                  <dt>Next available supply</dt>
                  <dd>{fmtDate(s.runDate)}</dd>
                </div>
              </dl>
              <div className="card-actions">
                <button className="primary small-btn" onClick={() => onRunAgent(s.skuId)}>
                  ▶ Run agent
                </button>
                <button className="secondary small-btn" onClick={() => onOpenAllocation(s.skuId)}>
                  Allocation
                </button>
                {s.transferCount > 0 && <span className="transfer-note">⇄ {s.transferCount} transfers</span>}
              </div>
            </article>
          )
        })}
      </div>

      <details className="healthy">
        <summary>{healthy.length} SKUs fully covered</summary>
        <p>
          {healthy.map((s, i) => (
            <span key={s.skuId}>
              {i > 0 && ' · '}
              <button className="link" onClick={() => onOpenAllocation(s.skuId)}>
                {s.name}
              </button>
            </span>
          ))}
        </p>
      </details>
    </section>
  )
}
