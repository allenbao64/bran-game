# Empire 2.0 phase 2: rule comparison

Date: 2026-11-19
Commit: afe7ce3 (branch feat/empire2-engine, HEAD when the runs were made)
Plan step: Step 2 of `docs/empire-2.0/plan.md`

This doc reports simulator runs only. No engine, bot, simulator or test code was changed. The owner decides the final rules.

## Method

- Simulator: `scripts/empire2-sim/run.ts`, unchanged. Each setting ran with `--rules` pointing at its own rules file under `/home/user/e2e-reports/empire2-compare/`. `scripts/empire2-sim/rules.json` stayed `{}`.
- Seeds: seed base 0 with 2,000 games per gate run. The winPoints sweep used 1,000 games on real-3p-pure. The final check uses seed base 100000 with 2,000 games.
- Gates C1 to C5 are read from each run's report output. Gate FAIL count is the number of failed gated checks, summed over real-3p-pure, real-4p-pure and real-3p-mixed.
- Exit codes: 1 means a gate failed, which is a normal result. 2 means the simulator rejected a rule value. No run failed with any other code.
- Winner turn position: the share of final-round winners by their seat in the final round's turn order. Position 1 acts first.
- Worst seat deviation is the C3 value: the largest gap between a seat's win rate and an even split, in points.
- Runs: 103 runs with output (32 in stage A, 36 in the stage B sweep, 16 in stage B, 16 in stage C, 3 in the final check), plus 24 sweep runs the simulator rejected. About 28 minutes of wall time, with up to 3 jobs at once.

Raw outputs (text report, JSON, and per-game records) are in `/home/user/e2e-reports/empire2-compare/`, one folder per setting.

## Stage A: turn order and win check

All other rules at their defaults (winPoints 10, territoryPoints true, maxExpandsPerTurn 3, explorerMinContinents 4, cheapColonize everyStuckTurn).

