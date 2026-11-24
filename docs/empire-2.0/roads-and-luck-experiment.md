# Empire 2.0: many-roads and luck experiment

Date: 2026-11-20
Commit: the commit that adds this file. The runs used the simulator at af1d3ee plus one config change in the same commit (three keys become settable from rules files). That change adds no rule to the engine.

## The question

The owner wants two things from the game:

- Many roads to victory. Several strategies should win often, as in Catan.
- Some luck, so a player who is behind can still come back.

We tested four candidate rule changes against a baseline with bot games. This file reports the numbers. It does not choose the rules. The owner decides.

## Design

Baseline: the play rules with the tuned numbers. Every arm starts from this file:

```json
{"colonizeCost": 6, "winPoints": 14, "underdogIncome": 3, "underdogGap": 1}
```

| Arm | Change on top of the baseline |
|---|---|
| 0 BASELINE | nothing more |
| A city road | `maxCities` 6 (play rules: 4) |
| B empire road | `largestEmpirePoints` 4 (play rules: 2) |
| C luck: bigger booms | `boomRegionCount` 5 (play rules: 3), `boomIncome` 2 (play rules: 1), `boomCityIncome` 3 (play rules: 2) |
| D combined | A, B and C together |

Configs: `real-3p-pure` and `real-4p-pure` (the strategy question) and `real-3p-mixed` (mixed play, closer to people).

Games: 1,000 per arm per config, so 15 runs. Every arm uses seed base 0, so all arms play the same 1,000 seeds. Same seeds remove differences in starting positions and lineups, but games diverge after the first rule-dependent event, so sampling noise remains.

Step 1 (settable values): the engine reads all three keys from the rules at every use. `maxCities` is read in `lib/empire2/actions.ts` and `lib/empire2/victory.ts`, and the bots read it in `scripts/empire2-sim/bots.ts`. `largestEmpirePoints` is read in `lib/empire2/victory.ts`. `boomRegionCount` is read in `lib/empire2/turns.ts` and passed to `drawBooms` in `lib/empire2/economy.ts`. In `scripts/empire2-sim/config.ts`:

- `maxCities` range: `[3, 5]` became `[3, 6]`.
- `largestEmpirePoints` moved from `PINNED_KEYS` to `TUNABLE_RANGES` as `[1, 5]`.
- `boomRegionCount` moved from `PINNED_KEYS` to `TUNABLE_RANGES` as `[2, 6]`.

No test asserted the old range or the pinned status, so no test changed. `npm test` passed with 617 of 617 tests.

### Why 1,000 games is enough

- A strategy's win rate at 3 players has a 95% interval about 7.0 points wide (colonizer, baseline: 61.5%, n=742).
- C4 has a 95% interval about 4.3 points wide (baseline: 13.6%, n=981).
- For a difference between two arms, the interval half-width is about 5 points for a win rate and about 3 points for C4.

So differences of about 10 points or more are clear. Differences under about 5 points cannot be told apart from zero. The results below mark each difference as SIGNIFICANT or not.

### Metrics

- Win rate per appearance: wins divided by the number of seats that strategy filled. A shared win counts as a fraction. Interval: p plus or minus 1.96 times the square root of p(1-p)/n.
- Fair share: 1 divided by the number of players.
- ROADS: the number of strategies at or above 75% of the fair share (25% at 3 players, 18.75% at 4).
- SPREAD: the highest minus the lowest per-appearance win rate.
- Winners' largest source: for each winning player, the largest of cities, region sets and largest empire. A tie counts as mixed. Shares are over all winning players.
- C1, C4 and C5 come from the simulator's report. C4 is last place at round 6 wins. C5 is a leader change after round 5. C1 is average rounds.
- Leader holds: the share of games won by the player who led at the start of round 6, counting only games with one leader and at least six rounds.
- Differences use the same formula as the proportions: difference plus or minus 1.96 times the square root of p1(1-p1)/n1 plus p2(1-p2)/n2. ROADS and SPREAD are counts or differences of maxima, so their intervals come from 2,000 bootstrap resamples of games. C1 uses the standard error of the mean from the game records.

### Pairing, multiple tests and round-6 subsets

The difference intervals treat the two arms as independent, so they are conservative. Every arm plays the same seeds, so the games are paired. Measured paired half-widths for the colonizer win rate on `real-3p-pure` are 3.9 points for arm B (against about 5.0 unpaired), 4.2 for arm A (against 5.0), 4.1 for arm D (against 5.0) and 2.8 for arm C (against 5.0).

About 60 difference tests per config were run with no multiplicity correction: 56 in each pure config and 44 in `real-3p-mixed`. Some intervals will exclude 0 by chance. The winPoints 16 runs in step 4 were chosen after seeing the first results.

C4 and "leader at start of round 6 wins" use only games that reach round 6. C4 also skips games where every seat is tied at the start of round 6. Games ending before round 6 were: `real-3p-pure`, 0 (baseline), 1 (A), 1 (B), 0 (C) and 106 (D); `real-4p-pure`, 108 for D; `real-3p-mixed`, 115 for D. So arm D's round-6 metrics come from a different subset of games, and its C5 fall is partly because games are shorter.

## Results

