# Empire 2.0: gate report v2 (step 4b, play rules)

Date: 2026-11-20
Base commit: 1d7c0f2 (owner-chosen play rules). This report and the tuning log section are added in the step 4b commit (see `git log`).
Result: NOT PASSED. The final check fails C2, C4 and C5 on real-3p-pure and real-4p-pure, on both seed sets. `EMPIRE2_PLAY_RULES` is unchanged.

## Final settings

Base: `EMPIRE2_PLAY_RULES` (1d7c0f2). Only these four numbers were tuned:

| Field | Play rules value | Tuned value | Range tried |
|---|---|---|---|
| `colonizeCost` | 4 | 6 | 3 to 6 |
| `winPoints` | 14 | 14 (unchanged) | 8 to 16 |
| `underdogIncome` | 2 | 3 | 0 to 6 |
| `underdogGap` | 2 | 1 | 1 to 5 |

The tuned values are a recommendation only. They are not in `EMPIRE2_PLAY_RULES`.

Code change (owner-approved): `scripts/empire2-sim/config.ts`, `TUNABLE_RANGES`.
- Old: `  underdogGap: [1, 3],` and `  underdogIncome: [1, 3],`
- New: `  underdogGap: [1, 5],` and `  underdogIncome: [0, 6],`
No test asserted the old range, so no test changed.

## Final check table

Seed base 0 is the gate run (2,000 games per config). Seed base 100000 is the final check (2,000 games per config). Both use the final settings above. Each check shows PASS or FAIL. For real-4p-pure, C1 is reported only (not gated), as the simulator defines it. The real-3p-mixed config checks C1, C3, C4 and C5 only.

| Config | Seed set | Check | Value | Threshold | Result |
|---|---|---|---|---|---|
| real-3p-pure | 0 (gate run) | C1 average length (rounds) | 14.15 | 12.00 to 16.00 | PASS |
| real-3p-pure | 0 (gate run) | C2 top strategy rate | 61.9% | <= 40.0% | FAIL |
| real-3p-pure | 0 (gate run) | C3 worst seat deviation | 1.6 pts | <= 5.0 pts | PASS |
| real-3p-pure | 0 (gate run) | C4 last place at round 6 wins | 13.1% | >= 15.0% | FAIL |
| real-3p-pure | 0 (gate run) | C5 leader change after round 5 | 81.8% | >= 95.0% | FAIL |
| real-3p-pure | 100000 (final check) | C1 average length (rounds) | 13.94 | 12.00 to 16.00 | PASS |
| real-3p-pure | 100000 (final check) | C2 top strategy rate | 60.5% | <= 40.0% | FAIL |
| real-3p-pure | 100000 (final check) | C3 worst seat deviation | 2.3 pts | <= 5.0 pts | PASS |
| real-3p-pure | 100000 (final check) | C4 last place at round 6 wins | 10.9% | >= 15.0% | FAIL |
| real-3p-pure | 100000 (final check) | C5 leader change after round 5 | 79.8% | >= 95.0% | FAIL |
| real-4p-pure | 0 (gate run) | C1 average length (rounds) | 13.88 | 12.00 to 16.00 | info (not gated) |
| real-4p-pure | 0 (gate run) | C2 top strategy rate | 57.9% | <= 40.0% | FAIL |
| real-4p-pure | 0 (gate run) | C3 worst seat deviation | 2.0 pts | <= 5.0 pts | PASS |
| real-4p-pure | 0 (gate run) | C4 last place at round 6 wins | 4.1% | >= 15.0% | FAIL |
| real-4p-pure | 0 (gate run) | C5 leader change after round 5 | 88.8% | >= 95.0% | FAIL |
| real-4p-pure | 100000 (final check) | C1 average length (rounds) | 13.92 | 12.00 to 16.00 | info (not gated) |
| real-4p-pure | 100000 (final check) | C2 top strategy rate | 59.3% | <= 40.0% | FAIL |
| real-4p-pure | 100000 (final check) | C3 worst seat deviation | 1.0 pts | <= 5.0 pts | PASS |
| real-4p-pure | 100000 (final check) | C4 last place at round 6 wins | 4.6% | >= 15.0% | FAIL |
| real-4p-pure | 100000 (final check) | C5 leader change after round 5 | 88.0% | >= 95.0% | FAIL |
| real-3p-mixed | 0 (gate run) | C1 average length (rounds) | 14.22 | 12.00 to 16.00 | PASS |
| real-3p-mixed | 0 (gate run) | C3 worst seat deviation | 3.8 pts | <= 5.0 pts | PASS |
| real-3p-mixed | 0 (gate run) | C4 last place at round 6 wins | 27.6% | >= 15.0% | PASS |
| real-3p-mixed | 0 (gate run) | C5 leader change after round 5 | 95.2% | >= 95.0% | PASS |
| real-3p-mixed | 100000 (final check) | C1 average length (rounds) | 14.29 | 12.00 to 16.00 | PASS |
| real-3p-mixed | 100000 (final check) | C3 worst seat deviation | 3.7 pts | <= 5.0 pts | PASS |
| real-3p-mixed | 100000 (final check) | C4 last place at round 6 wins | 27.8% | >= 15.0% | PASS |
| real-3p-mixed | 100000 (final check) | C5 leader change after round 5 | 95.8% | >= 95.0% | PASS |