| Setting | Config | Avg rounds | C1 length | C2 top strategy | C3 worst seat dev | C4 last place r6 | C5 leader change | Gate | Seat win % (1 / 2 / 3) | Winner turn position % (1 / 2 / 3) | Annexes per game | Top strategy and rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| turnOrder=snake, winCheck=endOfTurn | real-3p-pure | 4.22 | 4.22 FAIL | 44.8% FAIL | 27.9 pts FAIL (seat 2) | 38.2% PASS | 2.0% FAIL | FAIL (C1 C2 C3 C5) | 27.1 / 61.2 / 11.7 | 0.0 / 61.2 / 38.8 | 0.60 | colonizer 44.8% |
| turnOrder=snake, winCheck=endOfTurn | real-4p-pure | 4.15 | 4.15 info | 41.4% FAIL | 19.9 pts FAIL (seat 4) | 11.3% FAIL | 0.5% FAIL | FAIL (C2 C3 C4 C5) | 17.4 / 37.6 / 39.9 / 5.1 | 0.0 / 51.8 / 25.7 / 22.5 | 1.07 | cityBuilder 41.4% |
| turnOrder=snake, winCheck=endOfTurn | real-3p-mixed | 4.92 | 4.92 FAIL | n/a | 62.1 pts FAIL (seat 2) | 50.0% PASS | 0.1% FAIL | FAIL (C1 C3 C5) | 1.6 / 95.5 / 2.9 | 0.0 / 95.5 / 4.5 | 0.16 | n/a (mixed) |
| turnOrder=snake, winCheck=endOfTurn | real-2p-pure | 4.37 | 4.37 info | 67.4% info | 8.5 pts info (seat 2) | 5.3% info | 2.4% info | n/a | 58.5 / 41.5 | 0.0 / 100.0 | 0.18 | annexer 67.4% |
| turnOrder=snake, winCheck=endOfRound | real-3p-pure | 4.01 | 4.01 FAIL | 43.1% FAIL | 4.8 pts PASS (seat 2) | 31.8% PASS | 0.8% FAIL | FAIL (C1 C2 C5) | 37.5 / 28.5 / 33.9 | 42.5 / 28.5 / 28.9 | 0.62 | annexer 43.1% |
| turnOrder=snake, winCheck=endOfRound | real-4p-pure | 4.00 | 4.00 info | 38.1% PASS | 6.6 pts FAIL (seat 1) | 6.4% FAIL | 0.4% FAIL | FAIL (C3 C4 C5) | 31.6 / 18.9 / 20.1 / 29.5 | 36.8 / 21.3 / 17.7 / 24.2 | 1.16 | cityBuilder 38.1% |
| turnOrder=snake, winCheck=endOfRound | real-3p-mixed | 4.83 | 4.83 FAIL | n/a | 18.2 pts FAIL (seat 1) | 0.0% FAIL | 0.0% FAIL | FAIL (C1 C3 C4 C5) | 51.5 / 26.6 / 21.9 | 59.4 / 26.6 / 14.1 | 0.24 | n/a (mixed) |
| turnOrder=snake, winCheck=endOfRound | real-2p-pure | 3.92 | 3.92 info | 71.9% info | 3.1 pts info (seat 2) | 47.4% info | 0.5% info | n/a | 53.0 / 46.9 | 57.1 / 42.9 | 0.18 | annexer 71.9% |
| turnOrder=clockwise, winCheck=endOfTurn | real-3p-pure | 3.86 | 3.86 FAIL | 43.1% FAIL | 33.7 pts FAIL (seat 1) | 11.4% FAIL | 0.9% FAIL | FAIL (C1 C2 C3 C4 C5) | 67.0 / 22.4 / 10.6 | 67.0 / 22.4 / 10.6 | 0.64 | cityBuilder 43.1% |
| turnOrder=clockwise, winCheck=endOfTurn | real-4p-pure | 3.85 | 3.85 info | 40.3% FAIL | 34.5 pts FAIL (seat 1) | 3.3% FAIL | 0.4% FAIL | FAIL (C2 C3 C4 C5) | 59.5 / 22.2 / 11.0 / 7.2 | 59.5 / 22.2 / 11.0 / 7.2 | 1.07 | cityBuilder 40.3% |
| turnOrder=clockwise, winCheck=endOfTurn | real-3p-mixed | 4.81 | 4.81 FAIL | n/a | 59.4 pts FAIL (seat 1) | 0.0% FAIL | 0.0% FAIL | FAIL (C1 C3 C4 C5) | 92.7 / 5.3 / 1.9 | 92.7 / 5.3 / 1.9 | 0.08 | n/a (mixed) |
| turnOrder=clockwise, winCheck=endOfTurn | real-2p-pure | 3.84 | 3.84 info | 61.7% info | 25.0 pts info (seat 1) | 25.0% info | 1.1% info | n/a | 75.0 / 25.1 | 75.0 / 25.1 | 0.22 | cityBuilder 61.7% |
| turnOrder=clockwise, winCheck=endOfRound | real-3p-pure | 3.99 | 3.99 FAIL | 44.9% FAIL | 19.0 pts FAIL (seat 1) | 16.7% PASS | 1.2% FAIL | FAIL (C1 C2 C3 C5) | 52.3 / 26.2 / 21.4 | 52.3 / 26.2 / 21.4 | 0.82 | colonizer 44.9% |
| turnOrder=clockwise, winCheck=endOfRound | real-4p-pure | 3.97 | 3.97 info | 37.9% PASS | 18.7 pts FAIL (seat 1) | 0.0% FAIL | 0.3% FAIL | FAIL (C3 C4 C5) | 43.7 / 22.3 / 18.4 / 15.6 | 43.7 / 22.3 / 18.4 / 15.6 | 1.43 | cityBuilder 37.9% |
| turnOrder=clockwise, winCheck=endOfRound | real-3p-mixed | 4.83 | 4.83 FAIL | n/a | 23.6 pts FAIL (seat 1) | 0.0% FAIL | 0.0% FAIL | FAIL (C1 C3 C4 C5) | 57.0 / 24.7 / 18.3 | 57.0 / 24.7 / 18.3 | 0.34 | n/a (mixed) |
| turnOrder=clockwise, winCheck=endOfRound | real-2p-pure | 3.95 | 3.95 info | 66.5% info | 12.3 pts info (seat 1) | 30.6% info | 1.3% info | n/a | 62.3 / 37.8 | 62.3 / 37.8 | 0.28 | annexer 66.5% |
| turnOrder=rotate, winCheck=endOfTurn | real-3p-pure | 3.95 | 3.95 FAIL | 51.0% FAIL | 14.4 pts FAIL (seat 1) | 16.7% PASS | 0.9% FAIL | FAIL (C1 C2 C3 C5) | 47.8 / 30.1 / 22.1 | 63.0 / 26.2 / 10.8 | 0.71 | cityBuilder 51.0% |
| turnOrder=rotate, winCheck=endOfTurn | real-4p-pure | 3.90 | 3.90 info | 45.2% FAIL | 10.5 pts FAIL (seat 4) | 23.1% PASS | 0.5% FAIL | FAIL (C2 C3 C5) | 30.0 / 15.8 / 18.6 / 35.5 | 51.9 / 23.7 / 15.7 / 8.8 | 1.20 | cityBuilder 45.2% |
| turnOrder=rotate, winCheck=endOfTurn | real-3p-mixed | 4.78 | 4.78 FAIL | n/a | 47.9 pts FAIL (seat 2) | 0.0% FAIL | 0.0% FAIL | FAIL (C1 C3 C4 C5) | 15.1 / 81.2 / 3.7 | 92.8 / 5.3 / 1.8 | 0.15 | n/a (mixed) |
| turnOrder=rotate, winCheck=endOfTurn | real-2p-pure | 4.37 | 4.37 info | 67.4% info | 8.5 pts info (seat 2) | 5.3% info | 2.4% info | n/a | 58.5 / 41.5 | 0.0 / 100.0 | 0.18 | annexer 67.4% |
| turnOrder=rotate, winCheck=endOfRound | real-3p-pure | 4.07 | 4.07 FAIL | 43.2% FAIL | 5.6 pts FAIL (seat 1) | 12.1% FAIL | 0.9% FAIL | FAIL (C1 C2 C3 C4 C5) | 38.9 / 33.0 / 28.1 | 39.8 / 32.9 / 27.3 | 0.88 | cityBuilder 43.2% |
| turnOrder=rotate, winCheck=endOfRound | real-4p-pure | 4.04 | 4.04 info | 40.1% FAIL | 0.8 pts PASS (seat 1) | 11.1% FAIL | 0.4% FAIL | FAIL (C2 C4 C5) | 25.8 / 24.5 / 25.0 / 24.7 | 28.5 / 22.9 / 25.7 / 22.8 | 1.51 | cityBuilder 40.1% |
| turnOrder=rotate, winCheck=endOfRound | real-3p-mixed | 4.80 | 4.80 FAIL | n/a | 15.1 pts FAIL (seat 2) | 0.0% FAIL | 0.0% FAIL | FAIL (C1 C3 C4 C5) | 27.0 / 48.4 / 24.6 | 58.9 / 25.9 / 15.2 | 0.40 | n/a (mixed) |
| turnOrder=rotate, winCheck=endOfRound | real-2p-pure | 3.92 | 3.92 info | 71.9% info | 3.1 pts info (seat 2) | 47.4% info | 0.5% info | n/a | 53.0 / 46.9 | 57.1 / 42.9 | 0.18 | annexer 71.9% |
| turnOrder=leaderLast, winCheck=endOfTurn | real-3p-pure | 4.07 | 4.07 FAIL | 44.2% FAIL | 6.6 pts FAIL (seat 1) | 28.2% PASS | 1.6% FAIL | FAIL (C1 C2 C3 C5) | 39.9 / 30.9 / 29.2 | 31.9 / 40.5 / 27.7 | 0.72 | cityBuilder 44.2% |
| turnOrder=leaderLast, winCheck=endOfTurn | real-4p-pure | 4.03 | 4.03 info | 40.0% PASS | 5.3 pts FAIL (seat 1) | 28.1% PASS | 0.7% FAIL | FAIL (C3 C5) | 30.3 / 25.3 / 23.6 / 20.8 | 20.5 / 31.4 / 25.6 / 22.5 | 1.27 | cityBuilder 40.0% |
| turnOrder=leaderLast, winCheck=endOfTurn | real-3p-mixed | 4.89 | 4.89 FAIL | n/a | 3.4 pts PASS (seat 1) | 0.0% FAIL | 0.0% FAIL | FAIL (C1 C4 C5) | 36.8 / 31.5 / 31.8 | 63.2 / 32.6 / 4.2 | 0.25 | n/a (mixed) |
| turnOrder=leaderLast, winCheck=endOfTurn | real-2p-pure | 4.10 | 4.10 info | 62.8% info | 5.9 pts info (seat 1) | 11.1% info | 2.1% info | n/a | 56.0 / 44.0 | 27.6 / 72.4 | 0.20 | annexer 62.8% |
| turnOrder=leaderLast, winCheck=endOfRound | real-3p-pure | 4.10 | 4.10 FAIL | 44.5% FAIL | 7.2 pts FAIL (seat 1) | 11.0% FAIL | 1.2% FAIL | FAIL (C1 C2 C3 C4 C5) | 40.5 / 31.4 / 28.1 | 23.7 / 30.3 / 46.1 | 0.78 | annexer 44.5% |
| turnOrder=leaderLast, winCheck=endOfRound | real-4p-pure | 4.08 | 4.08 info | 38.2% PASS | 5.9 pts FAIL (seat 1) | 6.2% FAIL | 0.4% FAIL | FAIL (C3 C4 C5) | 30.9 / 24.6 / 22.2 / 22.2 | 12.1 / 19.7 / 26.6 / 41.6 | 1.39 | cityBuilder 38.2% |
| turnOrder=leaderLast, winCheck=endOfRound | real-3p-mixed | 4.86 | 4.86 FAIL | n/a | 3.0 pts PASS (seat 1) | 0.0% FAIL | 0.0% FAIL | FAIL (C1 C4 C5) | 36.3 / 32.3 / 31.4 | 44.0 / 33.0 / 23.0 | 0.34 | n/a (mixed) |
| turnOrder=leaderLast, winCheck=endOfRound | real-2p-pure | 4.00 | 4.00 info | 71.6% info | 5.6 pts info (seat 2) | 8.7% info | 0.6% info | n/a | 55.6 / 44.4 | 34.6 / 65.4 | 0.21 | annexer 71.6% |