Each table shows every metric for each arm, then the difference from the baseline on the same config. SIGNIFICANT means the 95% interval excludes 0.

### real-3p-pure

| Metric | Baseline | A city road | B empire road | C luck booms | D combined |
|---|---|---|---|---|---|
| Win rate per appearance: expander (fair 33.3%) | 4.6% (3.1% to 6.0%), n=769 | 2.0% (1.0% to 2.9%), n=769 | 5.5% (3.9% to 7.1%), n=769 | 5.6% (4.0% to 7.2%), n=769 | 2.7% (1.6% to 3.9%), n=769 |
| Win rate per appearance: cityBuilder (fair 33.3%) | 33.7% (30.3% to 37.1%), n=747 | 43.1% (39.6% to 46.7%), n=747 | 45.9% (42.3% to 49.5%), n=747 | 34.5% (31.1% to 37.9%), n=747 | 44.4% (40.9% to 48.0%), n=747 |
| Win rate per appearance: colonizer (fair 33.3%) | 61.5% (58.0% to 65.0%), n=742 | 49.1% (45.5% to 52.7%), n=742 | 38.0% (34.5% to 41.5%), n=742 | 61.6% (58.1% to 65.1%), n=742 | 39.1% (35.6% to 42.6%), n=742 |
| Win rate per appearance: annexer (fair 33.3%) | 34.6% (31.2% to 38.1%), n=742 | 40.3% (36.8% to 43.8%), n=742 | 44.9% (41.3% to 48.5%), n=742 | 32.6% (29.2% to 36.0%), n=742 | 48.1% (44.5% to 51.7%), n=742 |
| ROADS (strategies at or above 75% of fair share) | 3 | 3 | 3 | 3 | 3 |
| SPREAD (highest minus lowest win rate) | 56.9% | 47.1% | 40.5% | 56.0% | 45.4% |
| C1 average rounds (SD) | 14.23 (2.96) | 11.02 (2.61) | 11.75 (3.03) | 14.21 (2.93) | 9.04 (2.88) |
| C4 last place at round 6 wins | 13.6%, n=981 | 7.7%, n=994 | 15.8%, n=992 | 12.6%, n=977 | 12.5%, n=879 |
| C5 leader change after round 5 | 83.7%, n=1000 | 76.6%, n=1000 | 84.3%, n=1000 | 82.3%, n=1000 | 69.1%, n=1000 |
| Leader at start of round 6 wins | 51.6% (48.2% to 55.0%), n=835 | 56.2% (52.8% to 59.5%), n=837 | 47.5% (44.2% to 50.7%), n=883 | 50.3% (46.9% to 53.7%), n=835 | 55.0% (51.5% to 58.5%), n=774 |
| Share of winning players by largest source: cities | 0.1% (-0.1% to 0.3%), n=1000 | 0.1% (-0.1% to 0.3%), n=1000 | 0.0% (0.0% to 0.0%), n=1000 | 0.0% (0.0% to 0.0%), n=1000 | 46.7% (43.6% to 49.8%), n=1000 |
| Share of winning players by largest source: region sets | 99.9% (99.7% to 100.1%), n=1000 | 81.2% (78.8% to 83.6%), n=1000 | 100.0% (100.0% to 100.0%), n=1000 | 99.9% (99.7% to 100.1%), n=1000 | 37.2% (34.2% to 40.2%), n=1000 |
| Share of winning players by largest source: largest empire | 0.0% (0.0% to 0.0%), n=1000 | 0.0% (0.0% to 0.0%), n=1000 | 0.0% (0.0% to 0.0%), n=1000 | 0.0% (0.0% to 0.0%), n=1000 | 0.0% (0.0% to 0.0%), n=1000 |
| Share of winning players by largest source: mixed (tie) | 0.0% (0.0% to 0.0%), n=1000 | 18.7% (16.3% to 21.1%), n=1000 | 0.0% (0.0% to 0.0%), n=1000 | 0.1% (-0.1% to 0.3%), n=1000 | 16.1% (13.8% to 18.4%), n=1000 |


Differences from baseline (same config):

