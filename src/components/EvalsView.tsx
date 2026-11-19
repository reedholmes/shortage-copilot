/**
 * Evals screen: runs every shortage scenario through the engine, live in the browser,
 * and shows the scorecard. Same runner as `npm run evals`.
 */
import { Fragment, useMemo, useState } from 'react'
import { runAll } from '../evals/runner'
import { SCENARIOS } from '../evals/scenarios'
import { getCustomer } from '../engine/customerConfig'

export default function EvalsView() {
  const card = useMemo(() => runAll(SCENARIOS), [])
  const [open, setOpen] = useState<string | null>(null)
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`

  return (
    <section>
      <div className="intro">
        <h2>Test suite: does the agent follow the rule book?</h2>
        <p>
          {SCENARIOS.length} shortage scenarios, each with the answer worked out by hand from the customer's rules
          before the engine ever ran it. They just ran again in your browser. A config change or code change that breaks
          a rule shows up here before it reaches a customer.
        </p>
      </div>

      <div className="tiles three">
        <div className={card.scenariosPassed === card.scenarios.length ? 'tile' : 'tile alert'}>
          <span className="tile-label">Scenarios passed</span>
          <strong className={card.scenariosPassed === card.scenarios.length ? 'green-text' : 'red-text'}>
            {card.scenariosPassed} / {card.scenarios.length}
          </strong>
        </div>
        <div className="tile">
          <span className="tile-label">Accuracy</span>
          <strong>{pct(card.accuracy)}</strong>
          <small className="muted">
            {card.checksPassed} of {card.checksTotal} expected outcomes matched
          </small>
        </div>
        <div className="tile">
          <span className="tile-label">Edge cases covered</span>
          <strong>{card.scenarios.filter((s) => s.category === 'Edge case').length}</strong>
          <small className="muted">zero supply, late run, priority conflict, bad data, large line</small>
        </div>
      </div>

      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>ID</th>
              <th>Scenario</th>
              <th>Type</th>
              <th>Customer rules</th>
              <th className="num">Checks</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {card.scenarios.map((s) => {
              const ok = s.checks.filter((c) => c.passed).length
              const isOpen = open === s.id
              return (
                <Fragment key={s.id}>
                  <tr className={`row ${isOpen ? 'open' : ''}`} onClick={() => setOpen(isOpen ? null : s.id)}>
                    <td>
                      <span className="caret">{isOpen ? '▾' : '▸'}</span> {s.id}
                    </td>
                    <td className="strong">{s.title}</td>
                    <td>
                      <span className={s.category === 'Edge case' ? 'pill amber small' : s.category === 'Customer rules' ? 'pill purple small' : 'pill gray small'}>
                        {s.category}
                      </span>
                    </td>
                    <td>{getCustomer(s.customer).customer.name}</td>
                    <td className="num">
                      {ok}/{s.checks.length}
                    </td>
                    <td>
                      <span className={s.passed ? 'pill green' : 'pill red'}>{s.passed ? 'PASS' : 'FAIL'}</span>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="detail">
                      <td colSpan={6}>
                        <div className="detail-body">
                          <div>
                            <h4>The situation</h4>
                            <p className="story">{s.story}</p>
                            {s.error && <p className="red-text">Could not run: {s.error}</p>}
                          </div>
                          <div>
                            <h4>Expected vs actual</h4>
                            <table className="mini">
                              <thead>
                                <tr>
                                  <th>Check</th>
                                  <th>Expected</th>
                                  <th>Actual</th>
                                  <th></th>
                                </tr>
                              </thead>
                              <tbody>
                                {s.checks.map((c, i) => (
                                  <tr key={i}>
                                    <td>{c.label}</td>
                                    <td>{c.expected}</td>
                                    <td className={c.passed ? '' : 'red-text strong'}>{c.actual}</td>
                                    <td>{c.passed ? '✓' : '✗'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
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
      <p className="muted hint compare-note">
        Run the same suite from the command line with <code>npm run evals</code>. It writes evals/scorecard.md and fails
        the build if any scenario fails.
      </p>
    </section>
  )
}
