# Empire 2.0: instructions and context

Status: **design only. Nothing is built.** This folder holds the gameplay design and how to build it later.

## Files

- [design.md](design.md): the full gameplay design, rules, numbers, audit and build plan.
- This file: how to build it, and the context around it.

The live copy of the design also lives in a Claude doc (https://claude.ai/artifact/MDKmaLDiDGH1LesBkrz8cP). If the two ever differ, update `design.md` in the same change as the doc.

## Context

- Empire 1 is the current Empire mode (`lib/empire/`, `app/empire-game.tsx`). Empire 2.0 is a rules rewrite: frontiers, influence, cities, annexing and victory points.
- Empire 2.0 reuses the Empire 1 geography, sea routes, capital matching, turn clock, safe concurrent saves and the coloured map.
- Open decision: should Empire 2.0 replace Empire 1, or should both stay as separate modes for a while?
- Estimated build time: about half a day of build work, plus two playtests that need people to play. The playtests set the calendar time.

## How to build it (in order)

Each phase has a gate. Do not start the next phase until the gate passes.

1. **Rules engine** in a new `lib/empire2/` folder. Setup picks, snake order, income and booms, bounties, the four actions, victory points, titles, events and round-start standings. Gate: unit tests for every rule in `design.md`.
2. **Simulation and tuning.** Bots with four strategies (expander, city builder, colonizer, annexer), 2,000-game runs. Adjust costs, income and the 10-point target. Gate: every check in the "What to measure" list in `design.md` passes.
3. **Paper or bare-bones playtest.** A plain screen with buttons and the map. Gate: you and friends play 2–3 games and say it's fun. Stop here if it isn't.
4. **Server.** Room state, actions endpoint, setup flow, timeouts and saves. Gate: route tests, including a full game through the API.
5. **Screens.** Influence and victory-point bars, action buttons with costs, frontier highlight, city markers, boom and bounty panels, first-game guide. Gate: page tests, and a full game played in the browser.
6. **Polish.** Animations for annexes, sets and titles; results replay with awards. Gate: a second playtest.
7. **Later:** trading between players, once the core game is proven.

## Rules for whoever builds it

- Every number in `design.md` is a starting value. Change a number only after simulation or playtest shows it's needed, and note the change in the commit message.
- Keep UI text short and plain, following the "Writing UI text" section of the main README.
- The first build does not include trading.