| Metric | A city road minus baseline (95% CI) | B empire road minus baseline (95% CI) | C luck booms minus baseline (95% CI) | D combined minus baseline (95% CI) |
|---|---|---|---|---|
| Win rate: expander | -2.6 pts (-4.4 to -0.8) **SIGNIFICANT** | +0.9 pts (-1.3 to +3.1) not significant | +1.0 pts (-1.2 to +3.2) not significant | -1.8 pts (-3.7 to +0.0) not significant |
| Win rate: cityBuilder | +9.4 pts (+4.5 to +14.3) **SIGNIFICANT** | +12.2 pts (+7.3 to +17.1) **SIGNIFICANT** | +0.8 pts (-4.0 to +5.6) not significant | +10.7 pts (+5.8 to +15.6) **SIGNIFICANT** |
| Win rate: colonizer | -12.4 pts (-17.4 to -7.4) **SIGNIFICANT** | -23.5 pts (-28.4 to -18.5) **SIGNIFICANT** | +0.1 pts (-4.8 to +5.1) not significant | -22.4 pts (-27.3 to -17.4) **SIGNIFICANT** |
| Win rate: annexer | +5.7 pts (+0.7 to +10.6) **SIGNIFICANT** | +10.2 pts (+5.3 to +15.2) **SIGNIFICANT** | -2.0 pts (-6.8 to +2.8) not significant | +13.5 pts (+8.5 to +18.4) **SIGNIFICANT** |
| ROADS (count) | +0 (bootstrap 95% +0 to +0) not significant | +0 (bootstrap 95% +0 to +0) not significant | +0 (bootstrap 95% +0 to +0) not significant | +0 (bootstrap 95% +0 to +0) not significant |
| SPREAD | -9.8 pts (bootstrap 95% -15.0 to -4.5) **SIGNIFICANT** | -16.4 pts (bootstrap 95% -21.1 to -10.4) **SIGNIFICANT** | -0.9 pts (bootstrap 95% -6.4 to +4.8) not significant | -11.5 pts (bootstrap 95% -16.6 to -5.8) **SIGNIFICANT** |
| C1 average rounds | -3.21 rounds (-3.46 to -2.97) **SIGNIFICANT** | -2.48 rounds (-2.74 to -2.22) **SIGNIFICANT** | -0.02 rounds (-0.27 to +0.24) not significant | -5.19 rounds (-5.44 to -4.93) **SIGNIFICANT** |
| C4 last place at round 6 wins | -5.9 pts (-8.6 to -3.2) **SIGNIFICANT** | +2.2 pts (-0.9 to +5.3) not significant | -1.0 pts (-4.0 to +2.0) not significant | -1.0 pts (-4.1 to +2.0) not significant |
| C5 leader change after round 5 | -7.1 pts (-10.6 to -3.6) **SIGNIFICANT** | +0.6 pts (-2.6 to +3.8) not significant | -1.4 pts (-4.7 to +1.9) not significant | -14.6 pts (-18.3 to -10.9) **SIGNIFICANT** |
| Leader at start of round 6 wins | +4.5 pts (-0.2 to +9.3) not significant | -4.2 pts (-8.9 to +0.6) not significant | -1.3 pts (-6.1 to +3.5) not significant | +3.4 pts (-1.5 to +8.3) not significant |
| Share of winners by cities | +0.0 pts (-0.3 to +0.3) not significant | -0.1 pts (-0.3 to +0.1) not significant | -0.1 pts (-0.3 to +0.1) not significant | +46.6 pts (+43.5 to +49.7) **SIGNIFICANT** |
| Share of winners by region sets | -18.7 pts (-21.1 to -16.3) **SIGNIFICANT** | +0.1 pts (-0.1 to +0.3) not significant | +0.0 pts (-0.3 to +0.3) not significant | -62.7 pts (-65.7 to -59.7) **SIGNIFICANT** |
| Share of winners by largest empire | +0.0 pts (+0.0 to +0.0) not significant | +0.0 pts (+0.0 to +0.0) not significant | +0.0 pts (+0.0 to +0.0) not significant | +0.0 pts (+0.0 to +0.0) not significant |
| Share of winners by mixed (tie) | +18.7 pts (+16.3 to +21.1) **SIGNIFICANT** | +0.0 pts (+0.0 to +0.0) not significant | +0.1 pts (-0.1 to +0.3) not significant | +16.1 pts (+13.8 to +18.4) **SIGNIFICANT** |

### real-4p-pure

| Metric | Baseline | A city road | B empire road | C luck booms | D combined |
|---|---|---|---|---|---|
| Win rate per appearance: expander (fair 25.0%) | 1.6% (0.8% to 2.4%), n=1000 | 0.0% (0.0% to 0.0%), n=1000 | 1.5% (0.7% to 2.3%), n=1000 | 1.5% (0.7% to 2.3%), n=1000 | 0.4% (0.0% to 0.8%), n=1000 |
| Win rate per appearance: cityBuilder (fair 25.0%) | 21.3% (18.8% to 23.8%), n=1000 | 29.3% (26.5% to 32.1%), n=1000 | 39.4% (36.4% to 42.4%), n=1000 | 24.6% (21.9% to 27.3%), n=1000 | 35.6% (32.6% to 38.6%), n=1000 |
| Win rate per appearance: colonizer (fair 25.0%) | 56.7% (53.6% to 59.8%), n=1000 | 41.9% (38.8% to 45.0%), n=1000 | 28.5% (25.8% to 31.3%), n=1000 | 55.4% (52.3% to 58.5%), n=1000 | 29.4% (26.6% to 32.2%), n=1000 |
| Win rate per appearance: annexer (fair 25.0%) | 20.4% (17.9% to 22.9%), n=1000 | 28.8% (26.0% to 31.6%), n=1000 | 30.6% (27.7% to 33.4%), n=1000 | 18.5% (16.1% to 20.9%), n=1000 | 34.6% (31.7% to 37.5%), n=1000 |
| ROADS (strategies at or above 75% of fair share) | 3 | 3 | 3 | 2 | 3 |
| SPREAD (highest minus lowest win rate) | 55.1% | 41.9% | 37.9% | 53.9% | 35.2% |
| C1 average rounds (SD) | 13.85 (2.64) | 10.56 (2.21) | 11.24 (2.70) | 13.83 (2.62) | 8.64 (2.49) |
| C4 last place at round 6 wins | 3.8%, n=998 | 1.4%, n=999 | 6.2%, n=1000 | 4.1%, n=998 | 5.1%, n=890 |
| C5 leader change after round 5 | 87.8%, n=1000 | 81.7%, n=1000 | 88.9%, n=1000 | 86.8%, n=1000 | 74.3%, n=1000 |
| Leader at start of round 6 wins | 41.3% (37.8% to 44.7%), n=778 | 52.7% (49.2% to 56.2%), n=783 | 41.1% (37.8% to 44.4%), n=876 | 41.0% (37.6% to 44.5%), n=785 | 46.6% (43.1% to 50.2%), n=746 |
| Share of winning players by largest source: cities | 0.0% (0.0% to 0.0%), n=1000 | 0.0% (0.0% to 0.0%), n=1000 | 0.0% (0.0% to 0.0%), n=1001 | 0.0% (0.0% to 0.0%), n=1000 | 49.0% (45.9% to 52.1%), n=1000 |
| Share of winning players by largest source: region sets | 100.0% (100.0% to 100.0%), n=1000 | 80.6% (78.1% to 83.1%), n=1000 | 99.9% (99.7% to 100.1%), n=1001 | 100.0% (100.0% to 100.0%), n=1000 | 34.2% (31.3% to 37.1%), n=1000 |
| Share of winning players by largest source: largest empire | 0.0% (0.0% to 0.0%), n=1000 | 0.0% (0.0% to 0.0%), n=1000 | 0.0% (0.0% to 0.0%), n=1001 | 0.0% (0.0% to 0.0%), n=1000 | 0.0% (0.0% to 0.0%), n=1000 |
| Share of winning players by largest source: mixed (tie) | 0.0% (0.0% to 0.0%), n=1000 | 19.4% (16.9% to 21.9%), n=1000 | 0.1% (-0.1% to 0.3%), n=1001 | 0.0% (0.0% to 0.0%), n=1000 | 16.8% (14.5% to 19.1%), n=1000 |


