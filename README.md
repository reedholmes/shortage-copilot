# Shortage Allocation Copilot

A working demo of how a supply planner allocates scarce inventory across distributors during a shortage, then drafts the customer communication.

Built by Reed Holmes, supply chain planner (6 years in CPG, wine and spirits). All companies, brands and numbers are synthetic.

> Work in progress. Full write-up, screenshots and architecture diagram coming soon.

## What it does

1. **Shortage overview**: which SKUs are short, by how much, and until when.
2. **Allocation**: recommended ship / hold / transfer for every distributor market, with the reasoning on every line. Override any quantity and see the impact (markets stocking out, lost sales) update instantly.
3. **Customer note**: the out-of-stock email to an affected distributor (AI drafting in progress).

## The planning method

1. Blend shipment and depletion forecasts (depletions weighted near term, adjustable)
2. Days on hand per market (in-transit arriving within a week counts as on hand)
3. Flag open orders the shortage will backorder
4. Rank markets by cover, lowest first
5. Hold orders for markets covered to the next production run plus a safety buffer
6. Ship priority accounts at stockout risk first, then spread supply toward equal days of cover
7. Suggest transfers between a distributor's own markets (long to short, 1-week lead time)

The logic lives in [`src/engine/allocation.ts`](src/engine/allocation.ts) and is covered by tests in [`src/engine/allocation.test.ts`](src/engine/allocation.test.ts).

## Run it locally

```bash
npm install
npm run dev      # app at http://localhost:5173
npm test         # allocation tests
npm run seed     # regenerate synthetic data
npm run report   # planner-readable review in docs/allocation-review.md
```
