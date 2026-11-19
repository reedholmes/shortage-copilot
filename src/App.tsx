/**
 * App shell: header, customer switcher, tabs, and the shared state every screen reads.
 * State lives here (not in each screen) so an override made on the allocation
 * screen is still there when you open a customer note and come back.
 */
import { useMemo, useState } from 'react'
import worldJson from './data/world.json'
import { fmtDate } from './engine/allocation'
import type { Overrides } from './engine/allocation'
import { CUSTOMERS, DEFAULT_CUSTOMER_ID, getCustomer, settingsFromConfig } from './engine/customerConfig'
import type { World } from './engine/types'
import Overview from './components/Overview'
import AgentRun from './components/AgentRun'
import AllocationView from './components/AllocationView'
import CompareCustomers from './components/CompareCustomers'
import CustomerNote from './components/CustomerNote'
import EvalsView from './components/EvalsView'
import HowItWorks from './components/HowItWorks'

const world = worldJson as World

/** 'note' is not a tab: it opens from an allocation row. */
type Tab = 'overview' | 'agent' | 'allocation' | 'compare' | 'evals' | 'note'
const TABS: { id: Exclude<Tab, 'note'>; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'agent', label: 'Agent' },
  { id: 'allocation', label: 'Allocation' },
  { id: 'compare', label: 'Compare customers' },
  { id: 'evals', label: 'Evals' },
]

export default function App() {
  const [tab, setTabState] = useState<Tab>('overview')
  const setTab = (t: Tab) => {
    setTabState(t)
    window.scrollTo(0, 0) // each screen starts at the top
  }
  const [showHow, setShowHow] = useState(false)
  const [customerId, setCustomerIdState] = useState(DEFAULT_CUSTOMER_ID)
  const customer = getCustomer(customerId)
  const [skuId, setSkuId] = useState(world.scenarios[0].skuId)
  const [noteMarketId, setNoteMarketId] = useState<string | null>(null)
  const [nearWeight, setNearWeight] = useState(customer.forecast.depletionWeightWeek1)
  /** Overrides are kept per SKU: { skuId: { marketId: cases } } */
  const [overridesBySku, setOverridesBySku] = useState<Record<string, Overrides>>({})

  // Switching customer starts clean: their own forecast default, no overrides.
  const setCustomerId = (id: string) => {
    setCustomerIdState(id)
    setNearWeight(getCustomer(id).forecast.depletionWeightWeek1)
    setOverridesBySku({})
    setNoteMarketId(null)
  }

  const settings = useMemo(
    () => ({ ...settingsFromConfig(getCustomer(customerId)), nearDepletionWeight: nearWeight }),
    [customerId, nearWeight],
  )
  const overrides = overridesBySku[skuId] ?? {}
  const setOverrides = (o: Overrides) => setOverridesBySku((all) => ({ ...all, [skuId]: o }))
  const open = (id: string, where: Tab) => {
    setSkuId(id)
    setTab(where)
  }

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <h1>Shortage Allocation Copilot</h1>
          <span className="sub">Synthetic data · as of {fmtDate(world.asOf)}, 2026 · 9L cases</span>
        </div>
        <div className="header-right">
          <label className="customer-pick" title="Whose operating rules the agent and engine apply">
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} aria-label="Customer rules">
              {CUSTOMERS.map((c) => (
                <option key={c.customer.id} value={c.customer.id}>
                  {c.customer.name}
                </option>
              ))}
            </select>
          </label>
          <button className={showHow ? 'info-btn on' : 'info-btn'} onClick={() => setShowHow((v) => !v)}>
            ⓘ How it works
          </button>
        </div>
        <nav className="tabs" aria-label="Screens">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id || (tab === 'note' && t.id === 'allocation') ? 'tab active' : 'tab'}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {showHow && <HowItWorks onClose={() => setShowHow(false)} />}

      <main>
        {tab === 'overview' && (
          <Overview
            world={world}
            settings={settings}
            onRunAgent={(id) => open(id, 'agent')}
            onOpenAllocation={(id) => open(id, 'allocation')}
          />
        )}
        {tab === 'agent' && (
          <AgentRun
            world={world}
            customerId={customerId}
            skuId={skuId}
            setSkuId={setSkuId}
            onOpenAllocation={() => setTab('allocation')}
          />
        )}
        {tab === 'allocation' && (
          <AllocationView
            world={world}
            skuId={skuId}
            setSkuId={setSkuId}
            settings={settings}
            nearWeight={nearWeight}
            setNearWeight={setNearWeight}
            overrides={overrides}
            setOverrides={setOverrides}
            onDraftNote={(marketId) => {
              setNoteMarketId(marketId)
              setTab('note')
            }}
          />
        )}
        {tab === 'note' && (
          <CustomerNote
            customerId={customerId}
            world={world}
            skuId={skuId}
            setSkuId={setSkuId}
            settings={settings}
            overrides={overrides}
            marketId={noteMarketId}
            setMarketId={setNoteMarketId}
            onBack={() => setTab('allocation')}
          />
        )}
        {tab === 'compare' && <CompareCustomers world={world} skuId={skuId} setSkuId={setSkuId} />}
        {tab === 'evals' && <EvalsView />}
      </main>

      <footer className="footer">Portfolio demo. All companies, brands and numbers are invented.</footer>
    </div>
  )
}
