# Empire 2.0: plan after the phase 2 stop

Owner-approved on 2026-11-19. Builds and reviews are done by subagents; the orchestrator does not write code.

## Why we stopped
The phase 2 bot simulation (2,000 games per setup) found that, with the design's rules: 3-player games end in about 4 rounds (target 12 to 16); the colonizer strategy wins 45 to 60% (cap 40%); the middle seat wins most 3-player mixed games; annexes are rare. Tuning the numbers alone did not fix it. See phase2-gate-report.md and phase2-tuning-log.md.

## Principles
1. Measure before changing rules: a 2,000-game run takes under a minute.
2. Change one thing at a time.
3. Borrow proven designs: Catan snakes only the setup and plays clockwise after; Power Grid lets the leader go last; Puerto Rico rotates the first player; Catan scores buildings and titles, not land held.
4. Simpler rules win ties.
5. Bots tune the numbers; people decide whether it is fun.

## Steps
0. Save the baseline: commit the phase 2 simulator, the tuning log and a STOP gate report.
1. Check the simulator: an independent review of bots and metrics, with known-answer checks (seat-neutral rules must give equal seat win rates for identical bots; simulator games must match the engine; gate metrics recomputed by hand; no strategy wins through a bot bug). Fix any bug and re-run the baseline.
2. Compare candidate rules side by side, added as engine options with the current rule as the default:
   - Turn order: snake every round (current); Catan (snake setup only, then clockwise, no back-to-back rule); rotating first player; leader goes last.
   - When a win counts: end of your own turn, or end of the round.
   - Territory: points and income (current), or income only.
   - Expand cap: 3 (current) or 2.
   - Explorer: 4 continents (current) or 5.
   - Cheap colonize: every stuck turn (current) or once a game.
   Order: turn order first (seat balance); then territory and expand cap (game length); then explorer and cheap colonize (strategy balance). Report each option against the five gates at 3 and 4 players.
3. Owner decision: pick the rule set from the comparison.
4. Build the chosen rules: update design.md and the engine with tests, re-tune numbers, validate on fresh seeds, write a gate report. If a gate still fails, stop and ask the owner.
5. Phase 3 playtest (needs people): a bare-bones playable screen reusing the turn-based room, sync, logging and map code. Questions: is it fun; real game length; do people understand the rules; does annexing happen and feel fair. If it is not fun, stop.
6. README phases 4 to 6 (server, screens, polish, second playtest), then Empire 2.0 replaces Empire 1.

## Risks
- A simulator bug misleads us: step 1 comes first.
- Bots are not people: the playtest and the game logs.
- Fixes add complexity: the simplest-rule tie-break.
- No option meets every gate: accept a documented miss rather than add rules.
