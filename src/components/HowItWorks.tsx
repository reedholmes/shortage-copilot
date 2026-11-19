/** "How it works" panel, opened from the header. Four ideas, one line each. */
export default function HowItWorks({ onClose }: { onClose: () => void }) {
  return (
    <section className="how-panel" aria-label="How it works">
      <div className="table-head">
        <h3>How it works</h3>
        <button className="link" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="how-cards">
        <div>
          <h3>Agent investigates</h3>
          <p>Claude checks inventory, demand, orders and cover with six tools, explaining each step.</p>
        </div>
        <div>
          <h3>Engine decides the numbers</h3>
          <p>Tested code applies the customer's rules. No tool accepts a quantity, so the AI can't change one.</p>
        </div>
        <div>
          <h3>Rules live in config</h3>
          <p>Each customer is a JSON file. Same shortage, different rules, different answer.</p>
        </div>
        <div>
          <h3>People approve the hard calls</h3>
          <p>Code routes risky lines to an approval queue. 15 signed-off scenarios test every change.</p>
        </div>
      </div>
      <p className="how-foot">
        Runs on a Cloudflare Worker with Claude Opus 5.5. Rate limited, saved runs, scripted fallback. All data synthetic.{' '}
        <a href="https://github.com/reedholmes/shortage-copilot" target="_blank" rel="noreferrer">
          Code and deployment docs on GitHub →
        </a>
      </p>
    </section>
  )
}
