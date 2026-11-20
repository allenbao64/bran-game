# Empire 2.0: underdog income experiment

Date: 2026-11-20
Commit: the runs used the simulator and engine as committed at 24dea20. No engine rule and no bot changed. The commit that adds this file changes only docs and rules files.

## Question

The provisional base in `candidate-rules.md` gives a trailing player `underdogIncome` 3. This experiment asks whether a bigger underdog bonus helps a trailing player come back. It tests 5 and 6 against the base. It does not choose the rules.

## Design

Base: `scripts/empire2-sim/rules-candidate.json`. Each arm is the base with one change:

| Arm | Rules file | Change on top of the base |
|---|---|---|
| U0 base | `/home/user/e2e-reports/empire2-underdog/rules/U0-base.json` | none |
| U5 | `/home/user/e2e-reports/empire2-underdog/rules/U5.json` | `underdogIncome` 5 |
| U6 | `/home/user/e2e-reports/empire2-underdog/rules/U6.json` | `underdogIncome` 6 |

Configs: `real-3p-pure`, `real-4p-pure` and `real-3p-mixed`. Each run has 1,000 games and seed base 0, so every arm plays the same seeds with the same lineups. That is 9 runs. The `underdogIncome` range in the simulator is 0 to 6, so 5 and 6 are in range. Exit code 1 (a gate failed) is normal here. No run returned 2 or 3.

Check on the pipeline: the U0 run is identical, game for game, to the winPoints 16 arm B run in `roads-and-luck-experiment.md`. That run has the same rules.

## Success criterion (set before the runs)

Applied to `real-3p-pure`. An arm meets the criterion when all three hold:

1. C4 (last place at round 6 wins) is at least 5 points above U0, and the paired 95% interval excludes 0.
2. C1 (average rounds) is still within 12 to 16 at 3 players.
3. The city-building strategies' max minus min win rate is no more than 5 points worse than U0.

## Method

- Single proportions use Wilson 95% intervals.
- Differences from U0 are paired over games. The same seed gives the same lineup, so each game gives an outcome difference. The interval is the mean difference plus or minus 1.96 standard errors of the per-game differences. A per-appearance win rate is a ratio of sums, so its standard error uses the linearised ratio form.
- Max minus min, within 10 points and the effective number are point values for the three city-building strategies (cityBuilder, colonizer and annexer). Their differences use a paired bootstrap over games (2,000 resamples, the same resample for both arms).
- C1, C4 and C5 are recomputed from the game records. They match the simulator report.
- C4 and "leader at start of round 6 wins" use games that reach round 6. C4 also skips games where every seat is tied at round 6. For paired differences, only games valid in both arms are used.
- SIGNIFICANT means the paired 95% interval excludes 0.

## Results

Win rates are per seat appearance. Gate rows show what the simulator report says.

### real-3p-pure

| Metric | U0 base | U5 | U6 | U5 minus U0 (paired 95% CI) | U6 minus U0 (paired 95% CI) |
|---|---|---|---|---|---|
| Win rate per appearance: expander (fair 33.3%) | 5.5% (4.1% to 7.3%) | 5.2% (3.8% to 7.0%) | 5.4% (4.0% to 7.2%) | -0.3 pts (-1.5 to +0.9) not significant | -0.1 pts (-1.5 to +1.4) not significant |
| Win rate per appearance: cityBuilder (fair 33.3%) | 39.1% (35.7% to 42.6%) | 41.4% (37.9% to 44.9%) | 40.5% (37.0% to 44.1%) | +2.3 pts (-0.4 to +5.0) not significant | +1.4 pts (-1.6 to +4.4) not significant |
| Win rate per appearance: colonizer (fair 33.3%) | 47.6% (44.0% to 51.2%) | 46.8% (43.2% to 50.4%) | 46.9% (43.3% to 50.5%) | -0.8 pts (-3.4 to +1.8) not significant | -0.7 pts (-3.7 to +2.4) not significant |
| Win rate per appearance: annexer (fair 33.3%) | 42.2% (38.7% to 45.8%) | 41.0% (37.5% to 44.5%) | 41.5% (38.0% to 45.1%) | -1.2 pts (-3.8 to +1.4) not significant | -0.7 pts (-3.5 to +2.1) not significant |
| City-building max minus min win rate | 8.5 pts | 5.8 pts | 6.4 pts | -2.7 pts (-6.5 to +2.8) not significant | -2.1 pts (-6.6 to +3.5) not significant |
| City-building strategies within 10 pts of the top (of 3) | 3 | 3 | 3 | +0 | +0 |
| City-building effective number | 2.98 | 2.99 | 2.99 | +0.01 (-0.01 to +0.03) not significant | +0.01 (-0.02 to +0.03) not significant |
| C1 average rounds | 14.72 (SD 3.27) | 14.65 (SD 3.32) | 14.55 (SD 3.28) | -0.07 rounds (-0.19 to +0.05) not significant | -0.17 rounds (-0.31 to -0.03) **SIGNIFICANT** |
| C4 last place at round 6 wins | 18.6% (16.3% to 21.1%), n=993 | 17.5% (15.2% to 20.0%), n=993 | 17.1% (14.9% to 19.6%), n=993 | -1.2 pts (-3.0 to +0.7) not significant | -1.5 pts (-3.5 to +0.6) not significant |
| C5 leader change after round 5 | 87.8% (85.6% to 89.7%), n=1000 | 86.7% (84.5% to 88.7%), n=1000 | 86.7% (84.5% to 88.7%), n=1000 | -1.1 pts (-2.4 to +0.2) not significant | -1.1 pts (-2.6 to +0.4) not significant |
| Leader at start of round 6 wins | 43.7% (40.4% to 47.0%), n=884 | 43.1% (39.9% to 46.4%), n=883 | 44.0% (40.8% to 47.3%), n=886 | -0.2 pts (-2.6 to +2.1) not significant | +0.6 pts (-2.2 to +3.3) not significant |
| Games ending before round 6 | 0 | 0 | 0 | | |
| Gate check C1 (report) | PASS | PASS | PASS | | |
| Gate check C2 (report) | FAIL | FAIL | FAIL | | |
| Gate check C3 (report) | PASS | PASS | PASS | | |
| Gate check C4 (report) | PASS | PASS | PASS | | |
| Gate check C5 (report) | FAIL | FAIL | FAIL | | |
| Gate (report) | FAIL | FAIL | FAIL | | |

