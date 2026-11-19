# Empire 2.0 phase 2: gate report (STOPPED)

Date: 2026-11-19
Status: STOP (rules decision needed by the owner)

## Summary

The gate was not passed with the design's rules. We tried to tune the numbers inside their allowed ranges. That did not reach the targets. Games end far too fast, the colonizer strategy wins too often, and seat balance fails in 3-player mixed games. Fixing these needs rule changes, not number changes. This is a STOP. The owner must decide which rules to change. The plan of record is in `plan.md`.

## Gate checks

Baseline values are from the design values (rows 1 to 3 of `phase2-tuning-log.md`, seed base 0, 2,000 games per config).

| Check | Pass rule | real-3p-pure | real-4p-pure | real-3p-mixed |
|---|---|---|---|---|
| C1 average game length | 12 to 16 rounds | 4.22 FAIL | 4.15 (reported only, not gated) | 4.92 FAIL |
| C2 top strategy win rate | 40% or less | 44.8% FAIL (colonizer) | 41.4% FAIL (cityBuilder) | n/a (all seats play mixed) |
| C3 seat win rate deviation | 5 points or less | 27.9 pts FAIL | 19.9 pts FAIL | 62.1 pts FAIL |
| C4 last place at round 6 wins | 15% or more | 38.2% PASS | 11.3% FAIL | 50.0% PASS |
| C5 leader change after round 5 | 95% or more | 2.0% FAIL | 0.5% FAIL | 0.1% FAIL |
| Gate result | all applicable checks | FAIL (C1 C2 C3 C5) | FAIL (C2 C3 C4 C5) | FAIL (C1 C3 C5) |

The C4 and C5 columns are the share of games or observations that meet the rule. C3 is the largest seat deviation from an even split, in points.

## Best result by tuning (C1)

Tuning moved one constant at a time, inside its allowed range. The best C1 result from rows 14 to 17 is 7.57 rounds (row 16: `countriesPerTerritory` 4 to 5, real-3p-pure). This is the last-resort change, and it also changes points and income. It still falls well short of the 12 to 16 band. Row 14 (`winPoints` 16, the top of its range) reached 6.76 rounds.

## Findings for the owner

- Games end far too fast. With the design values, 3-player games last about 4.2 rounds (target 12 to 16). At `winPoints` 16 they last about 6.8 rounds. With `countriesPerTerritory` 5 they last about 7.6 rounds.
- The colonizer strategy wins 45 to 60% of 3-player pure games. The cap is 40%.
- Seat balance fails. In 3-player mixed games the middle seat wins most games.
- Annexes are rare. There are about 0.6 annexes per game at 3 players.

## Caveat

This simulator has NOT been independently reviewed. The numbers in this report must be confirmed by the planned review before any rule decision. The C4 result for the mixed config rests on a small number of games that reach round 6, so treat it with care.

## How to reproduce

Run one configuration with the seed base 0 (the default):

```
node --import tsx scripts/empire2-sim/run.ts --config real-3p-pure --seed-base 0
```

The other gate configs are `real-4p-pure` and `real-3p-mixed`. Output goes to `scripts/empire2-sim/out/`, which is not committed. The bot code is in `scripts/empire2-sim/bots.ts` and the checks are in `scripts/empire2-sim/report.ts`.