Differences from baseline (same config):

| Metric | A city road minus baseline (95% CI) | B empire road minus baseline (95% CI) | C luck booms minus baseline (95% CI) | D combined minus baseline (95% CI) |
|---|---|---|---|---|
| Win rate: expander | -1.6 pts (-2.4 to -0.8) **SIGNIFICANT** | -0.1 pts (-1.2 to +1.0) not significant | -0.1 pts (-1.2 to +1.0) not significant | -1.2 pts (-2.1 to -0.3) **SIGNIFICANT** |
| Win rate: cityBuilder | +8.0 pts (+4.2 to +11.8) **SIGNIFICANT** | +18.1 pts (+14.1 to +22.1) **SIGNIFICANT** | +3.3 pts (-0.4 to +7.0) not significant | +14.3 pts (+10.4 to +18.2) **SIGNIFICANT** |
| Win rate: colonizer | -14.8 pts (-19.1 to -10.5) **SIGNIFICANT** | -28.1 pts (-32.3 to -24.0) **SIGNIFICANT** | -1.3 pts (-5.7 to +3.1) not significant | -27.3 pts (-31.5 to -23.1) **SIGNIFICANT** |
| Win rate: annexer | +8.4 pts (+4.6 to +12.2) **SIGNIFICANT** | +10.2 pts (+6.4 to +13.9) **SIGNIFICANT** | -1.9 pts (-5.4 to +1.6) not significant | +14.2 pts (+10.3 to +18.1) **SIGNIFICANT** |
| ROADS (count) | +0 (bootstrap 95% +0 to +1) not significant | +0 (bootstrap 95% +0 to +1) not significant | -1 (bootstrap 95% -1 to +1) not significant | +0 (bootstrap 95% +0 to +1) not significant |
| SPREAD | -13.2 pts (bootstrap 95% -17.6 to -8.9) **SIGNIFICANT** | -17.2 pts (bootstrap 95% -21.7 to -12.5) **SIGNIFICANT** | -1.2 pts (bootstrap 95% -5.9 to +3.4) not significant | -19.9 pts (bootstrap 95% -23.4 to -15.1) **SIGNIFICANT** |
| C1 average rounds | -3.29 rounds (-3.50 to -3.08) **SIGNIFICANT** | -2.61 rounds (-2.84 to -2.38) **SIGNIFICANT** | -0.03 rounds (-0.26 to +0.21) not significant | -5.21 rounds (-5.44 to -4.99) **SIGNIFICANT** |
| C4 last place at round 6 wins | -2.4 pts (-3.8 to -1.0) **SIGNIFICANT** | +2.4 pts (+0.5 to +4.3) **SIGNIFICANT** | +0.4 pts (-1.3 to +2.1) not significant | +1.4 pts (-0.5 to +3.2) not significant |
| C5 leader change after round 5 | -6.1 pts (-9.2 to -3.0) **SIGNIFICANT** | +1.1 pts (-1.7 to +3.9) not significant | -1.0 pts (-3.9 to +1.9) not significant | -13.5 pts (-16.9 to -10.1) **SIGNIFICANT** |
| Leader at start of round 6 wins | +11.5 pts (+6.6 to +16.4) **SIGNIFICANT** | -0.2 pts (-4.9 to +4.6) not significant | -0.2 pts (-5.1 to +4.6) not significant | +5.4 pts (+0.4 to +10.4) **SIGNIFICANT** |
| Share of winners by cities | +0.0 pts (+0.0 to +0.0) not significant | +0.0 pts (+0.0 to +0.0) not significant | +0.0 pts (+0.0 to +0.0) not significant | +49.0 pts (+45.9 to +52.1) **SIGNIFICANT** |
| Share of winners by region sets | -19.4 pts (-21.9 to -16.9) **SIGNIFICANT** | -0.1 pts (-0.3 to +0.1) not significant | +0.0 pts (+0.0 to +0.0) not significant | -65.8 pts (-68.7 to -62.9) **SIGNIFICANT** |
| Share of winners by largest empire | +0.0 pts (+0.0 to +0.0) not significant | +0.0 pts (+0.0 to +0.0) not significant | +0.0 pts (+0.0 to +0.0) not significant | +0.0 pts (+0.0 to +0.0) not significant |
| Share of winners by mixed (tie) | +19.4 pts (+16.9 to +21.9) **SIGNIFICANT** | +0.1 pts (-0.1 to +0.3) not significant | +0.0 pts (+0.0 to +0.0) not significant | +16.8 pts (+14.5 to +19.1) **SIGNIFICANT** |