### real-4p-pure

| Metric | U0 base | U5 | U6 | U5 minus U0 (paired 95% CI) | U6 minus U0 (paired 95% CI) |
|---|---|---|---|---|---|
| Win rate per appearance: expander (fair 25.0%) | 3.0% (2.1% to 4.3%) | 2.9% (2.0% to 4.1%) | 2.8% (1.9% to 4.0%) | -0.1 pts (-1.1 to +0.9) not significant | -0.2 pts (-1.3 to +0.9) not significant |
| Win rate per appearance: cityBuilder (fair 25.0%) | 29.3% (26.6% to 32.2%) | 29.5% (26.8% to 32.4%) | 28.8% (26.1% to 31.7%) | +0.2 pts (-2.2 to +2.6) not significant | -0.5 pts (-3.1 to +2.1) not significant |
| Win rate per appearance: colonizer (fair 25.0%) | 41.8% (38.7% to 44.8%) | 41.3% (38.3% to 44.4%) | 42.9% (39.9% to 46.0%) | -0.4 pts (-3.2 to +2.3) not significant | +1.1 pts (-1.7 to +4.0) not significant |
| Win rate per appearance: annexer (fair 25.0%) | 25.9% (23.3% to 28.8%) | 26.3% (23.7% to 29.1%) | 25.5% (22.9% to 28.3%) | +0.4 pts (-2.1 to +2.8) not significant | -0.4 pts (-3.0 to +2.1) not significant |
| City-building max minus min win rate | 15.8 pts | 15.0 pts | 17.4 pts | -0.8 pts (-5.3 to +3.6) not significant | +1.6 pts (-3.1 to +6.1) not significant |
| City-building strategies within 10 pts of the top (of 3) | 1 | 1 | 1 | +0 | +0 |
| City-building effective number | 2.87 | 2.89 | 2.85 | +0.01 (-0.05 to +0.08) not significant | -0.03 (-0.10 to +0.05) not significant |
| C1 average rounds | 14.54 (SD 3.08) | 14.65 (SD 3.03) | 14.65 (SD 3.05) | +0.12 rounds (-0.04 to +0.28) not significant | +0.11 rounds (-0.06 to +0.28) not significant |
| C4 last place at round 6 wins | 7.3% (5.8% to 9.1%), n=1000 | 8.1% (6.5% to 9.9%), n=1000 | 8.5% (6.9% to 10.4%), n=1000 | +0.8 pts (-0.7 to +2.3) not significant | +1.2 pts (-0.3 to +2.8) not significant |
| C5 leader change after round 5 | 92.4% (90.6% to 93.9%), n=1000 | 91.2% (89.3% to 92.8%), n=1000 | 91.8% (89.9% to 93.3%), n=1000 | -1.2 pts (-2.6 to +0.2) not significant | -0.6 pts (-2.2 to +1.0) not significant |
| Leader at start of round 6 wins | 34.7% (31.6% to 37.9%), n=876 | 36.4% (33.3% to 39.6%), n=885 | 34.9% (31.9% to 38.1%), n=887 | +1.4 pts (-1.4 to +4.2) not significant | +0.0 pts (-3.1 to +3.1) not significant |
| Games ending before round 6 | 0 | 0 | 0 | | |
| Gate check C1 (report) | info | info | info | | |
| Gate check C2 (report) | FAIL | FAIL | FAIL | | |
| Gate check C3 (report) | PASS | PASS | PASS | | |
| Gate check C4 (report) | FAIL | FAIL | FAIL | | |
| Gate check C5 (report) | FAIL | FAIL | FAIL | | |
| Gate (report) | FAIL | FAIL | FAIL | | |

