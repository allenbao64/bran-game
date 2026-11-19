# Empire 2.0 phase 2: tuning log

Every logged run of the bot simulation (`scripts/empire2-sim/run.ts --tuning-log "change | decision"`). Gate configs use seed base 0 for tuning. Validation runs use fresh seed bases (100000, then 200000, then 300000) and are recorded in the gate report, not here.

## Design values

These are the values in `lib/empire2/rules.ts` at phase 1 (section 1 of the phase 2 spec). A tuned constant differs from its design value only after a logged change.

| Field | Design | Allowed range while tuning |
|---|---|---|
| `winPoints` | 10 | 8 to 16 |
| `baseIncome` | 2 | 1 to 3 |
| `startInfluence` | 3 | 2 to 5 |
| `countriesPerTerritory` | 4 | 3 to 5 |
| `cityIncome` | 1 | 1 to 2 |
| `boomIncome` | 1 | 1 to 2 |
| `boomCityIncome` | 2 | `boomIncome` to 3 |
| `underdogGap` | 2 | 1 to 3 |
| `underdogIncome` | 2 | 1 to 3 |
| `bountyPay` | 2 | 1 to 3 |
| `expandCost` | 1 | 1 to 2 |
| `cityCost` | 3 | 2 to 5 |
| `colonizeCost` | 4 | 3 to 6 |
| `annexCost` | 5 | 4 to 8 |
| `maxCities` | 4 | 3 to 5 |
| `largestEmpireMin` | 6 | 5 to 8 |
| `explorerMinContinents` | 4 | 3 to 5 |

Pinned (a change is a rule change and stops the work): `freeExpandsPerTurn, colonizeReliefCost, minColonizeCost, tradeWindsColonizeCost, goldenAgeCityIncome, goldRushBountyPay, closedBordersExtra, boomRegionCount, bountyCount, bountyMinFits, eventEvery, roundCap, capitalOffers, capitalMinNeighbours, minPlayers, maxPlayers, defaultTurnMs, allowedTurnMs, cityPoints, largestEmpirePoints, explorerPoints`, and the region-set point function.

## Spec gaps

Decisions taken where the spec did not say. Each is the smallest choice that matches the text.

1. **Timeouts on a second-of-two turn.** The spec opens a waiting event only after `endTurn`. A skipped turn that the engine ends by timeout uses the same engine rule, so the runner opens a waiting event for it too. It is rare (only with `--slow`).
2. **"Free countries in region(c)"** (colonize stuck and explore scores) counts `c` itself, because `c` is free. The text says "free countries in region(c)", read literally.
3. **`turns`** in the seat statistics counts played turns only. Skipped turns go to `skippedTurns`. Idle share is idle played turns over played turns.
4. **Waiting event outcome on a finished game.** An event closed by the seat's own turn that ends the game without that seat winning (round cap) stays open and is recorded as `preempted`.
5. **Run ids for sensitivity runs.** `+` is replaced by `_` in file names: `real-3p-pure_know30_seed0_1000g`.
6. **Tuning log note.** `--tuning-log "change | decision"`. The text after the last ` | ` is the decision. A logged run needs the full game count (no `--games`).
7. **C1 in `real-4p-pure`** is shown with result `info` (reported only, as the spec says). The gate counts C2 to C5 for that config.
8. **Failing C5 seeds** are printed under ANNEXES AND COMEBACKS (up to 20), not in the CHECKS table, so the table keeps the exact layout of section 5.
9. **Pure-field lineups** depend on the game index block only (`streamSeed(b, 2)`), not on the seed base, as the spec writes it. The same lineups are used on every seed base.
10. **Rules file bounds.** `boomCityIncome` is checked against the effective `boomIncome` (rules file or default). `bountyPay` is checked against `goldRushBountyPay`.
11. **Invariant checks (`--check`)** run on the first 200 games of each config, with a fresh tracker per game.
12. **Action guard.** The 40-action guard counts successful non-`endTurn` actions in one turn.

