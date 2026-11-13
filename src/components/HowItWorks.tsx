/** In-app explainer: the planning method in plain English. */
export default function HowItWorks() {
  return (
    <section className="how">
      <div className="intro">
        <h2>How it works</h2>
        <p>
          When supply can't cover every order before the next production run, a planner has to decide who ships, who
          waits, and how to tell them. This tool follows a real planner's method and shows its reasoning on every line.
        </p>
      </div>
      <ol className="steps">
        <li>
          <strong>Blend the forecasts.</strong> Depletions (what consumers buy) get the most weight near term.
          Shipments (what distributors plan to order) get more weight further out. The slider sets the mix. It matters
          most in a shortage, when some distributors inflate orders to win a bigger share.
        </li>
        <li>
          <strong>Days on hand.</strong> On hand plus anything in transit arriving within a week, divided by average daily
          demand. Later arrivals count toward reaching the run, but not as stock on the floor.
        </li>
        <li>
          <strong>Flag backorders.</strong> Any open order the supply can't fill is backordered until the run lands.
        </li>
        <li>
          <strong>Rank by cover,</strong> lowest first.
        </li>
        <li>
          <strong>Hold</strong> orders for markets that already reach the next run plus a safety buffer. The buffer is 7
          days, plus 3 for top-selling SKUs and 4 for SKUs with jumpy demand.
        </li>
        <li>
          <strong>Ship to prevent stockouts.</strong> Priority accounts (national accounts, key distributors) jump the
          line only if they would run out before the run. The rest of the supply is spread so low-cover markets end at
          about the same days of cover, never more than they ordered.
        </li>
        <li>
          <strong>Intracompany transfers.</strong> If one of a distributor's markets is long (over 90 days) and
          another would run out, suggest moving stock between them. One-week lead time, and the long market keeps enough
          to reach the run.
        </li>
      </ol>
      <div className="card">
        <h3>Under the hood</h3>
        <p>
          The allocation logic is plain TypeScript running in your browser, so overrides recalculate instantly. It is
          covered by automated tests. The data is 100% synthetic, from a seed script.
        </p>
        <p>
          The customer note is written by Claude (Opus 5.5) on a small Cloudflare server function. The browser sends only
          IDs and numbers; the server recomputes the facts with the same engine and asks Claude for a JSON email. The AI
          writes the words, never the numbers. Per-visitor rate limits, a daily cap and saved drafts keep the demo cheap,
          and a template email takes over if the AI is unavailable.
        </p>
        <p>
          <a href="https://github.com/reedholmes/shortage-copilot" target="_blank" rel="noreferrer">
            Source code and full write-up on GitHub →
          </a>
        </p>
      </div>
    </section>
  )
}