### real-3p-mixed

| Metric | Baseline | A city road | B empire road | C luck booms | D combined |
|---|---|---|---|---|---|
| Win rate per appearance: mixed (fair 33.3%) | 33.3% (31.6% to 35.0%), n=3000 | 33.3% (31.6% to 35.0%), n=3000 | 33.3% (31.6% to 35.0%), n=3000 | 33.3% (31.6% to 35.0%), n=3000 | 33.3% (31.6% to 35.0%), n=3000 |
| ROADS (strategies at or above 75% of fair share) | 1 | 1 | 1 | 1 | 1 |
| SPREAD (highest minus lowest win rate) | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| C1 average rounds (SD) | 14.17 (3.12) | 10.42 (2.39) | 10.82 (2.73) | 14.19 (3.13) | 7.48 (1.97) |
| C4 last place at round 6 wins | 26.0%, n=989 | 21.6%, n=978 | 24.1%, n=998 | 26.8%, n=989 | 22.2%, n=880 |
| C5 leader change after round 5 | 95.5%, n=1000 | 94.4%, n=1000 | 96.7%, n=1000 | 95.4%, n=1000 | 84.8%, n=1000 |
| Leader at start of round 6 wins | 36.6% (33.4% to 39.8%), n=864 | 45.9% (42.6% to 49.3%), n=849 | 36.0% (32.9% to 39.1%), n=936 | 35.8% (32.6% to 39.0%), n=866 | 31.9% (28.7% to 35.1%), n=827 |
| Share of winning players by largest source: cities | 0.0% (0.0% to 0.0%), n=1001 | 0.0% (0.0% to 0.0%), n=1000 | 0.0% (0.0% to 0.0%), n=1000 | 0.0% (0.0% to 0.0%), n=1000 | 76.0% (73.4% to 78.6%), n=1000 |
| Share of winning players by largest source: region sets | 100.0% (100.0% to 100.0%), n=1001 | 71.2% (68.4% to 74.0%), n=1000 | 100.0% (100.0% to 100.0%), n=1000 | 100.0% (100.0% to 100.0%), n=1000 | 10.5% (8.6% to 12.4%), n=1000 |
| Share of winning players by largest source: largest empire | 0.0% (0.0% to 0.0%), n=1001 | 0.0% (0.0% to 0.0%), n=1000 | 0.0% (0.0% to 0.0%), n=1000 | 0.0% (0.0% to 0.0%), n=1000 | 0.0% (0.0% to 0.0%), n=1000 |
| Share of winning players by largest source: mixed (tie) | 0.0% (0.0% to 0.0%), n=1001 | 28.8% (26.0% to 31.6%), n=1000 | 0.0% (0.0% to 0.0%), n=1000 | 0.0% (0.0% to 0.0%), n=1000 | 13.5% (11.4% to 15.6%), n=1000 |


Differences from baseline (same config):