### real-3p-mixed

Every seat plays the mixed strategy here, so the per-strategy row is a single row, and the city-building measures do not apply.

| Metric | U0 base | U5 | U6 | U5 minus U0 (paired 95% CI) | U6 minus U0 (paired 95% CI) |
|---|---|---|---|---|---|
| Win rate per appearance: mixed (fair 33.3%) | 33.3% (31.7% to 35.0%) | 33.3% (31.7% to 35.0%) | 33.3% (31.7% to 35.0%) | +0.0 pts (+0.0 to +0.0) not significant | +0.0 pts (+0.0 to +0.0) not significant |
| C1 average rounds | 14.18 (SD 3.38) | 14.18 (SD 3.39) | 14.18 (SD 3.39) | +0.01 rounds (-0.01 to +0.02) not significant | +0.01 rounds (-0.01 to +0.02) not significant |
| C4 last place at round 6 wins | 27.5% (24.8% to 30.3%), n=998 | 27.5% (24.8% to 30.4%), n=998 | 27.5% (24.8% to 30.4%), n=998 | +0.1 pts (-0.2 to +0.3) not significant | +0.1 pts (-0.2 to +0.3) not significant |
| C5 leader change after round 5 | 97.1% (95.9% to 98.0%), n=1000 | 97.1% (95.9% to 98.0%), n=1000 | 97.1% (95.9% to 98.0%), n=1000 | +0.0 pts (+0.0 to +0.0) not significant | +0.0 pts (+0.0 to +0.0) not significant |
| Leader at start of round 6 wins | 34.9% (31.9% to 38.0%), n=936 | 35.1% (32.1% to 38.2%), n=937 | 35.1% (32.1% to 38.2%), n=937 | +0.1 pts (-0.3 to +0.5) not significant | +0.1 pts (-0.3 to +0.5) not significant |
| Games ending before round 6 | 0 | 0 | 0 | | |
| Gate check C1 (report) | PASS | PASS | PASS | | |
| Gate check C2 (report) | not checked | not checked | not checked | | |
| Gate check C3 (report) | PASS | PASS | PASS | | |
| Gate check C4 (report) | PASS | PASS | PASS | | |
| Gate check C5 (report) | PASS | PASS | PASS | | |
| Gate (report) | PASS | PASS | PASS | | |

## Did each arm meet the criterion?

- U5: no. C4 moved -1.2 points against U0 (paired 95% interval -3.0 to +0.7), so the +5 test failed. C1 is 14.65, inside the band. The city-building max minus min is 5.8 points, against 8.5 for U0, so it is not worse.
- U6: no. C4 moved -1.5 points (paired 95% interval -3.5 to +0.6). C1 is 14.55, inside the band. The city-building max minus min is 6.4 points, against 8.5 for U0, so it is not worse.

## Findings

- At 3 players, a bigger underdog bonus does not raise last-place comebacks. C4 moves -1.2 points for U5 and -1.5 points for U6, and neither interval excludes 0.
- U6 makes games slightly shorter. Average rounds fall by 0.17 (paired 95% interval -0.31 to -0.03, SIGNIFICANT), from 14.72 to 14.55. The U5 change of -0.07 rounds is not significant. Both arms stay in the 12 to 16 band.
- City-building balance does not change at 3 players. Max minus min is 8.5 points under U0, 5.8 under U5 and 6.4 under U6, and none of the differences is significant. C2 and C5 fail in every arm, as before.
- At 4 players, C4 is 7.3% under U0, 8.1% under U5 and 8.5% under U6. The rises of +0.8 and +1.2 are not significant. C4 stays below its 15% gate in all arms.
- In `real-3p-mixed`, no measure moves. C1, C4 (27.5% in every arm), C5 (97.1% in every arm) and leader holds change by 0.1 points or less, and none is significant.
- The bonus is paid. The median first income difference from U0 comes in round 2 (round 3 in mixed play). At each game's first differing round, every seat that differs gains exactly 2 income under U5 or exactly 3 under U6. The rule is active, but its effect on outcomes is small enough that only the U6 round change is detectable.

## How to reproduce

From `/home/user/wt-empire2` at 24dea20 or later, with no engine change:

```bash
for arm in U0-base U5 U6; do
  for cfg in real-3p-pure real-4p-pure real-3p-mixed; do
    node --import tsx scripts/empire2-sim/run.ts --config $cfg --games 1000 --seed-base 0 \
      --rules /home/user/e2e-reports/empire2-underdog/rules/$arm.json \
      --out /home/user/e2e-reports/empire2-underdog/$arm/$cfg
  done
done
```

Exit code 1 means a gate failed (normal). Exit code 2 means a rules file is invalid.

Analysis (outside the repo):

```bash
python3 -I /home/user/e2e-reports/empire2-underdog/analyse.py
```

This writes `analysis/tables-<config>.md` and `analysis/summary.json` under `/home/user/e2e-reports/empire2-underdog/`. The 9 runs were started with `run-one.sh` and `jobs.txt` in the same folder.
