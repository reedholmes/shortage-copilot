/**
 * Screen 1: Shortage overview.
 * Answers "which SKUs are short, by how much, and until when?" at a glance.
 */
import { fmtDate, summarizeAll } from '../engine/allocation'
import type { Settings, World } from '../engine/types'
import { n, pct } from '../ui/format'

interface Props {
  world: World
  settings: Settings
  onOpen: (skuId: string) => void
}

export default function Overview({ world, settings, onOpen }: Props) {
  const summaries = summarizeAll(world, settings)
  const short = summaries.filter((s) => s.isShort)
  const healthy = summaries.filter((s) => !s.isShort)
  const scenario = (id: string) => world.scenarios.find((s) => s.skuId === id)

  return (
    <section>
      <div className="intro">
        <h2>
          {short.length} of {summaries.length} SKUs are short
        </h2>
        <p>
          Plant supply can't cover every open order on these SKUs before the next production run. Pick one to see the
          recommended allocation and why.
        </p>
      </div>

      <div className="cards">
        {short.map((s) => {
          const sc = scenario(s.skuId)
          return (
            <article key={s.skuId} className="card short">
              <div className="card-top">
                <span className="pill red">Short {pct(1 - s.fillRate)}</span>
                <span className="muted">{s.category}</span>
              </div>
              <h3>{s.name}</h3>
              {sc && <p className="scenario-title">{sc.title}</p>}
              {sc && <p className="story">{sc.story}</p>}
              <dl className="stats">
                <div>
                  <dt>Open orders</dt>
                  <dd>{n(s.openOrderQty)}</dd>
                </div>
                <div>
                  <dt>Plant supply</dt>
                  <dd>{n(s.availableNow)}</dd>
                </div>
                <div>
                  <dt>Gap</dt>
                  <dd className="red-text">{n(s.gapQty)}</dd>
                </div>
                <div>
                  <dt>Supply lands</dt>
                  <dd>
                    {fmtDate(s.runDate)} <span className="muted">({s.daysToRun}d)</span>
                  </dd>
                </div>
              </dl>
              <div className="risk">
                <span>Markets running out before the run</span>
                <strong>
                  {s.marketsAtRiskBefore} <span className="muted">if nothing ships</span> →{' '}
                  <span className="green-text">{s.marketsAtRiskAfter}</span>{' '}
                  <span className="muted">with plan</span>
                </strong>
              </div>
              {s.transferCount > 0 && (
                <p className="transfer-note">
                  ⇄ {s.transferCount} intracompany transfer{s.transferCount > 1 ? 's' : ''} suggested
                </p>
              )}
              <button className="primary" onClick={() => onOpen(s.skuId)}>
                Open allocation →
              </button>
            </article>
          )
        })}
      </div>

      <h3 className="section-h">Healthy SKUs</h3>
      <table className="grid compact">
        <thead>
          <tr>
            <th>SKU</th>
            <th className="num">Open orders</th>
            <th className="num">Plant supply</th>
            <th className="num">Supply vs orders</th>
            <th>Next run</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {healthy.map((s) => (
            <tr key={s.skuId}>
              <td>{s.name}</td>
              <td className="num">{n(s.openOrderQty)}</td>
              <td className="num">{n(s.availableNow)}</td>
              <td className="num">{pct(s.availableNow / Math.max(1, s.openOrderQty))}</td>
              <td>{fmtDate(s.runDate)}</td>
              <td>
                <button className="link" onClick={() => onOpen(s.skuId)}>
                  View
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