| Metric | A city road minus baseline (95% CI) | B empire road minus baseline (95% CI) | C luck booms minus baseline (95% CI) | D combined minus baseline (95% CI) |
|---|---|---|---|---|
| Win rate: mixed | +0.0 pts (-2.4 to +2.4) not significant | +0.0 pts (-2.4 to +2.4) not significant | +0.0 pts (-2.4 to +2.4) not significant | +0.0 pts (-2.4 to +2.4) not significant |
| ROADS (count) | +0 (bootstrap 95% +0 to +0) not significant | +0 (bootstrap 95% +0 to +0) not significant | +0 (bootstrap 95% +0 to +0) not significant | +0 (bootstrap 95% +0 to +0) not significant |
| SPREAD | +0.0 pts (bootstrap 95% +0.0 to +0.0) not significant | +0.0 pts (bootstrap 95% +0.0 to +0.0) not significant | +0.0 pts (bootstrap 95% +0.0 to +0.0) not significant | +0.0 pts (bootstrap 95% +0.0 to +0.0) not significant |
| C1 average rounds | -3.76 rounds (-4.00 to -3.51) **SIGNIFICANT** | -3.35 rounds (-3.60 to -3.09) **SIGNIFICANT** | +0.02 rounds (-0.25 to +0.30) not significant | -6.69 rounds (-6.92 to -6.46) **SIGNIFICANT** |
| C4 last place at round 6 wins | -4.4 pts (-8.1 to -0.6) **SIGNIFICANT** | -1.9 pts (-5.7 to +1.9) not significant | +0.8 pts (-3.1 to +4.7) not significant | -3.9 pts (-7.7 to +0.0) not significant |
| C5 leader change after round 5 | -1.1 pts (-3.0 to +0.8) not significant | +1.2 pts (-0.5 to +2.9) not significant | -0.1 pts (-1.9 to +1.7) not significant | -10.7 pts (-13.3 to -8.1) **SIGNIFICANT** |
| Leader at start of round 6 wins | +9.4 pts (+4.7 to +14.0) **SIGNIFICANT** | -0.6 pts (-5.0 to +3.9) not significant | -0.8 pts (-5.3 to +3.8) not significant | -4.7 pts (-9.2 to -0.1) **SIGNIFICANT** |
| Share of winners by cities | +0.0 pts (+0.0 to +0.0) not significant | +0.0 pts (+0.0 to +0.0) not significant | +0.0 pts (+0.0 to +0.0) not significant | +76.0 pts (+73.4 to +78.6) **SIGNIFICANT** |
| Share of winners by region sets | -28.8 pts (-31.6 to -26.0) **SIGNIFICANT** | +0.0 pts (+0.0 to +0.0) not significant | +0.0 pts (+0.0 to +0.0) not significant | -89.5 pts (-91.4 to -87.6) **SIGNIFICANT** |
| Share of winners by largest empire | +0.0 pts (+0.0 to +0.0) not significant | +0.0 pts (+0.0 to +0.0) not significant | +0.0 pts (+0.0 to +0.0) not significant | +0.0 pts (+0.0 to +0.0) not significant |
| Share of winners by mixed (tie) | +28.8 pts (+26.0 to +31.6) **SIGNIFICANT** | +0.0 pts (+0.0 to +0.0) not significant | +0.0 pts (+0.0 to +0.0) not significant | +13.5 pts (+11.4 to +15.6) **SIGNIFICANT** |

In `real-3p-mixed` every seat plays the mixed strategy, so the per-strategy rows are one row, and ROADS and SPREAD carry no information.

## Step 4: extra runs (winPoints 16)

Step 4 applied because arms A, B and D gave a SIGNIFICANT drop in SPREAD on `real-3p-pure` while average rounds fell below 12 (11.02, 11.75 and 9.04). We ran A, B and D once more with `winPoints` 16, the largest value that the tuning range allows (+2 from 14). We also ran the baseline at 16 as a control, so each arm can be compared with a baseline at the same `winPoints`. That makes four extra runs, the cap. Each run used 1,000 games and seed base 0 on `real-3p-pure`.

| Arm | winPoints | ROADS | SPREAD | C1 rounds | C4 | C5 | Leader holds | colonizer | cityBuilder | annexer | expander |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Baseline | 14 | 3 | 56.9% | 14.23 | 13.6% | 83.7% | 51.6% | 61.5% | 33.7% | 34.6% | 4.6% |
| Baseline | 16 | 3 | 58.4% | 16.99 | 16.1% | 87.6% | 47.8% | 63.3% | 34.3% | 31.8% | 4.9% |
| A city road | 14 | 3 | 47.1% | 11.02 | 7.7% | 76.6% | 56.2% | 49.1% | 43.1% | 40.3% | 2.0% |
| A city road | 16 | 3 | 63.0% | 14.18 | 8.6% | 82.0% | 54.3% | 65.5% | 32.9% | 33.6% | 2.5% |
| B empire road | 14 | 3 | 40.5% | 11.75 | 15.8% | 84.3% | 47.5% | 38.0% | 45.9% | 44.9% | 5.5% |
| B empire road | 16 | 3 | 42.1% | 14.72 | 18.6% | 87.8% | 43.7% | 47.6% | 39.1% | 42.2% | 5.5% |
| D combined | 14 | 3 | 45.4% | 9.04 | 12.5% | 69.1% | 55.0% | 39.1% | 44.4% | 48.1% | 2.7% |
| D combined | 16 | 3 | 44.0% | 12.00 FAIL | 10.5% | 81.0% | 52.7% | 42.5% | 46.5% | 43.0% | 2.5% |

Differences at winPoints 16, against the winPoints 16 baseline control (95% CI; SIGNIFICANT when the interval excludes 0):

