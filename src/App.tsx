/**
 * App shell: header, tabs, and the shared state every screen reads.
 * State lives here (not in each screen) so an override made on the allocation
 * screen is still there when you visit the customer note and come back.
 */
import { useMemo, useState } from 'react'
import worldJson from './data/world.json'
import { DEFAULT_SETTINGS, fmtDate } from './engine/allocation'
import type { Overrides } from './engine/allocation'
import type { World } from './engine/types'
import Overview from './components/Overview'
import AllocationView from './components/AllocationView'
import CustomerNote from './components/CustomerNote'
import HowItWorks from './components/HowItWorks'

const world = worldJson as World

type Tab = 'overview' | 'allocation' | 'note' | 'how'
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: '1. Shortage overview' },
  { id: 'allocation', label: '2. Allocation' },
  { id: 'note', label: '3. Customer note' },
  { id: 'how', label: 'How it works' },
]

export default function App() {
  const [tab, setTabState] = useState<Tab>('overview')
  const setTab = (t: Tab) => {
    setTabState(t)
    window.scrollTo(0, 0) // each screen starts at the top
  }
  const [skuId, setSkuId] = useState(world.scenarios[0].skuId)
  const [noteMarketId, setNoteMarketId] = useState<string | null>(null)
  const [nearWeight, setNearWeight] = useState(DEFAULT_SETTINGS.nearDepletionWeight)
  /** Overrides are kept per SKU: { skuId: { marketId: cases } } */
  const [overridesBySku, setOverridesBySku] = useState<Record<string, Overrides>>({})

  const settings = useMemo(() => ({ ...DEFAULT_SETTINGS, nearDepletionWeight: nearWeight }), [nearWeight])
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
            world={world}
            skuId={skuId}
            setSkuId={setSkuId}
            settings={settings}
            overrides={overrides}
            marketId={noteMarketId}
            setMarketId={setNoteMarketId}
          />
        )}
        {tab === 'how' && <HowItWorks />}
      </main>

      <footer className="footer">
        Portfolio demo. All companies, brands and numbers are invented. Allocation logic runs in your browser.
      </footer>
    </div>
  )
}