Worst seat deviation (C3, points) by setting. The last column is the largest of the three gate configs.

| Setting | real-3p-pure | real-4p-pure | real-3p-mixed | Worst of the three |
|---|---|---|---|---|
| turnOrder=leaderLast, winCheck=endOfTurn | 6.6 | 5.3 | 3.4 | 6.6 |
| turnOrder=leaderLast, winCheck=endOfRound | 7.2 | 5.9 | 3.0 | 7.2 |
| turnOrder=rotate, winCheck=endOfRound | 5.6 | 0.8 | 15.1 | 15.1 |
| turnOrder=snake, winCheck=endOfRound | 4.8 | 6.6 | 18.2 | 18.2 |
| turnOrder=clockwise, winCheck=endOfRound | 19.0 | 18.7 | 23.6 | 23.6 |
| turnOrder=rotate, winCheck=endOfTurn | 14.4 | 10.5 | 47.9 | 47.9 |
| turnOrder=clockwise, winCheck=endOfTurn | 33.7 | 34.5 | 59.4 | 59.4 |
| turnOrder=snake, winCheck=endOfTurn | 27.9 | 19.9 | 62.1 | 62.1 |

**Provisional pick for stage B: turnOrder `leaderLast`, winCheck `endOfTurn`.** Its worst seat deviation is 6.6 points, the smallest of the eight settings. The next smallest is `leaderLast` with `endOfRound` at 7.2 points. That is within 3 points, so the stated tie rule applies: `endOfTurn` over `endOfRound`. The pick still fails C3 on real-3p-pure (6.6 points) and real-4p-pure (5.3 points), and passes on real-3p-mixed (3.4 points).

