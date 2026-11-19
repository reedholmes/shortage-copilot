# Eval scorecard

Ran 15 scenarios on 2026-11-19.

- **Scenarios passed:** 15 / 15
- **Accuracy (expected outcomes matched):** 83 / 83 = 100.0%

| ID | Scenario | Type | Customer | Checks | Result |
|---|---|---|---|---|---|
| S01 | No shortage: everyone ships in full | Core rule | acme_beverage | 6/6 | PASS |
| S02 | Spread toward equal days of cover | Core rule | acme_beverage | 8/8 | PASS |
| S03 | Hold a market already covered past the run | Core rule | acme_beverage | 5/5 | PASS |
| S04 | Priority account at stockout risk jumps the line | Core rule | acme_beverage | 5/5 | PASS |
| S05 | Healthy priority account waits its turn | Core rule | acme_beverage | 5/5 | PASS |
| S06 | Two priority accounts at risk, not enough for both | Edge case | acme_beverage | 6/6 | PASS |
| S07 | Intracompany transfer before shipping from on hand | Core rule | acme_beverage | 6/6 | PASS |
| S08 | Zero supply | Edge case | acme_beverage | 7/7 | PASS |
| S09 | Late production run | Edge case | acme_beverage | 6/6 | PASS |
| S10 | Bad data: negative on hand | Edge case | acme_beverage | 7/7 | PASS |
| S11 | Fair share contract | Customer rules | bluestone_spirits | 5/5 | PASS |
| S12 | Same event as S11 under Acme's rules | Customer rules | acme_beverage | 5/5 | PASS |
| S13 | Priority account always served first | Customer rules | bluestone_spirits | 5/5 | PASS |
| S14 | Customer with transfers switched off | Customer rules | bluestone_spirits | 3/3 | PASS |
| S15 | Single line over the approval case limit | Edge case | acme_beverage | 4/4 | PASS |
