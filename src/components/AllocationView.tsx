/**
 * Screen 2: Allocation table.
 * Shows the engine's recommendation per market with the reasoning one click away.
 * The planner can type a different ship quantity: the engine locks it, re-spreads
 * the rest of the supply, and the impact tiles at the top update immediately.
 */
import { Fragment, useState } from 'react'
import { addDays, fmtDate, planSku } from '../engine/allocation'
import type { Overrides } from '../engine/allocation'
import type { AccountLine, Settings, World } from '../engine/types'
import { RULE_LABEL, d, n, pct } from '../ui/format'

interface Props {
  world: World
  skuId: string
  setSkuId: (id: string) => void
  settings: Settings
  nearWeight: number
  setNearWeight: (w: number) => void
  overrides: Overrides
  setOverrides: (o: Overrides) => void
  onDraftNote: (marketId: string) => void
}

const ACTION_CLASS: Record<AccountLine['action'], string> = {
  SHIP: 'pill green',
  PARTIAL: 'pill amber',
  HOLD: 'pill gray',
  'NO ORDER': 'pill light',
}

export default function AllocationView(props: Props) {
  const { world, skuId, setSkuId, settings, nearWeight, setNearWeight, overrides, setOverrides, onDraftNote } = props
  const [open, setOpen] = useState<string | null>(null)

  const recommended = planSku(world, skuId, settings)
  const plan = planSku(world, skuId, settings, overrides)
  const s = plan.summary
  const sc = world.scenarios.find((x) => x.skuId === skuId)
  const hasOverrides = Object.keys(overrides).length > 0
  const shipped = plan.lines.reduce((a, l) => a + l.ship, 0)

  const setQty = (marketId: string, raw: string) => {
    const next = { ...overrides }
    if (raw.trim() === '') delete next[marketId]
    else next[marketId] = Math.max(0, Math.round(Number(raw) || 0))
    setOverrides(next)
  }
  const clearOne = (marketId: string) => {
    const next = { ...overrides }
    delete next[marketId]
    setOverrides(next)
  }

  const delta = (now: number, rec: number, goodWhenLower: boolean) => {
    if (!hasOverrides || now === rec) return null
    const better = goodWhenLower ? now < rec : now > rec
    return (
      <span className={better ? 'delta good' : 'delta bad'}>
        {now > rec ? '+' : ''}
        {n(now - rec)} vs recommended
      </span>
    )
  }

  return (
    <section>
      <div className="toolbar">
        <label className="field">
          <span>SKU</span>
          <select
            value={skuId}
            onChange={(e) => {
              setSkuId(e.target.value)
              setOpen(null)
            }}
          >
            {world.skus.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
                {planSku(world, k.id, settings).summary.isShort ? '  (short)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="field slider">
          <span>
            Forecast blend: depletions {pct(nearWeight)} in week 1 → {pct(1 - nearWeight)} in week {world.horizonWeeks}
          </span>
          <input
            type="range"
            min={0.5}
            max={1}
            step={0.05}
            value={nearWeight}
            onChange={(e) => setNearWeight(Number(e.target.value))}
          />
          <small className="muted">
            Near term trusts what consumers buy (depletions). Further out leans on what distributors plan to order
            (shipments). In a shortage some distributors inflate orders, so slide right to discount them.
          </small>
        </label>
      </div>

      {sc && (
        <p className="scenario-line">
          <strong>{sc.title}.</strong> {sc.story}
        </p>
      )}

      <div className="tiles">
        <div className="tile">
          <span>Plant supply</span>
          <strong>{n(s.availableNow)}</strong>
          <small>vs {n(s.openOrderQty)} ordered ({pct(s.fillRate)} fill)</small>
        </div>
        <div className="tile">
          <span>Supply lands</span>
          <strong>{fmtDate(s.runDate)}</strong>
          <small>
            in {s.daysToRun} days · {n(s.runQty)} cs · buffer {s.bufferDays}d
          </small>
        </div>
        <div className={plan.overAllocated ? 'tile alert' : 'tile'}>
          <span>{plan.overAllocated ? 'Over-allocated' : 'Left unallocated'}</span>
          <strong>{n(plan.overAllocated || plan.unallocated)}</strong>
          <small>{plan.overAllocated ? 'Ship quantities exceed plant supply' : `${n(shipped)} cs allocated`}</small>
        </div>
        <div className="tile">
          <span>Markets out before the run</span>
          <strong>{s.isShort ? s.marketsAtRiskAfter : 0}</strong>
          <small>
            {s.isShort ? `${s.marketsAtRiskBefore} if nothing ships` : 'Not short: all orders fill'}{' '}
            {delta(s.marketsAtRiskAfter, recommended.summary.marketsAtRiskAfter, true)}
          </small>
        </div>
        <div className="tile" title="Cases of consumer demand that go unserved before supply lands">
          <span>Demand at risk (lost sales)</span>
          <strong>{n(s.demandAtRiskCases)}</strong>
          <small>
            cs before {fmtDate(s.runDate)} {delta(s.demandAtRiskCases, recommended.summary.demandAtRiskCases, true)}
          </small>
        </div>
        <div className="tile">
          <span>Cases backordered</span>
          <strong>{n(s.backorderQty)}</strong>
          <small>{delta(s.backorderQty, recommended.summary.backorderQty, true) ?? 'ship when the run lands'}</small>
        </div>
      </div>

      {plan.overAllocated > 0 && (
        <div className="banner alert">
          Your overrides ship {n(plan.overAllocated)} more cases than the plant has. Reduce a quantity or reset.
        </div>
      )}

      <details className="buffer-why">
        <summary>
          Why a {s.bufferDays}-day buffer and a {s.daysToRun + s.bufferDays}-day hold line?
        </summary>
        <ul>
          {s.bufferWhy.map((b) => (
            <li key={b}>{b}</li>
          ))}
          <li>
            Markets with at least {s.daysToRun} days to the run + {s.bufferDays} buffer = {s.daysToRun + s.bufferDays}{' '}
            days of cover are held so supply goes where it prevents stockouts.
          </li>
        </ul>
      </details>

      {plan.transfers.length > 0 && (
        <div className="transfers">
          <h3>⇄ Suggested intracompany transfers (between a distributor's own markets)</h3>
          {plan.transfers.map((t) => (
            <div key={t.fromMarketId + t.toMarketId} className="transfer">
              <div className="transfer-head">
                <strong>
                  {t.distributorName}: {n(t.qty)} cs {t.fromState} → {t.toState}
                </strong>
                <span className="pill blue">Arrives in {t.arrivesInDays} days</span>
              </div>
              <p>{t.reason}</p>
            </div>
          ))}
        </div>
      )}

      <div className="table-head">
        <h3>Recommended allocation, lowest cover first</h3>
        {hasOverrides && (
          <button className="secondary" onClick={() => setOverrides({})}>
            Reset all overrides
          </button>
        )}
      </div>
      <p className="muted hint">Click a row to see the reasoning. Type in the Ship column to override.</p>

      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>Distributor · market</th>
              <th className="num" title="Blended forecast, average cases per day">Cs/day</th>
              <th className="num" title="On hand plus in-transit arriving within 7 days">Days on hand</th>
              <th className="num" title="Days of cover including later inbound and transfers, before any plant shipment">
                Cover before
              </th>
              <th className="num">Ordered</th>
              <th className="num">Recommended</th>
              <th className="num">Ship</th>
              <th className="num">Backorder</th>
              <th className="num">Cover after</th>
              <th>Action</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {plan.lines.map((l) => {
              const isOpen = open === l.marketId
              const runsOut = l.stockoutBeforeRun
              return (
                <Fragment key={l.marketId}>
                  <tr
                    className={`row ${isOpen ? 'open' : ''} ${l.orderQty <= 0 ? 'dim' : ''}`}
                    onClick={() => setOpen(isOpen ? null : l.marketId)}
                  >
                    <td>
                      <div className="dist">
                        <span className="caret">{isOpen ? '▾' : '▸'}</span>
                        <div>
                          <div>
                            {l.distributorName} <span className="state">{l.state}</span>
                          </div>
                          {l.priority && <span className="pill purple small">{l.priority}</span>}
                          {(l.transferIn > 0 || l.transferOut > 0) && (
                            <span className="pill blue small">
                              {l.transferIn > 0 ? `⇄ +${n(l.transferIn)} transfer` : `⇄ −${n(l.transferOut)} transfer`}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="num">{l.avgDaily.toFixed(1)}</td>
                    <td className={`num ${l.dohToday < 14 ? 'red-text' : ''}`}>{d(l.dohToday)}</td>
                    <td className="num">{d(l.coverBefore)}</td>
                    <td className="num">{l.orderQty ? n(l.orderQty) : '–'}</td>
                    <td className="num muted">{l.orderQty ? n(l.recommendedShip) : '–'}</td>
                    <td className="num" onClick={(e) => e.stopPropagation()}>
                      {l.orderQty > 0 || l.overridden ? (
                        <div className="qty">
                          <input
                            type="number"
                            min={0}
                            className={l.overridden ? 'overridden' : ''}
                            value={l.ship}
                            aria-label={`Ship quantity for ${l.distributorName} ${l.state}`}
                            onChange={(e) => setQty(l.marketId, e.target.value)}
                          />
                          {l.overridden && (
                            <button className="icon" title="Back to recommended" onClick={() => clearOne(l.marketId)}>
                              ↺
                            </button>
                          )}
                        </div>
                      ) : (
                        '–'
                      )}
                    </td>
                    <td className="num">{l.backorderQty ? n(l.backorderQty) : '–'}</td>
                    <td className={`num ${runsOut ? 'red-text strong' : ''}`}>
                      {d(l.coverAfter)}
                      {runsOut && (
                        <div className="tiny">out ~{fmtDate(addDays(world.asOf, Math.floor(l.coverAfter)))}</div>
                      )}
                    </td>
                    <td>
                      <span className={ACTION_CLASS[l.action]}>{l.action}</span>
                    </td>
                    <td className="why">{RULE_LABEL[l.rule]}</td>
                  </tr>
                  {isOpen && (
                    <tr className="detail">
                      <td colSpan={11}>
                        <div className="detail-body">
                          <div>
                            <h4>Reasoning</h4>
                            <ol>
                              {l.reasons.map((r, i) => (
                                <li key={i}>{r}</li>
                              ))}
                            </ol>
                          </div>
                          {l.orders.length > 0 && (
                            <div>
                              <h4>Open orders</h4>
                              <table className="mini">
                                <thead>
                                  <tr>
                                    <th>PO</th>
                                    <th>Wanted</th>
                                    <th className="num">Qty</th>
                                    <th className="num">Ships</th>
                                    <th className="num">Backorder</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {l.orders.map((o) => (
                                    <tr key={o.id}>
                                      <td>{o.id}</td>
                                      <td>{o.requestedWeek === 0 ? 'This week' : `Week ${o.requestedWeek + 1}`}</td>
                                      <td className="num">{n(o.qty)}</td>
                                      <td className="num">{n(o.filled)}</td>
                                      <td className={`num ${o.backordered ? 'red-text' : ''}`}>{n(o.backordered)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {l.backorderQty > 0 && (
                                <button className="primary small-btn" onClick={() => onDraftNote(l.marketId)}>
                                  Draft customer note →
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