## Stage B: game length

Stage A pick fixed: turnOrder `leaderLast`, winCheck `endOfTurn`. winPoints is limited to 8 to 16 by the simulator. Values 6, 7 and 17 to 20 were rejected with exit code 2 (`"winPoints" = 6 is outside the allowed range 8 to 16`). They are shown as rejected below.

Sweep: average rounds on real-3p-pure, 1,000 games, seed base 0.

| winPoints | territoryPoints true, cap 3 | territoryPoints true, cap 2 | territoryPoints false, cap 3 | territoryPoints false, cap 2 |
|---|---|---|---|---|
| 6 | rejected (outside 8 to 16) | rejected (outside 8 to 16) | rejected (outside 8 to 16) | rejected (outside 8 to 16) |
| 7 | rejected (outside 8 to 16) | rejected (outside 8 to 16) | rejected (outside 8 to 16) | rejected (outside 8 to 16) |
| 8 | 3.35 | 3.75 | 4.41 | 4.98 |
| 9 | 3.75 | 4.32 | 4.88 | 6.12 |
| 10 | 4.08 | 4.78 | 5.71 | 7.52 |
| 11 | 4.40 | 5.24 | 6.35 | 8.58 |
| 12 | 4.75 | 6.05 | 7.56 | 10.64 |
| 13 | 5.19 | 6.76 | 8.36 | 11.92 |
| 14 | 5.67 | 7.64 | 9.64 | 13.76 |
| 15 | 6.07 | 8.40 | 10.78 | 15.49 |
| 16 | 6.56 | 9.28 | 11.85 | 16.80 |
| 17 | rejected (outside 8 to 16) | rejected (outside 8 to 16) | rejected (outside 8 to 16) | rejected (outside 8 to 16) |
| 18 | rejected (outside 8 to 16) | rejected (outside 8 to 16) | rejected (outside 8 to 16) | rejected (outside 8 to 16) |
| 19 | rejected (outside 8 to 16) | rejected (outside 8 to 16) | rejected (outside 8 to 16) | rejected (outside 8 to 16) |
| 20 | rejected (outside 8 to 16) | rejected (outside 8 to 16) | rejected (outside 8 to 16) | rejected (outside 8 to 16) |

winPoints chosen for each combination (closest average to 14 rounds; ties go to the smaller value):

| territoryPoints | maxExpandsPerTurn | winPoints chosen | Sweep avg rounds (1,000 g) | Full avg rounds, real-3p-pure (2,000 g) | Gate FAILs (3 gate configs) |
|---|---|---|---|---|---|
| true | 3 | 16 | 6.56 | 6.56 | 9 |
| true | 2 | 16 | 9.28 | 9.27 | 9 |
| false | 3 | 16 | 11.85 | 11.77 | 9 |
| false | 2 | 14 | 13.76 | 13.81 | 7 |

Full runs for the four chosen settings, 2,000 games, seed base 0:

