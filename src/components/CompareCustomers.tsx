/**
 * Compare customers: the same shortage run under two customers' rules.
 * Nothing in the engine changes between the columns, only the config file it reads.
 * Shows only the rules that differ, the outcome, and the biggest line differences.
 */
import { useState } from 'react'
import { planSku } from '../engine/allocation'
import { CUSTOMERS, settingsFromConfig } from '../engine/customerConfig'
import type { CustomerConfig } from '../engine/customerConfig'
import type { World } from '../engine/types'
import { RULE_LABEL, n, pct } from '../ui/format'

interface Props {
  world: World
  skuId: string
  setSkuId: (id: string) => void
}

const POLICY = { equal_days_of_cover: 'Equal days of cover', fair_share: 'Fair share (same % to all)' }
const PRIORITY = { only_when_at_risk: 'Only if about to stock out', always_first: 'Always first, full order' }

const RULES: { label: string; get: (c: CustomerConfig) => string }[] = [
  { label: 'Split short supply', get: (c) => POLICY[c.allocation.policy] },
  { label: 'Priority accounts', get: (c) => PRIORITY[c.priorityAccounts.rule] },
  { label: 'Minimum cover past the run', get: (c) => `${c.safetyBuffer.minimumDaysPastRun} days` },
  { label: 'Hold covered markets', get: (c) => (c.allocation.holdMarketsCoveredPastRun ? 'Yes' : 'No') },
  { label: 'Intracompany transfers', get: (c) => (c.transfers.enabled ? 'On' : 'Off') },
  { label: 'Approval', get: (c) => `Fill under ${pct(c.approval.fillRateBelow)}, over ${n(c.approval.lineOverCases)} cs` },
  { label: 'Email tone', get: (c) => c.customerEmail.tone },
]
const TOP = 8

export default function CompareCustomers({ world, skuId, setSkuId }: Props) {
  const [showAll, setShowAll] = useState(false)
  const plans = CUSTOMERS.map((c) => ({ c, plan: planSku(world, skuId, settingsFromConfig(c)) }))
  const [a, b] = plans
  const bLines = new Map(b.plan.lines.map((l) => [l.marketId, l]))
  const shortSkus = world.skus.filter((s) => planSku(world, s.id, settingsFromConfig(a.c)).summary.isShort)
  const differing = RULES.map((r) => ({ ...r, vals: plans.map(({ c }) => r.get(c)) })).filter((r) => new Set(r.vals).size > 1)
  const diffs = a.plan.lines
    .filter((l) => l.orderQty > 0)
    .map((la) => ({ la, lb: bLines.get(la.marketId)!, diff: bLines.get(la.marketId)!.ship - la.ship }))
    .filter((x) => x.diff !== 0)
    .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff))
  const shown = showAll ? diffs : diffs.slice(0, TOP)

  return (
    <section>
      <div className="page-h">
        <h2>Same shortage, two customers</h2>
        <p>Same engine, same data. Only the customer's config file changes.</p>
      </div>

      <div className="toolbar">
        <label className="field">
          <span>Shortage</span>
          <select value={skuId} onChange={(e) => setSkuId(e.target.value)}>
            {shortSkus.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="compare-cols">
        {plans.map(({ c, plan }, i) => {
          const s = plan.summary
          const other = plans[1 - i].plan.summary
          const better = (mine: number, theirs: number) => (mine < theirs ? 'green-text' : mine > theirs ? 'red-text' : '')
          return (
            <div key={c.customer.id} className="card">
              <h3>
                {c.customer.name} <span className="muted tiny mono">customer_{c.customer.id}.json</span>
              </h3>
              <div className="compare-nums">
                <div>
                  <div className={`bigdelta ${better(s.marketsAtRiskAfter, other.marketsAtRiskAfter)}`}>
                    {s.marketsAtRiskAfter}
                  </div>
                  <div className="bigdelta-label">markets out</div>
                </div>
                <div>
                  <div className={`bigdelta ${better(s.demandAtRiskCases, other.demandAtRiskCases)}`}>
                    {n(s.demandAtRiskCases)}
                  </div>
                  <div className="bigdelta-label">sales at risk (cs)</div>
                </div>
                <div>
                  <div className="bigdelta">{s.transferCount}</div>
                  <div className="bigdelta-label">transfers</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <h3 className="section-h">
        Rules that differ <span className="muted tiny">{RULES.length - differing.length} other{RULES.length - differing.length === 1 ? ' is' : 's are'} the same</span>
      </h3>
      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>Rule</th>
              {plans.map(({ c }) => (
                <th key={c.customer.id}>{c.customer.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {differing.map((r) => (
              <tr key={r.label}>
                <td className="muted">{r.label}</td>
                {r.vals.map((v, i) => (
                  <td key={i}>{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="section-h">
        Biggest differences <span className="muted tiny">{diffs.length} of {a.plan.lines.filter((l) => l.orderQty > 0).length} lines differ</span>
      </h3>
      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>Distributor · market</th>
              <th className="num">Ordered</th>
              <th className="num">{a.c.customer.name}</th>
              <th className="num">{b.c.customer.name}</th>
              <th className="num">Difference</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ la, lb, diff }) => (
              <tr key={la.marketId}>
                <td>
                  {la.distributorName} <span className="state">{la.state}</span>
                  {la.priority && <span className="pill purple small">{la.priority}</span>}
                </td>
                <td className="num">{n(la.orderQty)}</td>
                <td className={`num ${la.stockoutBeforeRun ? 'red-text' : ''}`} title={RULE_LABEL[la.rule]}>
                  {n(la.ship)}
                </td>
                <td className={`num ${lb.stockoutBeforeRun ? 'red-text' : ''}`} title={RULE_LABEL[lb.rule]}>
                  {n(lb.ship)}
                </td>
                <td className={`num strong ${diff > 0 ? 'green-text' : 'red-text'}`}>
                  {diff > 0 ? '+' : ''}
                  {n(diff)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {diffs.length > TOP && (
        <p className="muted tiny">
          Red quantity = market still runs out.{' '}
          <button className="link" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show top 8' : `Show all ${diffs.length}`}
          </button>
        </p>
      )}
    </section>
  )
}