Gate summary:
- real-3p-pure: FAIL on both seed sets (C2, C4, C5).
- real-4p-pure: FAIL on both seed sets (C2, C4, C5).
- real-3p-mixed: PASS on both seed sets (C1, C3, C4, C5).

## Still failing

- C2, top strategy 40% or less. The colonizer wins 60% to 62% of real-3p-pure games and 57% to 59% of real-4p-pure games. No colonizeCost from 3 to 6 brings it under 40%.
- C4, last place at round 6 wins 15% or more. real-3p-pure: 13.1% and 10.9%. real-4p-pure: 4.1% and 4.6%. No combination in the comeback grid reached 15%.
- C5, leader change after round 5 in 95% or more of games. real-3p-pure: 81.8% and 79.8%. real-4p-pure: 88.8% and 88.0%. No combination in the comeback grid reached 95%.

## Stage 1 diagnosis (C2)

Run: real-3p-pure, 2,000 games, seed base 0, `colonizeCost` 6, other values as in the play rules. Colonizer win rate 62.8%.

Average points per seat, by source (from the run records):

| Strategy | Cities | Region sets | Largest empire | Total points | Colonizes per seat | Annexes per seat |
|---|---|---|---|---|---|---|
| colonizer | 4.00 | 8.87 | 0.30 | 13.17 | 0.52 | 0.00 |
| cityBuilder | 4.00 | 7.27 | 0.75 | 12.03 | 0.39 | 1.71 |
| annexer | 4.00 | 6.97 | 0.92 | 11.89 | 0.32 | 1.99 |
| expander | 0.00 | 7.19 | 0.70 | 7.89 | 0.40 | 0.00 |

Territory points and explorer points are 0 for every strategy (the play rules turn territory points off and the explorer title off).

The records count colonizes, cities and annexes. They do not count region sets completed, only the points. So the region-set count per strategy is not reported. The colonizer gets the most region-set points, which is where its lead comes from.

## EXPLORATORY: region-set point values (needs an owner decision)

These two runs change the rules. They were run in a private copy of the repo, which is deleted. Nothing was committed. Both use real-3p-pure, 2,000 games, seed base 0, `colonizeCost` 6.

| Region set points (2 to 5 / 6 to 10 / 11 or more countries) | Average rounds | Colonizer win rate |
|---|---|---|
| Current rules: 2 / 3 / 4 | 14.07 | 62.8% |
| (a) 1 / 2 / 3 | 19.31 | 63.6% |
| (b) 1 / 1 / 2 | 20.00 | 60.5% |

Neither alternative brings the colonizer under 40%. Both make games much longer: 19.31 and 20.00 average rounds, both above the C1 limit of 16. These are not tuning steps. Changing region-set points is a rule change, and it needs an owner decision.