| Setting | Config | Avg rounds | C1 length | C2 top strategy | C3 worst seat dev | C4 last place r6 | C5 leader change | Gate | Seat win % (1 / 2 / 3) | Winner turn position % (1 / 2 / 3) | Annexes per game | Top strategy and rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| territoryPoints=true, maxExpandsPerTurn=3, winPoints=16 | real-3p-pure | 6.56 | 6.56 FAIL | 55.4% FAIL | 4.6 pts PASS (seat 1) | 12.6% FAIL | 61.5% FAIL | FAIL (C1 C2 C4 C5) | 37.9 / 31.9 / 30.2 | 13.8 / 38.6 / 47.6 | 1.48 | colonizer 55.4% |
| territoryPoints=true, maxExpandsPerTurn=3, winPoints=16 | real-4p-pure | 6.56 | 6.56 info | 43.9% FAIL | 4.9 pts PASS (seat 1) | 7.0% FAIL | 72.5% FAIL | FAIL (C2 C4 C5) | 29.9 / 25.2 / 23.9 / 21.0 | 7.5 / 23.8 / 30.9 / 37.7 | 2.73 | colonizer 43.9% |
| territoryPoints=true, maxExpandsPerTurn=3, winPoints=16 | real-3p-mixed | 6.30 | 6.30 FAIL | n/a | 4.4 pts PASS (seat 3) | 28.1% PASS | 71.7% FAIL | FAIL (C1 C5) | 37.7 / 33.4 / 28.9 | 29.3 / 46.3 / 24.3 | 1.07 | n/a (mixed) |
| territoryPoints=true, maxExpandsPerTurn=3, winPoints=16 | real-2p-pure | 6.65 | 6.65 info | 66.8% info | 3.3 pts info (seat 1) | 29.5% info | 42.6% info | n/a | 53.3 / 46.7 | 22.9 / 77.1 | 0.38 | colonizer 66.8% |
| territoryPoints=true, maxExpandsPerTurn=2, winPoints=16 | real-3p-pure | 9.27 | 9.27 FAIL | 48.9% FAIL | 3.9 pts PASS (seat 1) | 10.7% FAIL | 71.5% FAIL | FAIL (C1 C2 C4 C5) | 37.2 / 31.1 / 31.6 | 10.3 / 37.0 / 52.6 | 1.73 | colonizer 48.9% |
| territoryPoints=true, maxExpandsPerTurn=2, winPoints=16 | real-4p-pure | 9.13 | 9.13 info | 40.1% FAIL | 2.1 pts PASS (seat 4) | 3.6% FAIL | 80.9% FAIL | FAIL (C2 C4 C5) | 25.7 / 26.0 / 25.4 / 22.9 | 3.1 / 21.2 / 30.2 / 45.5 | 3.17 | colonizer 40.1% |
| territoryPoints=true, maxExpandsPerTurn=2, winPoints=16 | real-3p-mixed | 9.27 | 9.27 FAIL | n/a | 3.7 pts PASS (seat 3) | 20.4% PASS | 92.1% FAIL | FAIL (C1 C5) | 36.5 / 33.8 / 29.6 | 26.4 / 41.6 / 32.0 | 2.48 | n/a (mixed) |
| territoryPoints=true, maxExpandsPerTurn=2, winPoints=16 | real-2p-pure | 9.63 | 9.63 info | 63.2% info | 2.4 pts info (seat 2) | 27.8% info | 49.5% info | n/a | 52.3 / 47.6 | 20.9 / 79.0 | 0.45 | cityBuilder 63.2% |
| territoryPoints=false, maxExpandsPerTurn=3, winPoints=16 | real-3p-pure | 11.77 | 11.77 FAIL | 67.5% FAIL | 1.3 pts PASS (seat 3) | 13.1% FAIL | 80.2% FAIL | FAIL (C1 C2 C4 C5) | 33.8 / 34.2 / 32.0 | 8.6 / 34.6 / 56.8 | 3.62 | colonizer 67.5% |
| territoryPoints=false, maxExpandsPerTurn=3, winPoints=16 | real-4p-pure | 11.63 | 11.63 info | 64.6% FAIL | 2.2 pts PASS (seat 1) | 5.1% FAIL | 86.3% FAIL | FAIL (C2 C4 C5) | 27.2 / 25.4 / 24.2 / 23.2 | 1.5 / 10.9 / 28.0 / 59.7 | 6.19 | colonizer 64.6% |
| territoryPoints=false, maxExpandsPerTurn=3, winPoints=16 | real-3p-mixed | 11.63 | 11.63 FAIL | n/a | 5.0 pts PASS (seat 3) | 26.5% PASS | 93.4% FAIL | FAIL (C1 C5) | 36.8 / 34.8 / 28.3 | 24.1 / 39.8 / 36.1 | 6.44 | n/a (mixed) |
| territoryPoints=false, maxExpandsPerTurn=3, winPoints=16 | real-2p-pure | 11.54 | 11.54 info | 75.0% info | 0.9 pts info (seat 1) | 25.5% info | 53.9% info | n/a | 50.9 / 49.1 | 22.4 / 77.6 | 0.90 | colonizer 75.0% |
| territoryPoints=false, maxExpandsPerTurn=2, winPoints=14 | real-3p-pure | 13.81 | 13.81 PASS | 61.8% FAIL | 1.5 pts PASS (seat 1) | 10.3% FAIL | 80.4% FAIL | FAIL (C2 C4 C5) | 34.8 / 32.5 / 32.8 | 7.1 / 39.4 / 53.5 | 3.23 | colonizer 61.8% |
| territoryPoints=false, maxExpandsPerTurn=2, winPoints=14 | real-4p-pure | 13.62 | 13.62 info | 60.1% FAIL | 0.2 pts PASS (seat 3) | 3.2% FAIL | 86.4% FAIL | FAIL (C2 C4 C5) | 25.0 / 25.1 / 24.8 / 25.1 | 1.1 / 14.2 / 33.6 / 51.1 | 5.79 | colonizer 60.1% |
| territoryPoints=false, maxExpandsPerTurn=2, winPoints=14 | real-3p-mixed | 13.90 | 13.90 PASS | n/a | 3.0 pts PASS (seat 3) | 25.9% PASS | 94.8% FAIL | FAIL (C5) | 35.4 / 34.2 / 30.3 | 21.1 / 35.9 / 43.0 | 7.24 | n/a (mixed) |
| territoryPoints=false, maxExpandsPerTurn=2, winPoints=14 | real-2p-pure | 13.87 | 13.87 info | 65.4% info | 0.2 pts info (seat 2) | 26.8% info | 55.9% info | n/a | 50.1 / 49.9 | 20.4 / 79.6 | 0.80 | colonizer 65.4% |

