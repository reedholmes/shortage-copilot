/**
 * Screen 3: Customer note.
 * Milestone 2 shows the facts the AI will be given. Milestone 4 adds the AI draft.
 * Keeping the facts separate (and computed by the engine, not the AI) means the
 * email can't invent quantities or dates: the AI only writes the words.
 */
import { fmtDate, planSku } from '../engine/allocation'
import type { Overrides } from '../engine/allocation'
import type { Settings, World } from '../engine/types'
import { n } from '../ui/format'

interface Props {
  world: World
  skuId: string
  setSkuId: (id: string) => void
  settings: Settings
  overrides: Overrides
  marketId: string | null
  setMarketId: (id: string | null) => void
}

export default function CustomerNote({ world, skuId, setSkuId, settings, overrides, marketId, setMarketId }: Props) {
  const plan = planSku(world, skuId, settings, overrides)
  const affected = plan.lines.filter((l) => l.backorderQty > 0)
  const line = affected.find((l) => l.marketId === marketId) ?? affected[0]
  const sku = world.skus.find((k) => k.id === skuId)!

  const facts = line && {
    distributor: line.distributorName,
    market: line.state,
    sku: sku.name,
    orderedCases: line.orderQty,
    shippingNowCases: line.ship,
    backorderedCases: line.backorderQty,
    supplyLandsOn: fmtDate(plan.summary.runDate),
    daysOrdersWillSit: plan.summary.daysToRun,
    transferIncomingCases: line.transferIn || undefined,
  }

  return (
    <section>
      <div className="intro">
        <h2>Out-of-stock note</h2>
        <p>
          Pick a distributor with a backorder. The engine supplies the facts. In the next milestone an AI model will draft
          the email from these facts and return it as structured JSON.
        </p>
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

      {!line ? (
        <p className="muted">No backorders on this SKU. Every open order ships in full.</p>
      ) : (
        <div className="note-grid">
          <div className="card">
            <h3>Facts sent to the AI</h3>
            <pre className="json">{JSON.stringify(facts, null, 2)}</pre>
          </div>
          <div className="card placeholder">
            <h3>Draft email</h3>
            <p className="muted">Coming in Milestone 4: subject line, body and a summary, drafted by AI from these facts.</p>
            <button className="primary" disabled>
              Draft with AI
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