## Decision needed from the owner

The numbers alone do not pass C2, C4 and C5 on the pure configs. Options:
1. Accept the documented misses and move on to the phase 3 playtest (the plan allows this if the owner decides).
2. Change a rule that affects the colonizer (the plan's step 4 says to stop and ask the owner when a gate still fails).

The simulator bots are not people. The win rates here are a measure of the bots, not of play with people.

## Run counts

- Sweep runs (1,000 games, one config each): 53 of the 60 cap, including one start-state check.
- Gate runs (three GATE configs at 2,000 games): 2 of the 25 cap (gate run and final check).
- Diagnosis and probe runs (2,000 games, one config): 3.
- Stop condition applied: a gate still fails after all stages (C2, C4, C5 on real-3p-pure and real-4p-pure). Tuning stopped after stage 4.

## How to reproduce

Run everything from the worktree root (`/home/user/wt-empire2`, base commit 1d7c0f2). Keep `scripts/empire2-sim/rules.json` as `{}` plus a newline. Exit code 1 means a gate failed. That is a normal result here. Exit code 2 means the rules file was invalid.

The final settings rules file (save as `rules-final.json`):

```json
{"colonizeCost": 6, "winPoints": 14, "underdogIncome": 3, "underdogGap": 1}
```

Gate run and final check:

```bash
cd /home/user/wt-empire2
mkdir -p /home/user/e2e-reports/empire2-tune/final
cat > /home/user/e2e-reports/empire2-tune/final/rules-final.json <<'JSON'
{"colonizeCost": 6, "winPoints": 14, "underdogIncome": 3, "underdogGap": 1}
JSON
node --import tsx scripts/empire2-sim/run.ts --config real-3p-pure --config real-4p-pure --config real-3p-mixed --games 2000 --seed-base 0 --rules /home/user/e2e-reports/empire2-tune/final/rules-final.json --out /home/user/e2e-reports/empire2-tune/final/seed0
node --import tsx scripts/empire2-sim/run.ts --config real-3p-pure --config real-4p-pure --config real-3p-mixed --games 2000 --seed-base 100000 --rules /home/user/e2e-reports/empire2-tune/final/rules-final.json --out /home/user/e2e-reports/empire2-tune/final/seed100000
```

Stage 1 (colonizeCost sweep). For each value N in 3, 4, 5, 6, make `{"colonizeCost": N}` and run:

```bash
node --import tsx scripts/empire2-sim/run.ts --config real-3p-pure --config real-4p-pure --games 1000 --seed-base 0 --rules <rules-file> --out <out-dir>
```

Stage 2 (winPoints sweep). With `colonizeCost` 6, for each value N in 8 to 16, make `{"colonizeCost": 6, "winPoints": N}` and run `--config real-3p-pure --games 1000 --seed-base 0 --rules <rules-file> --out <out-dir>`.

Stage 3 (comeback grid). With `colonizeCost` 6 and `winPoints` 14, for each `underdogIncome` I in 0 to 6 and `underdogGap` G in 1 to 5, make `{"colonizeCost": 6, "winPoints": 14, "underdogIncome": I, "underdogGap": G}` and run `--config real-3p-pure --games 1000 --seed-base 0 --rules <rules-file> --out <out-dir>`.

Diagnosis (2,000 games): `{"colonizeCost": 6}` with `--config real-3p-pure --games 2000 --seed-base 0 --rules <rules-file> --out <out-dir>`. The per-strategy numbers come from the `*.records.json` file in the output folder.

EXPLORATORY probes: copy the repo with `git -C /home/user/wt-empire2 archive HEAD | tar -x -C <probe-dir>` and link `node_modules`. In `lib/empire2/rules.ts`, change `regionSetPoints` to return 1 / 2 / 3 (probe a) or 1 / 1 / 2 (probe b). Then run the same 2,000-game command from the probe folder. Do not commit the probe.

Run folders hold a `.txt` report, a `.json` summary and a `.records.json` file for each config.