**Provisional pick for stage C: territoryPoints `false`, maxExpandsPerTurn `2`, winPoints `14`.** It has 7 gate FAILs. The other three combinations have 9 each. There is no tie. Average rounds on real-3p-pure is 13.81, which passes C1.

Three of the four combinations (territoryPoints true with cap 3, territoryPoints true with cap 2, and territoryPoints false with cap 3) reached their closest value at winPoints 16, the top of the allowed range. Their averages stayed below 14, so the closest-to-14 rule picked the edge.

## Stage C: strategy balance

Stage A and B picks fixed: turnOrder `leaderLast`, winCheck `endOfTurn`, territoryPoints `false`, maxExpandsPerTurn `2`, winPoints `14`.

| Setting | Config | Avg rounds | C1 length | C2 top strategy | C3 worst seat dev | C4 last place r6 | C5 leader change | Gate | Seat win % (1 / 2 / 3) | Winner turn position % (1 / 2 / 3) | Annexes per game | Top strategy and rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| explorerMinContinents=4, cheapColonize=everyStuckTurn | real-3p-pure | 13.81 | 13.81 PASS | 61.8% FAIL | 1.5 pts PASS (seat 1) | 10.3% FAIL | 80.4% FAIL | FAIL (C2 C4 C5) | 34.8 / 32.5 / 32.8 | 7.1 / 39.4 / 53.5 | 3.23 | colonizer 61.8% |
| explorerMinContinents=4, cheapColonize=everyStuckTurn | real-4p-pure | 13.62 | 13.62 info | 60.1% FAIL | 0.2 pts PASS (seat 3) | 3.2% FAIL | 86.4% FAIL | FAIL (C2 C4 C5) | 25.0 / 25.1 / 24.8 / 25.1 | 1.1 / 14.2 / 33.6 / 51.1 | 5.79 | colonizer 60.1% |
| explorerMinContinents=4, cheapColonize=everyStuckTurn | real-3p-mixed | 13.90 | 13.90 PASS | n/a | 3.0 pts PASS (seat 3) | 25.9% PASS | 94.8% FAIL | FAIL (C5) | 35.4 / 34.2 / 30.3 | 21.1 / 35.9 / 43.0 | 7.24 | n/a (mixed) |
| explorerMinContinents=4, cheapColonize=everyStuckTurn | real-2p-pure | 13.87 | 13.87 info | 65.4% info | 0.2 pts info (seat 2) | 26.8% info | 55.9% info | n/a | 50.1 / 49.9 | 20.4 / 79.6 | 0.80 | colonizer 65.4% |
| explorerMinContinents=4, cheapColonize=oncePerGame | real-3p-pure | 13.81 | 13.81 PASS | 61.8% FAIL | 1.5 pts PASS (seat 1) | 10.3% FAIL | 80.4% FAIL | FAIL (C2 C4 C5) | 34.8 / 32.5 / 32.8 | 7.1 / 39.4 / 53.5 | 3.23 | colonizer 61.8% |
| explorerMinContinents=4, cheapColonize=oncePerGame | real-4p-pure | 13.62 | 13.62 info | 60.1% FAIL | 0.2 pts PASS (seat 3) | 3.2% FAIL | 86.4% FAIL | FAIL (C2 C4 C5) | 25.0 / 25.1 / 24.8 / 25.1 | 1.1 / 14.2 / 33.6 / 51.1 | 5.79 | colonizer 60.1% |
| explorerMinContinents=4, cheapColonize=oncePerGame | real-3p-mixed | 13.90 | 13.90 PASS | n/a | 3.0 pts PASS (seat 3) | 25.9% PASS | 94.8% FAIL | FAIL (C5) | 35.4 / 34.2 / 30.3 | 21.1 / 35.9 / 43.0 | 7.24 | n/a (mixed) |
| explorerMinContinents=4, cheapColonize=oncePerGame | real-2p-pure | 13.87 | 13.87 info | 65.4% info | 0.2 pts info (seat 2) | 26.8% info | 55.9% info | n/a | 50.1 / 49.9 | 20.4 / 79.6 | 0.80 | colonizer 65.4% |
| explorerMinContinents=5, cheapColonize=everyStuckTurn | real-3p-pure | 13.92 | 13.92 PASS | 64.6% FAIL | 1.8 pts PASS (seat 1) | 10.4% FAIL | 79.6% FAIL | FAIL (C2 C4 C5) | 35.1 / 32.4 / 32.5 | 6.4 / 38.1 / 55.5 | 3.27 | colonizer 64.6% |
| explorerMinContinents=5, cheapColonize=everyStuckTurn | real-4p-pure | 13.18 | 13.18 info | 66.2% FAIL | 1.0 pts PASS (seat 4) | 2.8% FAIL | 84.7% FAIL | FAIL (C2 C4 C5) | 25.2 / 24.9 / 25.9 / 24.0 | 0.9 / 11.3 / 30.5 / 57.2 | 5.69 | colonizer 66.2% |
| explorerMinContinents=5, cheapColonize=everyStuckTurn | real-3p-mixed | 14.20 | 14.20 PASS | n/a | 3.8 pts PASS (seat 3) | 27.3% PASS | 95.0% PASS | PASS | 35.8 / 34.6 / 29.5 | 23.2 / 37.4 / 39.4 | 7.61 | n/a (mixed) |
| explorerMinContinents=5, cheapColonize=everyStuckTurn | real-2p-pure | 14.27 | 14.27 info | 67.6% info | 0.5 pts info (seat 1) | 27.8% info | 56.2% info | n/a | 49.5 / 50.5 | 19.7 / 80.3 | 0.80 | cityBuilder 67.6% |
| explorerMinContinents=5, cheapColonize=oncePerGame | real-3p-pure | 13.92 | 13.92 PASS | 64.6% FAIL | 1.8 pts PASS (seat 1) | 10.4% FAIL | 79.6% FAIL | FAIL (C2 C4 C5) | 35.1 / 32.4 / 32.5 | 6.4 / 38.1 / 55.5 | 3.27 | colonizer 64.6% |
| explorerMinContinents=5, cheapColonize=oncePerGame | real-4p-pure | 13.18 | 13.18 info | 66.2% FAIL | 1.0 pts PASS (seat 4) | 2.8% FAIL | 84.7% FAIL | FAIL (C2 C4 C5) | 25.2 / 24.9 / 25.9 / 24.0 | 0.9 / 11.3 / 30.5 / 57.2 | 5.69 | colonizer 66.2% |
| explorerMinContinents=5, cheapColonize=oncePerGame | real-3p-mixed | 14.20 | 14.20 PASS | n/a | 3.8 pts PASS (seat 3) | 27.3% PASS | 95.0% PASS | PASS | 35.8 / 34.6 / 29.5 | 23.2 / 37.4 / 39.4 | 7.61 | n/a (mixed) |
| explorerMinContinents=5, cheapColonize=oncePerGame | real-2p-pure | 14.27 | 14.27 info | 67.6% info | 0.5 pts info (seat 1) | 27.8% info | 56.2% info | n/a | 49.5 / 50.5 | 19.7 / 80.3 | 0.80 | cityBuilder 67.6% |