## Runs

| # | change | config | games | seedBase | C1 rounds | C2 top strat (rate) | C3 dev pts | C4 % | C5 % | cap% | annexes/game | decision |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | baseline: design values | real-3p-pure | 2000 | 0 | 4.22 | colonizer (44.8%) | 27.9 | 38.2 | 2.0 | 0.0 | 0.60 | keep (baseline) |
| 2 | baseline: design values | real-4p-pure | 2000 | 0 | 4.15 | cityBuilder (41.4%) | 19.9 | 11.3 | 0.5 | 0.0 | 1.07 | keep (baseline) |
| 3 | baseline: design values | real-3p-mixed | 2000 | 0 | 4.92 | mixed (33.3%) | 62.1 | 50.0 | 0.1 | 0.0 | 0.16 | keep (baseline) |
| 4 | winPoints 10 -> 11 | real-3p-pure | 2000 | 0 | 4.58 | colonizer (50.8%) | 27.1 | 31.2 | 5.9 | 0.0 | 0.66 | keep |
| 5 | winPoints 10 -> 11 | real-4p-pure | 2000 | 0 | 4.49 | colonizer (39.5%) | 16.1 | 12.2 | 3.9 | 0.0 | 1.19 | keep |
| 6 | winPoints 11 -> 12 | real-3p-pure | 2000 | 0 | 4.97 | colonizer (54.4%) | 27.4 | 22.4 | 12.6 | 0.0 | 0.72 | keep |
| 7 | winPoints 11 -> 12 | real-4p-pure | 2000 | 0 | 4.84 | colonizer (44.4%) | 14.8 | 14.0 | 9.4 | 0.0 | 1.31 | keep |
| 8 | winPoints 12 -> 13 | real-3p-pure | 2000 | 0 | 5.38 | colonizer (57.1%) | 26.2 | 19.8 | 24.0 | 0.0 | 0.80 | keep |
| 9 | winPoints 12 -> 13 | real-4p-pure | 2000 | 0 | 5.25 | colonizer (47.8%) | 15.6 | 11.4 | 23.0 | 0.0 | 1.47 | keep |
| 10 | winPoints 13 -> 14 | real-3p-pure | 2000 | 0 | 5.80 | colonizer (58.4%) | 22.7 | 15.4 | 34.8 | 0.0 | 0.90 | keep |
| 11 | winPoints 13 -> 14 | real-4p-pure | 2000 | 0 | 5.73 | colonizer (47.4%) | 13.7 | 9.3 | 41.0 | 0.0 | 1.71 | keep |
| 12 | winPoints 14 -> 15 | real-3p-pure | 2000 | 0 | 6.22 | colonizer (60.6%) | 20.1 | 12.8 | 43.1 | 0.0 | 1.00 | keep |
| 13 | winPoints 14 -> 15 | real-4p-pure | 2000 | 0 | 6.14 | colonizer (49.0%) | 12.7 | 6.4 | 53.0 | 0.0 | 1.92 | keep |
| 14 | winPoints 15 -> 16 | real-3p-pure | 2000 | 0 | 6.76 | colonizer (60.2%) | 20.7 | 10.7 | 53.8 | 0.0 | 1.14 | keep |
| 15 | winPoints 15 -> 16 | real-4p-pure | 2000 | 0 | 6.61 | colonizer (47.0%) | 13.6 | 5.1 | 66.0 | 0.0 | 2.13 | keep |
| 16 | countriesPerTerritory 4 -> 5 (LAST RESORT, also changes points and income) | real-3p-pure | 2000 | 0 | 7.57 | colonizer (55.0%) | 20.5 | 12.4 | 62.8 | 0.0 | 1.32 | keep |
| 17 | countriesPerTerritory 4 -> 5 (LAST RESORT, also changes points and income) | real-4p-pure | 2000 | 0 | 7.39 | colonizer (47.1%) | 12.9 | 5.8 | 75.1 | 0.0 | 2.55 | keep |