| Arm | C1 rounds diff | SPREAD diff (bootstrap) | ROADS diff (bootstrap) | C4 diff | C5 diff |
|---|---|---|---|---|---|
| A city road | -2.81 (-3.04 to -2.58) SIGNIFICANT | +4.6 pts (-0.6 to +9.7) not significant | +0 (+0 to +0) not significant | -7.4 pts (-10.3 to -4.5) SIGNIFICANT | -5.6 pts (-8.7 to -2.5) SIGNIFICANT |
| B empire road | -2.27 (-2.52 to -2.02) SIGNIFICANT | -16.3 pts (-21.5 to -10.7) SIGNIFICANT | +0 (+0 to +0) not significant | +2.5 pts (-0.8 to +5.9) not significant | +0.2 pts (-2.7 to +3.1) not significant |
| D combined | -4.99 (-5.23 to -4.75) SIGNIFICANT | -14.4 pts (-19.0 to -9.0) SIGNIFICANT | +0 (+0 to +0) not significant | -5.5 pts (-8.5 to -2.5) SIGNIFICANT | -6.6 pts (-9.8 to -3.4) SIGNIFICANT |

Reading the table: the arm-at-14 and arm-at-16 rows are both shown. The difference column compares each arm at 16 with the baseline at 16.

## Many-roads measures

Computed from the per-strategy win rates and win counts in each run's report. The city-building strategies are cityBuilder, colonizer and annexer.

- Max-min: the highest minus the lowest win rate among the three, in points.
- Within 10: how many of the three are within 10 points of the top (the top counts).
- Effective number: 1 divided by the sum of squared shares of their wins. Three equal winners give 3. One winner gives 1.

| Players | Measure | Baseline | A city road | B empire road | C luck booms | D combined |
|---|---|---|---|---|---|---|
| 3 | Max-min (pts) | 27.7 | 8.8 | 7.9 | 29.0 | 9.0 |
| 3 | Within 10 (of 3) | 1 | 3 | 3 | 1 | 3 |
| 3 | Effective number | 2.76 | 2.98 | 2.98 | 2.74 | 2.98 |
| 4 | Max-min (pts) | 36.3 | 13.1 | 10.9 | 36.9 | 6.2 |
| 4 | Within 10 (of 3) | 1 | 1 | 2 | 1 | 3 |
| 4 | Effective number | 2.37 | 2.90 | 2.94 | 2.42 | 2.98 |

ROADS cannot exceed 3 at 3 players. The expander would need a 25% win rate per appearance to count, and its highest rate is 5.6% (arm C). The baseline 3-player max-min is 27.7 from unrounded rates. The rounded table gives 27.8.

## Gate results from the simulator

Read from the checks table in each run's report. The gated checks are C1 (12 to 16 rounds; reported only at 4 players), C2 (top strategy at 40% or less), C3 (worst seat deviation of 5 points or less), C4 (15% or more) and C5 (95% or more). C2 is not checked in `real-3p-mixed`. A config passes only when every gated check passes.

| Config | Arm | Gate | Failed checks |
|---|---|---|---|
| real-3p-pure | Baseline | FAIL | C2, C4, C5 |
| real-3p-pure | A city road | FAIL | C1, C2, C4, C5 |
| real-3p-pure | B empire road | FAIL | C1, C2, C5 |
| real-3p-pure | C luck booms | FAIL | C2, C4, C5 |
| real-3p-pure | D combined | FAIL | C1, C2, C4, C5 |
| real-4p-pure | Baseline | FAIL | C2, C4, C5 |
| real-4p-pure | A city road | FAIL | C2, C4, C5 |
| real-4p-pure | B empire road | FAIL | C4, C5 |
| real-4p-pure | C luck booms | FAIL | C2, C4, C5 |
| real-4p-pure | D combined | FAIL | C4, C5 |
| real-3p-mixed | Baseline | FAIL | C3 |
| real-3p-mixed | A city road | FAIL | C1, C5 |
| real-3p-mixed | B empire road | FAIL | C1 |
| real-3p-mixed | C luck booms | PASS | none |
| real-3p-mixed | D combined | FAIL | C1, C5 |
| real-3p-pure, winPoints 16 | Baseline | FAIL | C1, C2, C5 |
| real-3p-pure, winPoints 16 | A city road | FAIL | C2, C4, C5 |
| real-3p-pure, winPoints 16 | B empire road | FAIL | C2, C5 |
| real-3p-pure, winPoints 16 | D combined | FAIL | C1, C2, C4, C5 |

C2 cannot pass at 3 players with these bots. The expander builds no cities, so the other three strategies win most games. Pooled, they win about 43% of their seats in arm C, where the expander wins the most games (4.3% of games, 43 of 1,000). C2 needs 40% or less, so the expander would need to win about 11% of games. No arm comes close.

## Findings