Gate FAILs: explorerMinContinents 4 with either cheapColonize setting has 7. explorerMinContinents 5 with either setting has 6. The two cheapColonize settings match in every reported figure in all four configs.

**Provisional overall pick: explorerMinContinents `5`, cheapColonize `everyStuckTurn`.** explorerMinContinents 5 has fewer gate FAILs (6 against 7), so the FAIL count decides before the tie rules. For cheapColonize, the two settings tie on FAILs and on top-strategy rate, so the stated tie rule applies: everyStuckTurn over oncePerGame.

## Overall pick and final check

Overall pick, all stages combined:

```json
{"turnOrder": "leaderLast", "winCheck": "endOfTurn", "territoryPoints": false, "maxExpandsPerTurn": 2, "winPoints": 14, "explorerMinContinents": 5, "cheapColonize": "everyStuckTurn"}
```

Final check: the overall pick on the three gate configs, seed base 100000 with 2,000 games, next to the seed base 0 result from stage C (same rules).

| Config | Seed base | Avg rounds | C1 length | C2 top strategy | C3 worst seat dev | C4 last place r6 | C5 leader change | Gate |
|---|---|---|---|---|---|---|---|---|
| real-3p-pure | 0 | 13.92 | 13.92 PASS | 64.6% FAIL | 1.8 pts PASS | 10.4% FAIL | 79.6% FAIL | FAIL (C2 C4 C5) |
| real-3p-pure | 100000 | 13.86 | 13.86 PASS | 61.7% FAIL | 1.1 pts PASS | 9.3% FAIL | 77.9% FAIL | FAIL (C2 C4 C5) |
| real-4p-pure | 0 | 13.18 | 13.18 info | 66.2% FAIL | 1.0 pts PASS | 2.8% FAIL | 84.7% FAIL | FAIL (C2 C4 C5) |
| real-4p-pure | 100000 | 13.21 | 13.21 info | 66.3% FAIL | 0.9 pts PASS | 2.3% FAIL | 84.0% FAIL | FAIL (C2 C4 C5) |
| real-3p-mixed | 0 | 14.20 | 14.20 PASS | n/a | 3.8 pts PASS | 27.3% PASS | 95.0% PASS | PASS |
| real-3p-mixed | 100000 | 14.27 | 14.27 PASS | n/a | 3.9 pts PASS | 27.3% PASS | 95.8% PASS | PASS |

The C1 column for real-4p-pure is info only (not gated). The gate result for real-3p-pure and real-4p-pure fails on C2, C4 and C5 on both seed sets.

## Plain findings

