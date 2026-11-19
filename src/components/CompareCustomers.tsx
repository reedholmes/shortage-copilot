/**
 * Compare customers: the same shortage run under two customers' rules.
 * Nothing in the engine changes between the columns, only the config file it reads.
 */
import { planSku } from '../engine/allocation'
import { CUSTOMERS, settingsFromConfig } from '../engine/customerConfig'
import type { CustomerConfig } from '../engine/customerConfig'
import type { AccountLine, Plan, World } from '../engine/types'
import { RULE_LABEL, d, n, pct } from '../ui/format'

interface Props {
  world: World
  skuId: string
  setSkuId: (id: string) => void
}

const POLICY = { equal_days_of_cover: 'Equal days of cover (lowest cover first)', fair_share: 'Fair share (same % of every order)' }
const PRIORITY = { only_when_at_risk: 'Jump the line only if they would stock out', always_first: 'Always served first, full order' }

const RULES: { label: string; get: (c: CustomerConfig) => string }[] = [
  { label: 'How short supply is split', get: (c) => POLICY[c.allocation.policy] },
  { label: 'Priority accounts', get: (c) => PRIORITY[c.priorityAccounts.rule] },
  { label: 'Minimum cover past the run', get: (c) => `${c.safetyBuffer.minimumDaysPastRun} days` },
  { label: 'Hold markets already covered', get: (c) => (c.allocation.holdMarketsCoveredPastRun ? 'Yes' : 'No') },
  {
    label: 'Intracompany transfers',
    get: (c) => (c.transfers.enabled ? `On (long = over ${c.transfers.longThresholdDays} days)` : 'Off'),
  },
  {
    label: 'Needs approval',
    get: (c) => `Fill under ${pct(c.approval.fillRateBelow)}, lines over ${n(c.approval.lineOverCases)} cs`,
  },
  { label: 'Email tone', get: (c) => c.customerEmail.tone },
]

export default function CompareCustomers({ world, skuId, setSkuId }: Props) {
  const plans = CUSTOMERS.map((c) => ({ c, plan: planSku(world, skuId, settingsFromConfig(c)) }))
  const [a, b] = plans
  const byMarket = (p: Plan) => new Map(p.lines.map((l) => [l.marketId, l]))
  const bLines = byMarket(b.plan)
  const rows = a.plan.lines.filter((l) => l.orderQty > 0 || l.transferIn || l.transferOut)
  const shortSkus = world.skus.filter((s) => planSku(world, s.id, settingsFromConfig(a.c)).summary.isShort)

  return (
    <section>
      <div className="intro">
        <h2>Same shortage, two customers</h2>
        <p>
          Both columns run the identical engine on identical data. The only difference is the customer config file it
          reads. Onboarding a new customer means writing their rules down, not rewriting code.
        </p>
      </div>

      <div className="toolbar">
        <label className="field">
          <span>Shortage event</span>
          <select value={skuId} onChange={(e) => setSkuId(e.target.value)}>
            {shortSkus.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>Rule (from config)</th>
              {plans.map(({ c }) => (
                <th key={c.customer.id}>
                  {c.customer.name}
                  <div className="tiny muted">config/customer_{c.customer.id}.json</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {RULES.map((r) => {
              const vals = plans.map(({ c }) => r.get(c))
              const differs = new Set(vals).size > 1
              return (
                <tr key={r.label} className={differs ? 'differs' : ''}>
                  <td className="strong">{r.label}</td>
                  {vals.map((v, i) => (
                    <td key={i}>{v}</td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="muted hint compare-note">Highlighted rows are rules that differ between the two customers.</p>

      <h3 className="section-h">Outcome</h3>
      <div className="compare-cols">
        {plans.map(({ c, plan }, i) => {
          const other = plans[1 - i].plan.summary
          const s = plan.summary
          const delta = (mine: number, theirs: number) =>
            mine === theirs ? null : (
              <span className={mine < theirs ? 'delta good' : 'delta bad'}>
                {mine > theirs ? '+' : ''}
                {n(mine - theirs)} vs other
              </span>
            )
          return (
            <div key={c.customer.id} className="card">
              <h3>{c.customer.name}</h3>
              <p className="story">{c.customer.summary}</p>
              <dl className="stats compare-stats">
                <div>
                  <dt>Markets out before run</dt>
                  <dd>{s.marketsAtRiskAfter}</dd>
                  {delta(s.marketsAtRiskAfter, other.marketsAtRiskAfter)}
                </div>
                <div>
                  <dt>Lost sales (cs)</dt>
                  <dd>{n(s.demandAtRiskCases)}</dd>
                  {delta(s.demandAtRiskCases, other.demandAtRiskCases)}
                </div>
                <div>
                  <dt>Backordered (cs)</dt>
                  <dd>{n(s.backorderQty)}</dd>
                </div>
                <div>
                  <dt>Transfers</dt>
                  <dd>{s.transferCount}</dd>
                </div>
              </dl>
            </div>
          )
        })}
      </div>

      <h3 className="section-h">Line by line</h3>
      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>Distributor · market</th>
              <th className="num">Cover before</th>
              <th className="num">Ordered</th>
              <th className="num">{a.c.customer.name}</th>
              <th className="num">{b.c.customer.name}</th>
              <th className="num">Difference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((la) => {
              const lb = bLines.get(la.marketId)!
              const diff = lb.ship - la.ship
              return (
                <tr key={la.marketId}>
                  <td>
                    {la.distributorName} <span className="state">{la.state}</span>
                    {la.priority && <span className="pill purple small">{la.priority}</span>}
                  </td>
                  <td className="num">{d(la.coverBefore)}</td>
                  <td className="num">{la.orderQty ? n(la.orderQty) : '–'}</td>
                  <ShipCell l={la} />
                  <ShipCell l={lb} />
                  <td className={`num strong ${diff > 0 ? 'green-text' : diff < 0 ? 'red-text' : 'muted'}`}>
                    {diff === 0 ? '–' : (diff > 0 ? '+' : '') + n(diff)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ShipCell({ l }: { l: AccountLine }) {
  return (
    <td className="num">
      <div className="strong">{n(l.ship)}</div>
      <div className="tiny muted">{RULE_LABEL[l.rule]}</div>
      {l.stockoutBeforeRun && <div className="tiny red-text">runs out ~{d(l.coverAfter)}</div>}
    </td>
  )
}