- At 3 players, ROADS is 3 in every arm: cityBuilder, colonizer and annexer each clear the 25% line. At 4 players, arm C drops the annexer to 18.5%, just under the 18.75% line, so ROADS is 2 there. That change is not SIGNIFICANT.
- Arms A, B and D cut SPREAD significantly at 3 and 4 players, mostly by lowering the colonizer and raising cityBuilder and annexer. Arm C does not change SPREAD in a way the intervals can separate from zero.
- The same arms A, B and D shorten games. At 3 players their average rounds are 11.02, 11.75 and 9.04, below the 12 to 16 band. The baseline is 14.23 and arm C is 14.21.
- Arm C (bigger booms): no outcome effect detectable at about +/-5 points. Win rates, C1, C4 and C5 all include 0 at 3 players, at 4 players and in mixed play. Arm C does change the economy: boom income at round 6 rises from 5.8% to 14.4% of income, but leaders get as much as trailing players (1.67 against 1.58 per round under C). The saved outputs store total income only, so these two income figures could not be reproduced from them.
- Arm A (city cap 6) moves wins from the colonizer (-12.4 points) to cityBuilder (+9.4) and annexer (+5.7) at 3 players. The comeback drop is shown by C4, which falls 5.9 points (SIGNIFICANT). C5 also falls 7.1 points (SIGNIFICANT), but part of that comes from games being shorter.
- Arm B (largest empire 4) cuts the colonizer most (-23.5 points at 3 players) and does not lower comebacks. C4 is +2.2 points at 3 players (not significant) and +2.4 points at 4 players (SIGNIFICANT). The largest empire title's share of winners' points rises from 7.0% to 20.9%, and the share of winners holding the title rises from 51.2% to 78.0%. Region sets remain every 3-player winner's largest source, so arm B rebalances which strategy wins rather than adding a new route.
- Arm D has the largest effect on length and leader changes. At 3 players C5 falls from 83.7% to 69.1%. In mixed play C5 falls from 95.5%, which just passes the 95% line, to 84.8%. Cities become the largest source for 46.7% of winners at 3 players, where region sets are the largest source for 37.2%. By points won by winners, region sets (41.6%) still lead cities (39.2%) in arm D, though cities are the largest single source for 46.7% of winners.
- At winPoints 16 (step 4), arm B keeps its SPREAD gain (42.1% against 58.4% for the control, SIGNIFICANT) at 14.72 rounds, inside the band. Arm A's SPREAD gain goes away and reverses: 63.0% against the control's 58.4%, +4.6 points, not significant. Arm D keeps its SPREAD gain (44.0%, SIGNIFICANT) but reaches only 11.997 rounds, which FAILS the 12 to 16 band. The +2 step also lengthens the baseline control to 16.99 rounds, so winPoints 16 is not a neutral setting.

## Caveats

- Bots are not people. The win rates describe the bots, not human play. The playtest in plan step 5 is the real test of fun.
- The colonizer is the only bot that deliberately completes regions. Bot skill may still drive some results, especially the colonizer's share.
- One seed set (seed base 0) was used for every arm. The results hold for these 1,000 seeds. They were not checked on other seeds.
- The intervals for differences treat the arms as independent, which is conservative. Paired half-widths are given in the pairing section above.
- Per-strategy rows describe seat appearances, not players. A strategy that fills more seats has more appearances.
- Largest empire is compared as a whole category against region sets and cities. In these games its points were never a winner's largest single source, even at 4 points. Region sets add up to more.
- Only one extra winPoints value (16) was tried in step 4. A value of 15 was not tested.
- Only the real map was run. The mini maps were not part of this experiment.
- The gate thresholds (C1 from 12 to 16, C4 of 15% or more, C5 of 95% or more) are the ones in the existing gate. This file reports the numbers against them. It does not judge the rules.

## How to reproduce

Run from the worktree root, `/home/user/wt-empire2`, after the config change in this commit. Rules files are in `/home/user/e2e-reports/empire2-roads/rules/`. Their contents:

```
baseline.json:      {"colonizeCost": 6, "winPoints": 14, "underdogIncome": 3, "underdogGap": 1}
A-city-road.json:   {"colonizeCost": 6, "winPoints": 14, "underdogIncome": 3, "underdogGap": 1, "maxCities": 6}
B-empire-road.json: {"colonizeCost": 6, "winPoints": 14, "underdogIncome": 3, "underdogGap": 1, "largestEmpirePoints": 4}
C-luck-booms.json:  {"colonizeCost": 6, "winPoints": 14, "underdogIncome": 3, "underdogGap": 1, "boomRegionCount": 5, "boomIncome": 2, "boomCityIncome": 3}
D-combined.json:    {"colonizeCost": 6, "winPoints": 14, "underdogIncome": 3, "underdogGap": 1, "maxCities": 6, "largestEmpirePoints": 4, "boomRegionCount": 5, "boomIncome": 2, "boomCityIncome": 3}
```

The step 4 files in `/home/user/e2e-reports/empire2-roads/rules-wp16/` are the same, with `"winPoints": 16`.

Main runs (15), each `<arm>` in baseline, A-city-road, B-empire-road, C-luck-booms, D-combined and each `<config>` in real-3p-pure, real-4p-pure, real-3p-mixed:

```bash
cd /home/user/wt-empire2
node --import tsx scripts/empire2-sim/run.ts --config <config> --games 1000 --seed-base 0 \
  --rules /home/user/e2e-reports/empire2-roads/rules/<arm>.json \
  --out /home/user/e2e-reports/empire2-roads/<arm>/<config>
```

Exit code 1 is normal here. It means a gate failed. Exit code 2 means a rules file is invalid.

Step 4 runs (4), on `real-3p-pure`, with the files in `rules-wp16/` (`baseline`, `A-city-road`, `B-empire-road`, `D-combined`) and `--out /home/user/e2e-reports/empire2-roads/wp16-<arm>/real-3p-pure`.

Analysis (outside the repo):

```bash
cd /home/user/e2e-reports/empire2-roads
python3 analyse.py        # writes analysis/tables-<config>.md and analysis/summary.json
python3 analyse-extra.py  # writes analysis/extra-wp16.md
```
