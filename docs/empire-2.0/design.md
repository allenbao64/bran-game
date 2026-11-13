# Empire 2.0: Gameplay Design

Last updated 2026-10-20. Source: the "Empire 2.0: Gameplay Design" Claude doc (rev 15). This file is the same content, kept in the repo so it is versioned with the code.

## Summary

Empire 2.0 turns the map into a board and adds an economy, so each turn builds on the last, like Catan. You grow outward from your borders, earn influence from your countries, and spend it to expand, build cities, colonize far away, or annex a rival's country. The first player to 10 victory points wins, in about 15 to 25 minutes.

### What changes from Empire 1, and why

| Empire 1 | Empire 2.0 | Why |
|---|---|---|
| Claim any country anywhere | Expand only next to your empire, or pay to colonize far away | Position matters: frontiers, races and blocking |
| One action per turn, worth 1 point | Spend influence on several actions a turn | Early choices make later turns stronger |
| Points = countries | Race to 10 victory points from cities, region sets and titles | Countries become the way to win, not the score |
| Criteria cards restrict you | Bounty cards reward you | Cards create opportunities instead of blocking turns |
| Nothing happens on others' turns | A boom each round pays every owner in three regions | You care about every round, not only your turn |
| Fortify | Cities: double income, a victory point, can't be annexed | One upgrade with three reasons to build it |
| Mid-round scores decide who's behind | Round-start standings and snake order | Going last no longer looks like losing |

Every number in this doc is a starting value. Bot simulations and a playtest tune them before building the screens.

## The game at a glance

Each round you expand, earn influence from what you own, and spend it to grow faster or score. Cities sit in both halves of the loop: they raise income and are worth points.

## Setup and turn structure

Players choose where they start, take turns in snake order, and every round opens with income for everyone.

### Setup (about 1 minute)

Like Catan's opening placements, setup runs in snake order so the last to pick a capital picks their second foothold first.

1. **Pick a capital** (order 1-2-3): you're offered 3 countries on different continents, each with at least 3 neighbours. Pick one.
2. **Place a second foothold** (order 3-2-1): name any free country that doesn't border another player's country. It's your second starting point.
3. Everyone starts with **3 influence**.

### Each round

1. **Income:** every player collects influence from their empire and cities (see the economy section). A player at least 2 victory points behind the leader gets 2 more.
2. **Boom:** three regions are drawn at random and shown to everyone. Each country you own in a booming region pays 1 influence, or 2 if it has a city.
3. **Bounties:** two bounty cards are revealed, for example "Landlocked" or "Starts with B". The first player to expand into or colonize a country that fits one collects 2 influence, and that card is gone.
4. **Turns:** each player takes a turn in snake order: 1-2-3, then 3-2-1, then 1-2-3.
5. Every 4th round, a world event applies for the next round.

### Your turn (30 seconds)

Within the clock, take any number of actions you can afford, in any order:

| Action | Cost | What you name | Effect |
|---|---|---|---|
| Expand | Free once a turn, then 1 | A free country bordering your empire | You own it |
| Colonize | 4 | Any free country | You own it, anywhere on the map |
| Build a city | 3 | The capital city of one of your countries | Double income there, 1 victory point, can't be annexed. Up to 4 cities. |
| Annex | 5 | The capital of a rival's country that borders yours | You take it. Once a turn. |
| End turn | Free | | Passes play on |

A wrong answer costs nothing, so you can try again while the clock runs. When the clock runs out, your turn ends and unspent influence carries over.

The clock length is set by the host: 20, 30 or 45 seconds.

## The map as a board

Your empire can only grow from its edges, so where you are decides what you can do. This is the change that most makes Empire feel like Catan.

- **Frontier:** every free country that borders one you own, by land or sea route, is on your frontier. Expanding into it is cheap. The map lightly highlights your frontier on your turn.
- **Sea routes:** islands link to their 2 nearest countries, as in Empire 1, so Japan, the UK and the Caribbean are reachable without colonizing.
- **Colonize:** claiming a free country off your frontier costs 4. It opens a new front, which matters for the explorer title and for reaching a region set.
- **Blocking:** an owned country stops a rival's expansion through it. Chokepoints such as Turkey, Egypt, Panama and Kazakhstan become worth racing for, like a contested crossroads in Catan.
- **Running out of room:** once your frontier is all taken, you must colonize or annex to grow. Empires collide in the mid-game, which is when annexing starts to matter.
- **Small countries:** the tiny-country dots on the map work the same as shapes for frontiers and claims.

## The influence economy

Influence is the game's one resource. A bigger empire earns more, cities earn the most, and booms add swings everyone watches. One resource keeps it quick to learn in a party game, where Catan's five would be too much.

