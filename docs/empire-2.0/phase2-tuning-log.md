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

## Step 4b, play rules (2026-11-20)

Under EMPIRE2_PLAY_RULES as first committed (1d7c0f2), the gate fails on real-3p-pure for C2, C4 and C5; this step re-tunes the numbers.

From commit 1d7c0f2 the simulator's default base is the play rules (`--base play`); runs before that used the original default rules, so earlier rows in this log are not directly comparable.

Setup: the tuning runs use seed base 0 and the play base. Sweeps are single-config 1,000-game runs. Gate runs are all three GATE configs at 2,000 games. The final check uses seed base 100000. The one code change is in `scripts/empire2-sim/config.ts`: `underdogGap` range 1 to 3 becomes 1 to 5, and `underdogIncome` range 1 to 3 becomes 0 to 6. No test asserted the old range.

Stage picks: colonizeCost 6 (no value reached 40%; 5 and 6 tie on the worst 3-player rate, 61.7%, so 6 was taken for the lower 4-player rate). winPoints 14 (closest average rounds to 14). underdogIncome 3 and underdogGap 1 (no combination passed C4 or C5; largest C4 margin). Stop condition: the gate still fails after all stages, so tuning stopped. `EMPIRE2_PLAY_RULES` was not changed.

Row numbers in this section restart at 1. Rows 9 to 11 are a diagnosis and an EXPLORATORY probe. The probe changed `regionSetPoints` in a private copy of the repo, which is not committed. They are not tuning steps.