- Turn order moved seat balance most. The worst seat deviation over the gate configs ran from 6.6 points (leaderLast, endOfTurn) to 62.1 points (snake, endOfTurn).
- Ending the win check at the end of the round cut the worst seat deviation under snake (62.1 to 18.2), clockwise (59.4 to 23.6) and rotate (47.9 to 15.1). Under leaderLast it changed little (6.6 to 7.2).
- No turn order or win check setting reached the 12 to 16 round band. On real-3p-pure, average length ran from 3.86 to 4.22 rounds across the eight settings.
- Turning territory points off made games much longer. At winPoints 16 and cap 3, real-3p-pure averaged 11.77 rounds with territory points off and 6.56 with them on.
- A cap of 2 expands made games longer than a cap of 3. At winPoints 10 and territory points off, the sweep gave 7.52 rounds with cap 2 and 5.71 with cap 3.
- The chosen rules put real-3p-pure in the 12 to 16 band (13.92 rounds on seed 0, 13.86 on seed 100000). real-3p-mixed passes all four of its gated checks on both seed sets.
- At the overall pick, the colonizer is the top strategy in both pure configs, at 61.7% to 66.3% across the two seed sets. Raising explorerMinContinents from 4 to 5 raised its share: from 61.8% to 64.6% on real-3p-pure, and from 60.1% to 66.2% on real-4p-pure.
- cheapColonize made no difference in any reported figure across the four configs. The engine does read the option, and I did not look into why its effect is zero here.
- Annexes rose sharply. Per game, they went from 0.60 under the defaults (snake, endOfTurn, real-3p-pure) to 3.27 at the overall pick. The defaults gave 1.07 per game on real-4p-pure, and the pick gives 5.69.
- The chosen rules trade away the last-place comeback. On real-3p-pure, the last-place player at round 6 won 38.2% of games under the defaults (C4 passes) and 10.4% under the overall pick (C4 fails at 15%).

## Gates still failing (overall pick)

- C2 top strategy, 40% or less. real-3p-pure: colonizer at 64.6% (seed 0) and 61.7% (seed 100000). real-4p-pure: colonizer at 66.2% and 66.3%.
- C4 last place at round 6 wins, 15% or more. real-3p-pure: 10.4% and 9.3%. real-4p-pure: 2.8% and 2.3%.
- C5 leader change after round 5, 95% or more. real-3p-pure: 79.6% and 77.9%. real-4p-pure: 84.7% and 84.0%.
- Passing: C1 on real-3p-pure. C3 on all three gate configs. All checks on real-3p-mixed.
- real-3p-mixed C5 is exactly 95.0% (1,900 of 2,000) on seed 0, which passes on the threshold. On seed 100000 it is 95.8%.

## Notes on the numbers

- Winner turn position: under snake with endOfTurn, position 1 has a 0.0% share in both the 3-player and 2-player runs, and under rotate with endOfTurn the 2-player position 1 share is 0.0%. I did not check why.
- Seed 0 and seed 100000 differ by at most 0.1 rounds in average length, and by at most 2.9 points in any rate in the final check table.
- Win-rate and length numbers come from the simulator's bots (knowP 0.6). They are not measures of play with people.

## How to reproduce

The simulator reads its rules from the file given by `--rules`. Keep `scripts/empire2-sim/rules.json` as `{}`. Make a rules file for each setting, then run the simulator from the worktree root (`/home/user/wt-empire2`, commit afe7ce3). Exit code 1 means a gate failed and is a normal result.

Overall pick, with its rules file:

```bash
mkdir -p /home/user/e2e-reports/empire2-compare/repro/overall-pick
cat > /home/user/e2e-reports/empire2-compare/repro/overall-pick/rules.json <<'EOF'
{"turnOrder": "leaderLast", "winCheck": "endOfTurn", "territoryPoints": false, "maxExpandsPerTurn": 2, "winPoints": 14, "explorerMinContinents": 5, "cheapColonize": "everyStuckTurn"}
EOF
cd /home/user/wt-empire2
node --import tsx scripts/empire2-sim/run.ts --config real-3p-pure --config real-4p-pure --config real-3p-mixed --games 2000 --seed-base 0 --rules /home/user/e2e-reports/empire2-compare/repro/overall-pick/rules.json --out /home/user/e2e-reports/empire2-compare/repro/overall-pick
# final check, fresh seeds
node --import tsx scripts/empire2-sim/run.ts --config real-3p-pure --config real-4p-pure --config real-3p-mixed --games 2000 --seed-base 100000 --rules /home/user/e2e-reports/empire2-compare/repro/overall-pick/rules.json --out /home/user/e2e-reports/empire2-compare/repro/overall-pick-seed100000
```

The other settings use the same command with a different rules file. For a winPoints sweep, add `--config real-3p-pure --games 1000` with one winPoints value per run.

Stage A and B picks, as they fed the overall pick:

- Stage A: `{"turnOrder": "leaderLast", "winCheck": "endOfTurn"}`
- Stage B: add `"territoryPoints": false, "maxExpandsPerTurn": 2, "winPoints": 14`
- Stage C: add `"explorerMinContinents": 5, "cheapColonize": "everyStuckTurn"`

