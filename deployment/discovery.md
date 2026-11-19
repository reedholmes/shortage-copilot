# Discovery: Acme Beverage Co.

*Mock customer for a portfolio demo. Acme Beverage Co., its distributors and every number below are invented. Figures marked "demo" come from the app's synthetic data; figures marked "customer estimate" are what a customer would tell us in discovery and would be measured, not assumed, during shadow mode.*

## The customer

| | |
|---|---|
| Business | Mid-size wine and spirits supplier selling through distributors (three-tier system) |
| Scope for this deployment | Shortage allocation for core 750ml SKUs: 8 SKUs, 16 distributors, 25 distributor markets, 12 states (demo) |
| Who uses it | Demand and supply planners (2), with sales leadership and customer service affected by the output |
| Executive sponsor | VP Supply Chain |
| Trigger for the project | Three shortages in one quarter (bourbon bottling outage, a tequila promotion that slipped, holiday sparkling demand) each took days to allocate and produced distributor complaints |

## How shortages are handled today

1. **Someone notices.** A planner sees open orders running ahead of on hand, usually in the weekly supply review. Sometimes sales hears about it first from a distributor.
2. **Data pull.** The planner exports open orders from the ERP, pulls the latest depletion report, and copies on-hand and in-transit by market into a spreadsheet. *Customer estimate: 3 to 4 hours.*
3. **First-pass allocation.** The planner allocates in the spreadsheet. The method lives in their head: protect markets about to run out, look after the big accounts, don't ship to markets already sitting on months of stock.
4. **Negotiation.** Sales leadership reviews by email and phone. Key accounts get pulled up, sometimes regardless of their inventory. *Customer estimate: 1 to 2 days of back and forth.*
5. **Release.** Customer service keys the final quantities into the ERP.
6. **Notification.** Customer service emails each backordered distributor, often 2 to 3 days after the decision, in whatever wording that person uses.

## Pain points

| Pain point | What it costs | What we heard |
|---|---|---|
| The method isn't written down | Two planners allocate the same shortage differently; nobody can explain a decision afterward | "If Dana is out, nobody knows why Florida got what it got." |
| Orders, not consumption, drive the split | Distributors who inflate orders in a shortage win more stock; markets with real demand run dry | "Everyone doubles their order the minute they hear we're short." |
| Priority accounts handled by phone | National accounts get stock even with 60+ days on hand, while smaller markets stock out | |
| Slow decisions | 1.5 to 3 days from noticing to releasing (customer estimate), while markets keep selling down | |
| Late, inconsistent customer notes | Distributors find out about backorders from their own receiving dock | |
| Stock stuck in the wrong state | A distributor long in one state and out in another; nobody checks before spending on-hand inventory | |

## What success looks like

Agreed with the VP Supply Chain as the scorecard for go-live. Baselines are customer estimates until shadow mode measures them.

| Metric | Today (customer estimate) | Target | How we measure it |
|---|---|---|---|
| Time from shortage detected to quantities released | 1.5 to 3 days | Same business day | Timestamps: agent run start to last approval |
| Markets that stock out before the next run | Not tracked | At or below the engine's recommended plan | Engine projection vs. actual depletions after the run |
| Lost sales (cases consumers couldn't buy) | Not tracked | Reported per event, trending down | Engine's demand-at-risk figure, checked against depletions |
| Planner overrides of the agent's plan | n/a | Under 10% of lines by the end of approval mode | Override log |
| Share of lines needing human approval | 100% (all manual) | About a third in a typical shortage | Approval queue size per event (demo: 7 to 8 of 21 to 24 lines on tequila and sparkling) |
| Days from decision to customer note | 2 to 3 days | Same day for lines that auto-execute | Note timestamps |
| Rule-book accuracy | n/a | 100% of eval scenarios pass before any config change ships | `npm run evals` scorecard |
| Cost per shortage worked by the agent | Planner time | Under $1 of AI cost per event | Token usage per run (demo: about $0.13) |

## The operating rules we captured

These became `config/customer_acme_beverage.json`. Each was confirmed with the planners against a real past shortage.

| Rule | Acme's answer |
|---|---|
| Forecast | Trust depletions near term (75% in week 1), shipments further out (25% by week 13) |
| In-transit | Counts as on hand only if it arrives within 7 days |
| How to split short supply | Equal days of cover, lowest first, never above the order |
| Hold | Hold orders for markets already covered to the next run plus a 7-day buffer (more for fast or volatile SKUs) |
| Priority accounts | 4 named distributors jump the line, but only if they would stock out before the run |
| Transfers | Move stock between a distributor's own state markets when one is over 90 days and another would run out (1-week lead) |
| Approval | Priority accounts that get less than they ordered, deep cuts to markets that will still run out, lines over 200 cases, every transfer, every data issue |
| Customer email | Direct and practical, signed "Supply Planning Team" |

## Open questions I'd bring to the next session

**Data and systems**
1. Which ERP report is the system of record for open orders, and how often does it refresh? Can we read it directly or only by export?
2. How fresh is the depletion feed by distributor, and which distributors don't report?
3. Who owns the production schedule, and how often does the "next run" date move?
4. When on-hand data looks wrong (negative, or a sudden jump), who fixes it, and how fast?

**Rules**
5. Are there contractual allocation commitments to any distributor that override "equal days of cover"? (A second customer we worked with uses contractual fair share; it changes results a lot.)
6. Should a priority account ever be cut to zero? Is there a minimum ship per account?
7. Are intracompany transfers actually allowed in every state pair? Which require label registration or tax filings first?
8. Do minimum order quantities, pallet or truckload rounding apply to shortage shipments?

**People and process**
9. Who can approve a queued line: any planner, or the planning manager? Does sales get a say before release?
10. What happens to a rejected line today: does the planner set the quantity, or does it go back to sales?
11. Who sends the customer notes, from which mailbox, and does sales want to see them first?
12. How should the agent's decisions be logged for an audit or a distributor dispute?

**Success and risk**
13. Which past shortage should we replay first in shadow mode, and do we have the planner's actual decisions for it?
14. What would make the team stop trusting the agent? That is the failure we design the guardrails around.
