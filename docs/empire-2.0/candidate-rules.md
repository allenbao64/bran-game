# Empire 2.0: candidate rules (provisional)

Date: 2026-11-20
Status: the owner's provisional working rules. They are not the default yet.

## The values

The file `scripts/empire2-sim/rules-candidate.json` sets:

```json
{"colonizeCost": 6, "winPoints": 16, "underdogIncome": 3, "underdogGap": 1, "largestEmpirePoints": 4}
```

These values sit on top of `EMPIRE2_PLAY_RULES`, the simulator's default base (`run.ts --base play`).

## Why

- `largestEmpirePoints` 4: in `roads-and-luck-experiment.md`, this value balanced the three city-building strategies (cityBuilder, colonizer and annexer) and did not lower comebacks. Before, the colonizer won far more often than the other two.
- `winPoints` 16: with the largest empire at 4, `winPoints` 16 brought games back to about 14.7 rounds. That is inside the 12 to 16 round band. At `winPoints` 14 the same rule gave 11.75 rounds, below the band.
- `colonizeCost` 6, `underdogIncome` 3 and `underdogGap` 1: these are carried over unchanged from the baseline in the roads experiment.

## What this does not change

`EMPIRE2_PLAY_RULES` in `lib/empire2/rules.ts` is not changed yet. The candidate values are used only when the simulator is given the rules file. The engine and the bots are unchanged.

The underdog income tests on this base are in `underdog-experiment.md`.
