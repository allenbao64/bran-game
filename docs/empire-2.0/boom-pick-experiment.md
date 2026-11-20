# Empire 2.0: underdog picks a boom (experiment, with and without bigger booms)

Date: 2026-11-20
Commit: 80d10a4 (the merge of feat/empire2-boom-pick into feat/empire2-engine; the rule is off by default, so the base rules are unchanged)

## The rule

At the start of each round, the player with the fewest victory points at the round start picks one region to boom, and the other booms are drawn at random from the remaining regions; ties go to the tied player who comes first in that round's turn order.
If the picker does not choose within the turn timer, the engine picks for them: the region that pays them most, then the region where they own the most countries, then the alphabetically first region, or, when no region pays anything, the alphabetically first region that borders their empire.

## Design

- Base rules (the owner's candidate): colonizeCost 6, winPoints 16, underdogIncome 3, underdogGap 1, largestEmpirePoints 4.
- P0: base. P1: base plus underdogBoomPick. P2: base plus underdogBoomPick, boomRegionCount 5, boomIncome 2, boomCityIncome 3. P3: base plus the bigger booms only (no pick), which separates the two effects.
- Configs real-3p-pure, real-4p-pure and real-3p-mixed; 1,000 games each; seed base 0, so every arm plays the same seeds and the same lineups.
- Pre-registered success criterion, fixed before any run. An arm succeeds on real-3p-pure against P0 if all three hold:
  1. C4 (last place at round 6 wins) rises at least 5 points, with a paired 95% interval above 0;
  2. C1 (average game length in rounds) stays between 12 and 16;
  3. the city-building max-min win-rate gap is not more than 5 points above P0's.
- Method (analyse.py): Wilson 95% intervals for single proportions; paired intervals over games for differences against P0; a paired bootstrap (2,000 resamples) for the max-min gap, the within-10 count and the effective number.

## real-3p-pure (P0 is the base)

Each arm cell shows the value and, in brackets, the difference from P0 with its paired 95% interval. "Sig" marks an interval that excludes 0.

| Measure | P0 base | P1 pick | P2 pick + bigger booms | P3 bigger booms |
|---|---|---|---|---|
| Win rate per appearance: expander (fair 33.3%) | 5.5% | 6.2% (+0.8; -1.2 to +2.8) | 5.3% (-0.1; -2.1 to +1.9) | 6.2% (+0.8; -0.6 to +2.1) |
| Win rate per appearance: cityBuilder | 39.1% | 40.7% (+1.6; -2.5 to +5.7) | 43.2% (+4.1; +0.1 to +8.2, sig) | 42.4% (+3.3; +0.8 to +5.9, sig) |
| Win rate per appearance: colonizer | 47.6% | 48.9% (+1.3; -2.5 to +5.2) | 48.0% (+0.4; -3.5 to +4.3) | 44.5% (-3.1; -5.9 to -0.3, sig) |
| Win rate per appearance: annexer | 42.2% | 38.4% (-3.8; -7.7 to +0.2) | 37.7% (-4.4; -8.4 to -0.5, sig) | 41.1% (-1.1; -3.9 to +1.7) |
| City-building max minus min win rate | 8.5 pts | 10.5 (+2.0; -4.2 to +8.2) | 10.2 (+1.8; -5.7 to +8.1) | 3.4 (-5.1; -9.3 to +1.6) |
| City-building strategies within 10 pts of the top (of 3) | 3 | 2 | 2 | 3 |
| City-building effective number | 2.98 | 2.97 (-0.01; -0.05 to +0.02) | 2.97 (-0.01; -0.05 to +0.03) | 3.00 (+0.02; -0.01 to +0.05) |
| C1 average rounds | 14.72 | 14.74 (+0.02; -0.20 to +0.23) | 14.71 (-0.01; -0.22 to +0.20) | 14.64 (-0.08; -0.21 to +0.05) |
| C4 last place at round 6 wins | 18.6% | 18.1% (-0.7; -3.5 to +2.2) | 16.4% (-2.3; -5.1 to +0.5) | 17.4% (-1.2; -3.0 to +0.6) |
| C5 leader change after round 5 | 87.8% | 87.2% (-0.6; -3.1 to +1.9) | 88.2% (+0.4; -2.0 to +2.8) | 86.0% (-1.8; -3.4 to -0.2, sig) |
| Leader at start of round 6 wins | 43.7% | 40.9% (-2.5; -6.7 to +1.7) | 40.6% (-2.2; -6.3 to +2.0) | 45.2% (+1.4; -1.3 to +4.0) |
| Games ending before round 6 | 0 | 0 | 0 | 0 |
| Gate (report; C2 and C5 fail in every arm) | FAIL | FAIL | FAIL | FAIL |

Criterion, real-3p-pure against P0:

| Arm | C4 up 5 pts, paired interval above 0 | C1 in 12 to 16 | Max-min not more than 5 pts above P0 | Result |
|---|---|---|---|---|
| P1 pick | no (-0.7; -3.5 to +2.2) | yes (14.74) | yes (+2.0) | FAIL |
| P2 pick + bigger booms | no (-2.3; -5.1 to +0.5) | yes (14.71) | yes (+1.8) | FAIL |
| P3 bigger booms | no (-1.2; -3.0 to +0.6) | yes (14.64) | yes (-5.1) | FAIL |

## real-4p-pure (secondary)

| Measure | P0 base | P1 pick | P2 pick + bigger booms | P3 bigger booms |
|---|---|---|---|---|
| Win rate per appearance: expander (fair 25.0%) | 3.0% | 2.4% (-0.6; -1.8 to +0.6) | 2.2% (-0.8; -2.0 to +0.4) | 2.0% (-1.0; -1.9 to -0.1, sig) |
| Win rate per appearance: cityBuilder | 29.3% | 27.5% (-1.8; -5.0 to +1.3) | 26.8% (-2.5; -5.6 to +0.6) | 31.2% (+1.9; -0.3 to +4.1) |
| Win rate per appearance: colonizer | 41.8% | 47.0% (+5.2; +1.8 to +8.7, sig) | 45.0% (+3.2; -0.1 to +6.6) | 40.7% (-1.1; -3.7 to +1.6) |
| Win rate per appearance: annexer | 25.9% | 23.2% (-2.8; -5.9 to +0.3) | 26.0% (+0.1; -3.0 to +3.1) | 26.1% (+0.1; -2.2 to +2.5) |
| City-building max minus min win rate | 15.8 pts | 23.8 (+8.1; +2.3 to +13.4, sig) | 19.0 (+3.2; -1.6 to +9.3) | 14.6 (-1.2; -5.8 to +3.3) |
| City-building strategies within 10 pts of the top (of 3) | 1 | 1 | 1 | 2 |
| City-building effective number | 2.87 | 2.72 (-0.15; -0.25 to -0.04, sig) | 2.80 (-0.08; -0.17 to +0.01) | 2.90 (+0.03; -0.04 to +0.10) |
| C1 average rounds | 14.54 | 14.76 (+0.22; -0.01 to +0.45) | 14.56 (+0.02; -0.21 to +0.26) | 14.46 (-0.08; -0.23 to +0.08) |
| C4 last place at round 6 wins | 7.3% | 6.4% (-0.9; -2.7 to +0.8) | 6.6% (-0.8; -2.6 to +1.1) | 6.6% (-0.7; -2.0 to +0.6) |
| C5 leader change after round 5 | 92.4% | 92.8% (+0.4; -1.6 to +2.4) | 92.0% (-0.4; -2.5 to +1.7) | 92.1% (-0.3; -1.8 to +1.2) |
| Leader at start of round 6 wins | 34.7% | 34.8% (-0.9; -5.2 to +3.3) | 34.3% (-1.2; -5.4 to +3.0) | 34.2% (-0.8; -3.7 to +2.0) |
| Gate (report; C2, C4 and C5 fail in every arm) | FAIL | FAIL | FAIL | FAIL |

Note: the report text prints 6.5% for P2's C4 in this config (exact value 6.55%); the analysis table rounds the same value to 6.6%.

## real-3p-mixed (secondary)

Only one strategy (mixed) plays in this config, so there are no per-strategy or city-building spread measures.

| Measure | P0 base | P1 pick | P2 pick + bigger booms | P3 bigger booms |
|---|---|---|---|---|
| C1 average rounds | 14.18 | 14.32 (+0.14; -0.11 to +0.39) | 14.31 (+0.13; -0.12 to +0.38) | 14.18 (-0.00; -0.03 to +0.02) |
| C4 last place at round 6 wins | 27.5% | 27.6% (+0.2; -3.2 to +3.5) | 27.5% (+0.0; -3.4 to +3.4) | 27.6% (+0.1; -0.2 to +0.4) |
| C5 leader change after round 5 | 97.1% | 97.5% (+0.4; -0.7 to +1.5) | 97.5% (+0.4; -0.7 to +1.5) | 97.1% (+0.0; +0.0 to +0.0) |
| Leader at start of round 6 wins | 34.9% | 34.9% (-0.2; -4.4 to +3.9) | 35.0% (-0.1; -4.2 to +4.0) | 35.4% (+0.4; +0.0 to +0.8, sig at the edge) |
| Games ending before round 6 | 0 | 0 | 0 | 0 |
| Gate (report) | PASS | PASS | PASS | PASS |

## Findings

1. On real-3p-pure no arm meets the criterion. C4 moves by -0.7 to -2.3 points, against a needed rise of 5, and no interval reaches +5 (the highest upper bound is +2.2 for P1). Base C4 is 18.6%.
2. The pick rule alone (P1) leaves 3p-pure almost unchanged but moves 4p: the colonizer win rate rises 5.2 points (paired +1.8 to +8.7), the city-building max-min gap widens from 15.8 to 23.8 points, and the effective number falls by 0.15. C4 in 4p stays at 6.4% to 7.3% in every arm, so it still fails the gate.
3. Bigger random booms with the pick (P2) on 3p-pure raise cityBuilder by 4.1 points and lower annexer by 4.4 points (both significant). Colonizer and C4 do not move significantly.
4. Bigger booms without the pick (P3) on 3p-pure narrow the city-building gap from 8.5 to 3.4 points, but that change is not significant (interval -9.3 to +1.6). Colonizer falls 3.1 points and leader change after round 5 falls 1.8 points (both significant, small).
5. Game length (C1) is unchanged in every arm and config: all differences are within about 0.25 rounds and none is significant. No game ended before round 6 in any run.
6. In real-3p-mixed, no arm changes C4 or C5 beyond noise, and all four arms pass the gate. The leader-at-round-6 difference for P3 (+0.4 points, lower bound 0.0) sits on the edge of significance and is not a finding to act on.

## Picker statistics (not available)

The records do not store which player picked or which region they picked (each round holds only income, bounties, action counts and round-start victory points), so the picker's strategy and whether the picker went on to win are not reported. Adding those fields to the records would be needed to answer that question.

## Reproduce

Check out commit 80d10a4 in the engine worktree. The four rules files are JSON objects with these contents (the base is the first line):

- P0: `{"colonizeCost": 6, "winPoints": 16, "underdogIncome": 3, "underdogGap": 1, "largestEmpirePoints": 4}`
- P1: the base plus `"underdogBoomPick": true`
- P2: the base plus `"underdogBoomPick": true, "boomRegionCount": 5, "boomIncome": 2, "boomCityIncome": 3`
- P3: the base plus `"boomRegionCount": 5, "boomIncome": 2, "boomCityIncome": 3`

For each arm and config run:

`node --import tsx scripts/empire2-sim/run.ts --config <real-3p-pure|real-4p-pure|real-3p-mixed> --games 1000 --seed-base 0 --rules <arm>.json --out <dir>`

Exit code 1 means a gate check failed (expected here); 2 means a bad rules file; 3 means a bug. The analysis script (the copy used for these tables is kept outside the repository) reads the records and reports from each arm's output folder and is run with `python3 -I analyse.py`.