### Income at the start of each round

| Source | Amount |
|---|---|
| Base | 2 |
| Territory | 1 per 4 countries you own |
| Each city | 1 |
| Boom (3 random regions) | 1 per country you own there, 2 if it has a city |
| Underdog (2+ victory points behind the leader) | 2 |
| Bounty card (on claim, not per round) | 2, once per card |

Rough income by stage, from these numbers: about 3 a round early, 5 to 7 mid-game, 8 or more late. Simulation will confirm.

### Costs

| Action | Cost |
|---|---|
| First expand each turn | Free |
| Each further expand | 1 |
| Build a city | 3 |
| Colonize | 4 |
| Annex | 5 |

### Why this creates an arc

- **Early:** income is low, so most turns are one free expand plus one paid one. Choices are about direction: which region, which chokepoint.
- **Mid:** income grows with territory. You choose between more countries now and cities that pay every round after.
- **Late:** frontiers close. Influence goes into annexing, colonizing to finish a region set, and cities for their victory points.

The classic tension is spend versus build: a city costs three expansions today but pays back in a few rounds and is safe from annexing.

## Victory points and the end of the game

The first player to reach 10 victory points at the end of their own turn wins. There are several roads to 10, so players with different strengths can each win.

| Source | Victory points | Notes |
|---|---|---|
| Territory | 1 per 4 countries | Steady points for growing |
| City | 1 each, up to 4 | Also pays income and can't be annexed |
| Region set | 2 for regions of 2–5 countries, 3 for 6–10, 4 for 11+ | Own every country in a region. Its countries can't be annexed. |
| Largest empire | 2 | Biggest connected group, at least 6 countries. The holder keeps it on a tie, like Catan's longest road. |
| Explorer | 2 | Countries on the most continents, at least 4. The holder keeps it on a tie, like Catan's largest army. |

Largest empire and explorer pull in opposite directions: one rewards growing in a single block, the other spreading out through colonies. A player can rarely hold both, which keeps the two titles changing hands.

An example winning mix: 12 countries (3), 3 cities (3), a small region set (2) and largest empire (2) makes 10.

**Ending:** the game ends the moment a player reaches 10 at the end of their turn, or after round 20 as a safety cap, when the most victory points wins. Ties go to more influence left, then share the win.

## Interaction between players

Players affect each other in four ways: blocking, annexing, racing for bounties and booms, and, later, trading. Each one is a choice, not a random hit.

### Annexing

- Costs 5 influence and needs the target country's capital named correctly. A wrong capital costs nothing but uses that action's time.
- The target must border your empire and belong to a player at or above you in the round-start standings, so nobody kicks someone who is already behind.
- Cities, starting capitals, footholds from setup and countries in a completed region set can't be annexed.
- Once a turn. Losing a country can break a rival's largest empire or region set, so annexes are the big swing moments.

### Blocking

Claiming a chokepoint shuts a rival's frontier through it. Blocking has no cost of its own, only the opportunity cost of not growing elsewhere.

### World events (every 4th round, lasting one round)

| Event | Effect |
|---|---|
| Trade winds | Colonizing costs 2 |
| Ceasefire | No annexing |
| Golden age | Cities pay double income |
| Gold rush | Bounties pay 4 |
| Closed borders | Expanding costs 1 more |

### Trading (phase 2, not in the first build)

On your turn, offer influence for one of another player's countries, or swap two countries. The other player accepts or declines on their screen. This adds table talk like Catan's trades, but needs extra screens, so it comes after the core game is tested.

## Catch-up and fairness

Being behind is measured at the start of each round, when everyone has had the same number of turns, so going last never counts as losing. This carries over the fix now being built for Empire 1.

- **Round-start standings:** victory points are snapshotted when each round begins. Every "who is behind" rule reads that snapshot, never mid-round totals.
- **Underdog income:** +2 influence a round for anyone at least 2 victory points behind the leader. It adds options rather than taking anything from the leader.
- **Annex only upward:** you can only annex from players at or above you, so the leader is the one exposed.
- **Snake order:** 1-2-3, then 3-2-1, so no one always goes first or last. Setup uses the same order.
- **Hard to target one player:** booms and world events hit everyone at once, which the research flags as a fix for three-player ganging up.
- **No bonus for falling behind on purpose:** the underdog boost is small and income-only, so it can't beat simply playing well.

## Pacing and a sample game

A 3-player game should run about 12 to 16 rounds, or 15 to 25 minutes, assuming turns average 20 of their 30 seconds. That's several times longer than Empire 1, with each turn doing more.

### How a game might unfold

