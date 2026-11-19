# Status update: shortage allocation agent

**To:** VP Supply Chain, Acme Beverage Co.
**From:** Deployment lead
**Week 6 of 12 · Phase 1, shadow mode · Overall: on track**

*Mock update for a fictional customer. Results below come from the demo's synthetic shortage events.*

## Where we are

| Workstream | Status | Note |
|---|---|---|
| Rules configured and signed off | Done | Your planners signed off all 15 test scenarios; scorecard 15 of 15 |
| Shadow mode | On track | Agent running on every shortage; nothing executes |
| Planner comparison | In progress | Line-by-line review with the planners; results at the week 7 review |
| Data feeds | Watch | Two distributors report depletions late; the agent leans on their orders until the data arrives |
| Approval mode (Phase 2) | Planned for week 8 | Pending your go-ahead at the week 7 review |

## What the agent found on three shortages

| Shortage | On hand vs orders | Markets out before the run if nothing ships | With the agent's plan | Sales at risk with the plan (cs) | Needs a person |
|---|---|---|---|---|---|
| Agave Sol tequila | 62% | 13 | **2** | 50 cases | 8 of 24 lines, plus 2 transfers |
| North Shore sparkling | 55% | 12 | **2** | 126 cases | 7 of 21 lines |
| Harbor Ridge bourbon | 58% | 20 | **14** | 819 cases | 15 of 22 lines |

**What this means:** on tequila and sparkling, the plan protects almost every market, and two thirds of lines would not need a person once we reach Phase 3. Bourbon is different. With the next run 6 weeks out, no allocation can keep most markets in stock. That is a production timing question, not an allocation one, and it is worth raising with operations now.

## Decisions I need from you

1. **Contract commitments.** Do any distributor contracts promise a fixed share during a shortage? If yes, those accounts need a fair-share rule, which changes results significantly (in testing, fair share on the tequila shortage left 9 markets short instead of 2).
2. **Transfers between states.** Which state pairs can legally receive intracompany transfers today? Until we have the list, every transfer stays in the approval queue.
3. **Phase 2 start.** Approve moving to approval mode in week 8, subject to the week 7 comparison meeting the exit criteria (90% of lines within 10% of the planner, every difference explained).

## Risks

| Risk | Status | Action |
|---|---|---|
| Late depletion data from two distributors | Open | Asked both for a weekly feed; agent flags their markets meanwhile |
| Approval queue too long for the planners | Resolved | Thresholds tuned: about a third of lines in a typical shortage, down from 60% to 100% in the first draft |
| Planner trust | On track | Every line shows its reasons; planners have asked good questions, not raised objections |

**Next update:** after the week 7 review.