| # | settings | config | games | seedBase | avg rounds | C2 top strategy (rate) | C3 dev pts | C4 % | C5 % | gate result |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | colonizeCost 3 | real-3p-pure | 1000 | 0 | 14.18 | colonizer (63.5%) | 2.6 pts | 12.7% | 83.3% | FAIL (C2,C4,C5) |
| 2 | colonizeCost 3 | real-4p-pure | 1000 | 0 | 13.84 | colonizer (58.3%) | 4.2 pts | 4.3% | 87.5% | FAIL (C2,C4,C5) |
| 3 | colonizeCost 4 | real-3p-pure | 1000 | 0 | 14.08 | colonizer (62.4%) | 2.8 pts | 12.3% | 83.2% | FAIL (C2,C4,C5) |
| 4 | colonizeCost 4 | real-4p-pure | 1000 | 0 | 13.82 | colonizer (57.2%) | 3.3 pts | 4.7% | 88.4% | FAIL (C2,C4,C5) |
| 5 | colonizeCost 5 | real-3p-pure | 1000 | 0 | 14.07 | colonizer (61.7%) | 3.8 pts | 12.6% | 83.5% | FAIL (C2,C4,C5) |
| 6 | colonizeCost 5 | real-4p-pure | 1000 | 0 | 13.87 | colonizer (57.4%) | 2.6 pts | 4.7% | 89.0% | FAIL (C2,C4,C5) |
| 7 | colonizeCost 6 | real-3p-pure | 1000 | 0 | 14.11 | colonizer (61.7%) | 3.1 pts | 13.0% | 83.3% | FAIL (C2,C4,C5) |
| 8 | colonizeCost 6 | real-4p-pure | 1000 | 0 | 13.86 | colonizer (56.3%) | 2.5 pts | 4.4% | 88.8% | FAIL (C2,C4,C5) |
| 9 | colonizeCost 6 (DIAGNOSIS, 2000 games) | real-3p-pure | 2000 | 0 | 14.07 | colonizer (62.8%) | 2.6 pts | 12.9% | 82.0% | FAIL (C2,C4,C5) |
| 10 | colonizeCost 6 + EXPLORATORY region sets 1/2/3 (private probe copy, not committed) | real-3p-pure | 2000 | 0 | 19.31 | colonizer (63.6%) | 1.1 pts | 13.0% | 87.4% | not a gate run (info) |
| 11 | colonizeCost 6 + EXPLORATORY region sets 1/1/2 (private probe copy, not committed) | real-3p-pure | 2000 | 0 | 20.00 | colonizer (60.5%) | 0.5 pts | 8.8% | 80.8% | not a gate run (info) |
| 12 | colonizeCost 6, winPoints 8 | real-3p-pure | 1000 | 0 | 5.49 | annexer (48.2%) | 6.0 pts | 19.9% | 31.9% | FAIL (C1,C2,C3,C5) |
| 13 | colonizeCost 6, winPoints 9 | real-3p-pure | 1000 | 0 | 6.39 | cityBuilder (44.3%) | 2.9 pts | 14.4% | 47.6% | FAIL (C1,C2,C4,C5) |
| 14 | colonizeCost 6, winPoints 10 | real-3p-pure | 1000 | 0 | 8.26 | annexer (46.4%) | 5.2 pts | 13.4% | 64.8% | FAIL (C1,C2,C3,C4,C5) |
| 15 | colonizeCost 6, winPoints 11 | real-3p-pure | 1000 | 0 | 9.37 | colonizer (46.8%) | 6.5 pts | 11.6% | 73.3% | FAIL (C1,C2,C3,C4,C5) |
| 16 | colonizeCost 6, winPoints 12 | real-3p-pure | 1000 | 0 | 10.90 | colonizer (46.2%) | 3.1 pts | 10.7% | 78.3% | FAIL (C1,C2,C4,C5) |
| 17 | colonizeCost 6, winPoints 13 | real-3p-pure | 1000 | 0 | 12.46 | colonizer (45.1%) | 2.4 pts | 12.6% | 81.8% | FAIL (C2,C4,C5) |
| 18 | colonizeCost 6, winPoints 14 | real-3p-pure | 1000 | 0 | 14.11 | colonizer (61.7%) | 3.1 pts | 13.0% | 83.3% | FAIL (C2,C4,C5) |
| 19 | colonizeCost 6, winPoints 15 | real-3p-pure | 1000 | 0 | 15.49 | colonizer (57.7%) | 0.8 pts | 12.7% | 84.8% | FAIL (C2,C4,C5) |
| 20 | colonizeCost 6, winPoints 16 | real-3p-pure | 1000 | 0 | 16.94 | colonizer (62.5%) | 2.8 pts | 14.0% | 87.4% | FAIL (C1,C2,C4,C5) |
| 21 | colonizeCost 6, winPoints 14, underdogIncome 0, underdogGap 1 | real-3p-pure | 1000 | 0 | 14.12 | colonizer (60.9%) | 2.5 pts | 11.3% | 83.8% | FAIL (C2,C4,C5) |
| 22 | colonizeCost 6, winPoints 14, underdogIncome 0, underdogGap 2 | real-3p-pure | 1000 | 0 | 14.12 | colonizer (60.9%) | 2.5 pts | 11.3% | 83.8% | FAIL (C2,C4,C5) |
| 23 | colonizeCost 6, winPoints 14, underdogIncome 0, underdogGap 3 | real-3p-pure | 1000 | 0 | 14.12 | colonizer (60.9%) | 2.5 pts | 11.3% | 83.8% | FAIL (C2,C4,C5) |
| 24 | colonizeCost 6, winPoints 14, underdogIncome 0, underdogGap 4 | real-3p-pure | 1000 | 0 | 14.12 | colonizer (60.9%) | 2.5 pts | 11.3% | 83.8% | FAIL (C2,C4,C5) |
| 25 | colonizeCost 6, winPoints 14, underdogIncome 0, underdogGap 5 | real-3p-pure | 1000 | 0 | 14.12 | colonizer (60.9%) | 2.5 pts | 11.3% | 83.8% | FAIL (C2,C4,C5) |
| 26 | colonizeCost 6, winPoints 14, underdogIncome 1, underdogGap 1 | real-3p-pure | 1000 | 0 | 14.14 | colonizer (62.0%) | 3.7 pts | 12.8% | 83.3% | FAIL (C2,C4,C5) |
| 27 | colonizeCost 6, winPoints 14, underdogIncome 1, underdogGap 2 | real-3p-pure | 1000 | 0 | 14.15 | colonizer (61.3%) | 2.9 pts | 12.2% | 82.9% | FAIL (C2,C4,C5) |
| 28 | colonizeCost 6, winPoints 14, underdogIncome 1, underdogGap 3 | real-3p-pure | 1000 | 0 | 14.09 | colonizer (61.2%) | 2.8 pts | 11.5% | 83.4% | FAIL (C2,C4,C5) |
| 29 | colonizeCost 6, winPoints 14, underdogIncome 1, underdogGap 4 | real-3p-pure | 1000 | 0 | 14.11 | colonizer (61.2%) | 2.7 pts | 11.8% | 83.5% | FAIL (C2,C4,C5) |
| 30 | colonizeCost 6, winPoints 14, underdogIncome 1, underdogGap 5 | real-3p-pure | 1000 | 0 | 14.12 | colonizer (61.2%) | 2.5 pts | 11.3% | 84.3% | FAIL (C2,C4,C5) |
| 31 | colonizeCost 6, winPoints 14, underdogIncome 2, underdogGap 1 | real-3p-pure | 1000 | 0 | 14.11 | colonizer (62.0%) | 2.2 pts | 12.6% | 83.1% | FAIL (C2,C4,C5) |
| 32 | colonizeCost 6, winPoints 14, underdogIncome 2, underdogGap 2 | real-3p-pure | 1000 | 0 | 14.11 | colonizer (61.7%) | 3.1 pts | 13.0% | 83.3% | FAIL (C2,C4,C5) |
| 33 | colonizeCost 6, winPoints 14, underdogIncome 2, underdogGap 3 | real-3p-pure | 1000 | 0 | 14.10 | colonizer (61.2%) | 3.0 pts | 11.6% | 83.7% | FAIL (C2,C4,C5) |
| 34 | colonizeCost 6, winPoints 14, underdogIncome 2, underdogGap 4 | real-3p-pure | 1000 | 0 | 14.10 | colonizer (61.6%) | 2.6 pts | 12.1% | 83.5% | FAIL (C2,C4,C5) |
| 35 | colonizeCost 6, winPoints 14, underdogIncome 2, underdogGap 5 | real-3p-pure | 1000 | 0 | 14.10 | colonizer (61.5%) | 2.7 pts | 11.3% | 83.8% | FAIL (C2,C4,C5) |
| 36 | colonizeCost 6, winPoints 14, underdogIncome 3, underdogGap 1 | real-3p-pure | 1000 | 0 | 14.23 | colonizer (61.5%) | 2.3 pts | 13.6% | 83.7% | FAIL (C2,C4,C5) |
| 37 | colonizeCost 6, winPoints 14, underdogIncome 3, underdogGap 2 | real-3p-pure | 1000 | 0 | 14.18 | colonizer (59.8%) | 3.4 pts | 12.9% | 83.1% | FAIL (C2,C4,C5) |
| 38 | colonizeCost 6, winPoints 14, underdogIncome 3, underdogGap 3 | real-3p-pure | 1000 | 0 | 14.14 | colonizer (59.8%) | 1.8 pts | 11.7% | 83.8% | FAIL (C2,C4,C5) |
| 39 | colonizeCost 6, winPoints 14, underdogIncome 3, underdogGap 4 | real-3p-pure | 1000 | 0 | 14.08 | colonizer (61.1%) | 2.1 pts | 11.9% | 83.5% | FAIL (C2,C4,C5) |
| 40 | colonizeCost 6, winPoints 14, underdogIncome 3, underdogGap 5 | real-3p-pure | 1000 | 0 | 14.10 | colonizer (61.6%) | 2.4 pts | 11.6% | 83.8% | FAIL (C2,C4,C5) |
| 41 | colonizeCost 6, winPoints 14, underdogIncome 4, underdogGap 1 | real-3p-pure | 1000 | 0 | 14.25 | colonizer (62.1%) | 2.2 pts | 12.8% | 85.3% | FAIL (C2,C4,C5) |
| 42 | colonizeCost 6, winPoints 14, underdogIncome 4, underdogGap 2 | real-3p-pure | 1000 | 0 | 14.17 | colonizer (61.1%) | 3.0 pts | 12.1% | 83.0% | FAIL (C2,C4,C5) |
| 43 | colonizeCost 6, winPoints 14, underdogIncome 4, underdogGap 3 | real-3p-pure | 1000 | 0 | 14.13 | colonizer (60.8%) | 2.5 pts | 11.3% | 82.9% | FAIL (C2,C4,C5) |
| 44 | colonizeCost 6, winPoints 14, underdogIncome 4, underdogGap 4 | real-3p-pure | 1000 | 0 | 14.09 | colonizer (60.9%) | 2.6 pts | 11.3% | 83.7% | FAIL (C2,C4,C5) |
| 45 | colonizeCost 6, winPoints 14, underdogIncome 4, underdogGap 5 | real-3p-pure | 1000 | 0 | 14.10 | colonizer (61.3%) | 2.5 pts | 11.6% | 84.0% | FAIL (C2,C4,C5) |
| 46 | colonizeCost 6, winPoints 14, underdogIncome 5, underdogGap 1 | real-3p-pure | 1000 | 0 | 14.24 | colonizer (63.5%) | 3.1 pts | 13.4% | 84.0% | FAIL (C2,C4,C5) |
| 47 | colonizeCost 6, winPoints 14, underdogIncome 5, underdogGap 2 | real-3p-pure | 1000 | 0 | 14.14 | colonizer (62.7%) | 2.9 pts | 12.4% | 83.2% | FAIL (C2,C4,C5) |
| 48 | colonizeCost 6, winPoints 14, underdogIncome 5, underdogGap 3 | real-3p-pure | 1000 | 0 | 14.12 | colonizer (61.7%) | 2.5 pts | 11.0% | 82.4% | FAIL (C2,C4,C5) |
| 49 | colonizeCost 6, winPoints 14, underdogIncome 5, underdogGap 4 | real-3p-pure | 1000 | 0 | 14.10 | colonizer (61.5%) | 2.6 pts | 10.9% | 83.3% | FAIL (C2,C4,C5) |
| 50 | colonizeCost 6, winPoints 14, underdogIncome 5, underdogGap 5 | real-3p-pure | 1000 | 0 | 14.11 | colonizer (61.9%) | 2.6 pts | 11.3% | 83.7% | FAIL (C2,C4,C5) |
| 51 | colonizeCost 6, winPoints 14, underdogIncome 6, underdogGap 1 | real-3p-pure | 1000 | 0 | 14.14 | colonizer (64.4%) | 4.1 pts | 12.5% | 82.5% | FAIL (C2,C4,C5) |
| 52 | colonizeCost 6, winPoints 14, underdogIncome 6, underdogGap 2 | real-3p-pure | 1000 | 0 | 14.18 | colonizer (62.8%) | 3.5 pts | 12.0% | 82.4% | FAIL (C2,C4,C5) |
| 53 | colonizeCost 6, winPoints 14, underdogIncome 6, underdogGap 3 | real-3p-pure | 1000 | 0 | 14.12 | colonizer (62.0%) | 2.2 pts | 10.9% | 82.8% | FAIL (C2,C4,C5) |
| 54 | colonizeCost 6, winPoints 14, underdogIncome 6, underdogGap 4 | real-3p-pure | 1000 | 0 | 14.13 | colonizer (61.5%) | 2.3 pts | 10.9% | 83.7% | FAIL (C2,C4,C5) |
| 55 | colonizeCost 6, winPoints 14, underdogIncome 6, underdogGap 5 | real-3p-pure | 1000 | 0 | 14.13 | colonizer (61.9%) | 2.6 pts | 11.5% | 84.0% | FAIL (C2,C4,C5) |
| 56 | colonizeCost 6, winPoints 14, underdogIncome 3, underdogGap 1 (GATE RUN) | real-3p-mixed | 2000 | 0 | 14.22 | mixed (33.3%) | 3.8 pts | 27.6% | 95.2% | PASS |
| 57 | colonizeCost 6, winPoints 14, underdogIncome 3, underdogGap 1 (GATE RUN) | real-3p-pure | 2000 | 0 | 14.15 | colonizer (61.9%) | 1.6 pts | 13.1% | 81.8% | FAIL (C2,C4,C5) |
| 58 | colonizeCost 6, winPoints 14, underdogIncome 3, underdogGap 1 (GATE RUN) | real-4p-pure | 2000 | 0 | 13.88 | colonizer (57.9%) | 2.0 pts | 4.1% | 88.8% | FAIL (C2,C4,C5) |
| 59 | colonizeCost 6, winPoints 14, underdogIncome 3, underdogGap 1 (FINAL CHECK) | real-3p-mixed | 2000 | 100000 | 14.29 | mixed (33.3%) | 3.7 pts | 27.8% | 95.8% | PASS |
| 60 | colonizeCost 6, winPoints 14, underdogIncome 3, underdogGap 1 (FINAL CHECK) | real-3p-pure | 2000 | 100000 | 13.94 | colonizer (60.5%) | 2.3 pts | 10.9% | 79.8% | FAIL (C2,C4,C5) |
| 61 | colonizeCost 6, winPoints 14, underdogIncome 3, underdogGap 1 (FINAL CHECK) | real-4p-pure | 2000 | 100000 | 13.92 | colonizer (59.3%) | 1.0 pts | 4.6% | 88.0% | FAIL (C2,C4,C5) |

Notes on this step:

- Before the sweeps, one 1,000-game check with no overrides confirmed the start state: average 14.08 rounds, colonizer 62.4%, gate FAIL (C2, C4, C5). Its folder was removed and it is not in the table.
- A first batch of nine winPoints runs was built with bad quoting. The rules files were not valid JSON, so the simulator exited 2 and ran no games. The batch was re-run with the same settings; the failed folders were kept aside and are not in the table.
- The sweep count (1,000-game single-config runs) is 53 of the 60 cap, including the start-state check. Gate runs used: 2 of 25.