Ana, Ben and Cara play. These are illustrations of the intended feel, not simulated results.

- **Rounds 1–4, the land grab:** Ana picks Germany and a second foothold in Kenya. Ben starts in Brazil, Cara in India. Each turn is a free expand and maybe one paid one. A boom in Western Europe pays Ana 3, and she races Ben to Spain.
- **Rounds 5–9, building up:** frontiers meet in the Middle East. Cara grabs Turkey and blocks Ana's route east. Ana builds two cities to bank income and points. Ben colonizes Australia to chase the explorer title and the Australia and New Zealand set.
- **Rounds 10–14, the squeeze:** free land is scarce. Cara is on 8 points, so she's annexable by both rivals. Ana pays 5, names Ankara, takes Turkey back, and breaks Cara's largest empire. Ben finishes his Oceania set and takes the explorer title to reach 10 at the end of his turn.

### What each stage should feel like

| Stage | Main decisions | Feeling |
|---|---|---|
| Early | Which direction to grow, which chokepoint to race for | Quick, exploratory |
| Mid | Expand more now, or build cities that pay later | Planning, building an engine |
| Late | Annex, block, finish a set, convert influence to points | Tense, swingy, comebacks possible |

## Design audit and how we'll test it

On paper, Empire 2.0 fixes Empire 1's main weaknesses: no build-up, a map that didn't matter, and nothing to do off-turn. The biggest risks are now complexity and balance numbers, and simulation plus one playtest should settle both before the screens are built.

### Against the design principles

| Principle | Empire 1 | Empire 2.0 |
|---|---|---|
| Interesting decisions | One choice a turn: which country | Spend versus build, direction, block versus grow, which title to chase |
| A sense of progress | Flat: turn 14 felt like turn 1 | Income and cities grow, so late turns do more |
| Luck you react to | Cards dealt before acting | Booms and bounties are revealed before turns. Base income cushions bad booms. |
| Fair catch-up | Favoured whoever went last | Round-start standings, small income boost, annex only upward |
| Three-player problem | Steals could pile on | Annex once a turn, upward only, protected cities and sets |
| Off-turn engagement | Watching only | Booms, bounties and watching frontiers close |
| Length | A few minutes | 15–25 minutes |

### Risks

- **Too much to learn for a party game:** 4 actions, 5 victory point sources and an economy. Fix: a first-game guide, cost labels on every button, and a victory-point bar that says where each point came from.
- **Typing several answers in 30 seconds:** strong typists may chain expands. Fix: costs after the first expand limit chaining; check in simulation.
- **Rich get richer:** territory income rewards the leader. Fix: income per 4 countries, not per country, plus annexing upward and underdog income. Watch the comeback rate.
- **A dominant strategy:** for example, cities-only might always win. Fix: compare bot strategies in simulation.
- **Booms feel random:** fix: base income, and booms shown before anyone acts.

### What to measure before building screens

- [ ] Bot simulation of 2,000 games with mixed strategies: expander, city builder, colonizer and annexer
- [ ] Average game length 12–16 rounds
- [ ] No single strategy wins more than 40% against a mixed field
- [ ] Win rate by seat within 5 points of even
- [ ] The player in last place at round 6 wins at least 15% of games
- [ ] Every game has at least one change of leader after round 5
- [ ] One paper playtest with a printed map, or a bare-bones version in the app, before the full screens

## Build plan

The rules engine and a bot simulation come first, and the numbers get tuned before any screen is built. Much of Empire 1 carries over: geography and sea routes, capital matching, the turn clock, safe concurrent saves, and the coloured map with small-country dots.

| Phase | What gets built | Gate to move on |
|---|---|---|
| 1. Rules engine | New `lib/empire2/` folder: setup picks, snake order, income and booms, bounties, the four actions, victory points, titles, events, round-start standings | Unit tests for every rule in this doc |
| 2. Simulation and tuning | Bots with 4 strategies; 2,000-game runs; adjust costs, income and the 10-point target | Every check in the audit section passes |
| 3. Paper or bare-bones playtest | A plain screen with buttons and the map, no polish | You and friends play 2–3 games and say it's fun |
| 4. Server | Room state, actions endpoint, setup flow, timeouts, saves | Route tests, including a full game through the API |
| 5. Screens | Influence and victory-point bars, action buttons with costs, frontier highlight, city markers, boom and bounty panels, first-game guide | Page tests, and a full game played in the browser |
| 6. Polish | Animations for annexes, sets and titles; results replay with awards | Second playtest |
| Later | Trading between players | After the core game is proven |

**Decision for you:** when Empire 2.0 is ready, should it replace Empire 1, or should both stay as separate modes for a while?
