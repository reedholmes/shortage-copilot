/**
 * App shell: header, customer switcher, tabs, and the shared state every screen reads.
 * State lives here (not in each screen) so an override made on the allocation
 * screen is still there when you visit the customer note and come back.
 */
import { useMemo, useState } from 'react'
import worldJson from './data/world.json'
import { fmtDate } from './engine/allocation'
import type { Overrides } from './engine/allocation'
import { CUSTOMERS, DEFAULT_CUSTOMER_ID, getCustomer, settingsFromConfig } from './engine/customerConfig'
import type { World } from './engine/types'
import Overview from './components/Overview'
import AllocationView from './components/AllocationView'
import CompareCustomers from './components/CompareCustomers'
import CustomerNote from './components/CustomerNote'
import HowItWorks from './components/HowItWorks'

const world = worldJson as World

type Tab = 'overview' | 'allocation' | 'note' | 'compare' | 'how'
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: '1. Shortage overview' },
  { id: 'allocation', label: '2. Allocation' },
  { id: 'note', label: '3. Customer note' },
  { id: 'compare', label: 'Compare customers' },
  { id: 'how', label: 'How it works' },
]

export default function App() {
  const [tab, setTabState] = useState<Tab>('overview')
  const setTab = (t: Tab) => {
    setTabState(t)
    window.scrollTo(0, 0) // each screen starts at the top
  }
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

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Shortage Allocation Copilot</h1>
          <p className="sub">
            Synthetic demo data · as of {fmtDate(world.asOf)}, 2026 · all quantities in 9L cases
          </p>
          <label className="customer-pick">
            <span>Customer rules:</span>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              {CUSTOMERS.map((c) => (
                <option key={c.customer.id} value={c.customer.id}>
                  {c.customer.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <nav className="tabs" aria-label="Screens">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main>
        {tab === 'overview' && (
          <Overview
            world={world}
            settings={settings}
            onOpen={(id) => {
              setSkuId(id)
              setTab('allocation')
            }}
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
          />
        )}
        {tab === 'compare' && <CompareCustomers world={world} skuId={skuId} setSkuId={setSkuId} />}
        {tab === 'how' && <HowItWorks />}
      </main>

      <footer className="footer">
        Portfolio demo. All companies, brands and numbers are invented. Allocation logic runs in your browser.
      </footer>
    </div>
  )
}
