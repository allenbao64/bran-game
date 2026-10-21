# Copy audit

Every user-facing string and the decision made. Line numbers refer to the files before this change (`git show HEAD~:<file>` after commit).
Rule: keep a line only if it tells the player something they need at that moment; otherwise delete it.

Counted per row (a row grouping same-kind strings counts once). Rows: 138. Cut: 44. Rewritten: 42. Kept: 52.
API error messages are unchanged and not counted: each says what went wrong.

| Where | Original text | Decision | New text / note |
|---|---|---|---|
| app/page.tsx:29,38 | Something went wrong. Please try again. | keep | |
| app/page.tsx:168 | End the round now and reveal everyone’s answers? (confirm) | keep | |
| app/page.tsx:186 | That doesn’t match a League champion. / Overwatch hero. / a country on the list. (3 messages) | keep | |
| app/page.tsx:188 | You already named that {country/champion/hero}. | keep | |
| app/page.tsx:249 | GAME LOBBY / 2–3 PLAYERS | cut | |
| app/page.tsx:249 | {GAME TITLE} / 2–3 PLAYERS | cut | |
| app/page.tsx:249 | green status dot | cut | |
| app/page.tsx:249 | BUILD {sha} | keep | |
| app/page.tsx:249 | ATLAS SPRINT (logo) | keep | |
| app/page.tsx:250 | ✳ BRAN GAME • FRIEND ROOM | cut | |
| app/page.tsx:252 | TWO MINDS OR THREE. YOUR CALL. | cut | |
| app/page.tsx:252 | Pick a game. Call your crew. | cut | |
| app/page.tsx:252 | Choose a quick challenge, make a private room, and see who can name the most before time runs out. | cut | |
| app/page.tsx:253 | 01 Choose a game from the lobby. | cut | |
| app/page.tsx:253 | 02 Invite one or two friends with your room code. | cut | |
| app/page.tsx:253 | 03 First to name an answer claims it for the round. | cut | |
| app/page.tsx:254 | CHOOSE A GAME | rewrite | GAME |
| app/page.tsx:254 | 2–3 PLAYERS | keep | |
| app/page.tsx:257 | Game titles and durations (3 + 3) | keep | |
| lib/games.ts:4,13,22 | prompt: Name as many countries / League champions / Overwatch heroes as you can. (3, shown on the picker) | cut | field removed; the `rules` line is the one rules line |
| lib/games.ts | rules: one per game (3) | keep | shown in the lobby only |
| lib/games.ts | placeholders and answer labels (6) | keep | |
| app/page.tsx:260 | MODE | keep | |
| app/page.tsx:261 | Live race: Everyone names countries at once for ten minutes. | keep | |
| app/page.tsx:262 | Turn-based: 12 rounds, a criteria card each turn. You pick the speed. | rewrite | 12 rounds. Each turn, claim a country that fits your card. Whole regions earn bonuses. |
| app/page.tsx:263 | Empire: Strategy turns: pick a card, claim, steal or fortify. First to 15 points. | rewrite | Pick a card, then claim, steal or fortify. First to 15 points. |
| app/page.tsx:261-263 | Mode names Live race / Turn-based / Empire (3) | keep | |
| app/page.tsx:264 | TURN SPEED, speed names, "{n} SECONDS" | keep | |
| app/page.tsx:267 | DISPLAY NAME | keep | |
| app/page.tsx:267 | placeholder: What should we call you? | rewrite | Your name |
| app/page.tsx:268 | Create {title} room ↗ | rewrite | Create room |
| app/page.tsx:269 | OR JOIN A FRIEND | rewrite | OR |
| app/page.tsx:269 | ROOM CODE, ABC123, Join (3) | keep | |
| app/page.tsx:270 | ◉ First claim wins. In countries, every claim shows in its player’s colour. | cut | |
| app/page.tsx:272 | {TITLE} • ROOM READY | cut | |
| app/page.tsx:272 | Bring the whole crew. | rewrite | {game title} |
| app/page.tsx:272 | MODE / LIVE RACE · 20S TURNS | rewrite | Live race · 20s turns |
| app/page.tsx:272 | Lobby paragraph, Empire variant (rules + "Region sets, majorities…") | rewrite | one rules line, same text as the mode picker |
| app/page.tsx:272 | Lobby paragraph, turn-based variant ("Take turns in join order…") | rewrite | one rules line, same text as the mode picker |
| app/page.tsx:272 | Lobby paragraph, live/other variant ("{rules} First to name each answer claims it.") | rewrite | the game's rules line |
| app/page.tsx:272 | Share this code. Start with two players, or wait for a third. | cut | |
| app/page.tsx:272 | {code}　⧉ | rewrite | {code} with a "Copy" label |
| app/page.tsx:273 | 01/02/03 seat numbers | keep | |
| app/page.tsx:273 | Waiting for player… | rewrite | Open seat |
| app/page.tsx:273 | IN ROOM / OPEN SEAT | cut | |
| app/page.tsx:274 | ◉ One more player is needed to start. | rewrite | Waiting for another player. |
| app/page.tsx:274 | ◉ Two players are ready. Start now or wait for a third. | rewrite | A third player can still join. |
| app/page.tsx:274 | ◉ All three seats are ready. | cut | |
| app/page.tsx:275 | Waiting for one more player (disabled button label) | cut | the button is a disabled "Start"; the line above says why |
| app/page.tsx:275 | Start round ↗ | rewrite | Start |
| app/page.tsx:276 | Leave room | keep | |
| app/page.tsx:278,280 | Dealing the first card… / Placing capitals… | keep | |
| app/page.tsx:281 | {TITLE} ● LIVE | cut | |
| app/page.tsx:281 | Name every country. / champion. / hero. (3) | rewrite | {game title} |
| app/page.tsx:281 | TIME LEFT | keep | |
| app/page.tsx:281 | Type an answer and press enter. First to name it locks it for the round. | cut | |
| app/page.tsx:282 | Claim ↵ | rewrite | Claim |
| app/page.tsx:283 | YOUR ANSWERS {n} | keep | |
| app/page.tsx:283 | SHOWN ON THE MAP | cut | |
| app/page.tsx:283 | HIDDEN FROM OTHERS (non-country games) | keep | |
| app/page.tsx:284 | Your first answer is waiting here. Claimed countries appear in your colour. | cut | |
| app/page.tsx:284 | Your first answer is waiting here. The other players can’t see this list. | cut | |
| app/page.tsx:286 | Nothing claimed yet; "{name} (you) · n" | keep | |
| app/page.tsx:287 | THE ROOM n/3 | rewrite | PLAYERS n/3 |
| app/page.tsx:287 | ◉ placeholder count for non-country games | cut | |
| app/page.tsx:287 | ✳ First to name an answer locks it. Locked countries are coloured by who claimed them. | cut | |
| app/page.tsx:287 | ✳ First to name an answer locks it. You can’t see who claimed a lock until results. | cut | |
| app/page.tsx:287 | End round & reveal | keep | |
| app/page.tsx:288 | GAME OVER • FINAL SCORES | cut | |
| app/page.tsx:288 | What a showing. (turn-based results) | rewrite | Results |
| app/page.tsx:288 | {n} players, 12 rounds. Points plus bonuses decide it. | cut | |
| app/page.tsx:289-292 | 1ST/2ND/3RD, YOU, POINTS, Claims (n), bonus labels, Final score, AWARD, award titles | keep | |
| app/page.tsx:294,296 | Back to game lobby ↗ (2) | rewrite | Back to lobby |
| app/page.tsx:296 | ROUND OVER • ANSWERS REVEALED | cut | |
| app/page.tsx:296 | What a showing. (live results) | rewrite | Results |
| app/page.tsx:296 | {n} players. Here’s how your lists compare. | cut | |
| app/page.tsx:297 | BRAN GAME / FRIEND ROOM | cut | |
| app/page.tsx:297 | MADE FOR FRIENDS, PLAYED FAIR | cut | |
| app/page.tsx:297 | © 2026 | cut | |
| app/turns-game.tsx:40 | COUNTRY SPRINT ● TURN-BASED {n}S TURNS | cut | the turn clock already shows the time |
| app/turns-game.tsx:40 | Take your turn. | cut | the banner below says whose turn it is |
| app/turns-game.tsx:41 | YOUR TURN / NOW PLAYING small labels | cut | |
| app/turns-game.tsx:41 | It’s your turn | rewrite | Your turn |
| app/turns-game.tsx:41 | {name}’s turn; Another player’s turn | keep | |
| app/turns-game.tsx:42 | seconds-left aria-label | keep | |
| app/turns-game.tsx:45 | ROUND n OF m | keep | |
| app/turns-game.tsx:45 | DOUBLE POINTS · CLAIMS WORTH 2 | rewrite | Double points |
| app/turns-game.tsx:46 | YOUR CARD / {NAME} CARD / THEIR CARD | rewrite | CARD |
| app/turns-game.tsx:46 | No card; card label | keep | |
| app/turns-game.tsx:48 | placeholder: Name a country that fits the card… | rewrite | Country name |
| app/turns-game.tsx:48 | placeholder: Waiting for {name}… | cut | |
| app/turns-game.tsx:49 | Claim ↵ | rewrite | Claim |
| app/turns-game.tsx:51 | Pass | keep | |
| app/turns-game.tsx:55-58 | Scoreboard name, total, "{n} POINTS · LARGEST GROUP n", bonus chips | keep | |
| app/turns-game.tsx:58 | NO BONUSES YET | cut | |
| app/turns-game.tsx:63 | THE ROOM n/3 | rewrite | PLAYERS n/3 |
| app/turns-game.tsx:65 | ✳ Owning a whole small region pays +1 to +4… The last three rounds pay double. | cut | the lobby rules line mentions region bonuses |
| app/turns-game.tsx:66 | End game & reveal | keep | |
| app/empire-game.tsx:35-39 | Gold rush / Largest empire / set / majority bonus lines (4) | keep | |
| app/empire-game.tsx:43-46 | Log lines: claimed / stole / fortified / missed the capital / passed (5) | keep | |
| app/empire-game.tsx:74 | That doesn’t match a country on the list. | keep | |
| app/empire-game.tsx:86 | EMPIRE ● ROUND n OF m FIRST TO 15 {n}S TURNS | rewrite | ROUND n OF m (first-to is in the sidebar, speed on the clock) |
| app/empire-game.tsx:87 | Your move. / {Name}’s move. | rewrite | Your turn / {Name}’s turn |
| app/empire-game.tsx:88 | TURN 0:20 | keep | |
| app/empire-game.tsx:89 | EVENT THIS ROUND · {label} | rewrite | Event: {label} |
| app/empire-game.tsx:90 | Next event card after round n. | cut | |
| app/empire-game.tsx:92 | PICK A CARD | rewrite | YOUR CARDS |
| app/empire-game.tsx:92 | {NAME}’S CARDS | keep | |
| app/empire-game.tsx:92 | CARD PICKED / NO CARD YET | cut | the picked card is highlighted |
| app/empire-game.tsx:98-99 | Country name; Capital of {x} | keep | |
| app/empire-game.tsx:101 | Steal ↵ / Claim ↵ | rewrite | Steal / Claim |
| app/empire-game.tsx:102-103 | Fortify, Pass | keep | |
| app/empire-game.tsx:105 | Pick a card, then name a country that fits it. | rewrite | Pick a card first. |
| app/empire-game.tsx:105 | {X} belongs to {Y}. Name its capital to steal it (n steals left). | keep | |
| app/empire-game.tsx:105 | Name a free country that fits your card. Type one of yours to fortify it. | cut | |
| app/empire-game.tsx:111 | SCORES / n TO WIN | keep | |
| app/empire-game.tsx:117-119 | score line, bonus lines, Forts | keep | |
| app/empire-game.tsx:122-123 | LATEST, R{n} · log lines, No moves yet. | keep | |
| app/empire-game.tsx:124 | ✳ Steal only countries that border yours, from players at or above your score. Capitals, forts and full region sets can’t be stolen. | rewrite | Steals: the country must border yours and its owner must have at least your score. Capitals, forts and full region sets are safe. (moved from the sidebar into the form, next to the steal input) |
| app/empire-game.tsx:125 | End game & reveal | keep | |
| app/empire-game.tsx:138 | GAME OVER • EMPIRE | cut | |
| app/empire-game.tsx:139 | {Name} rules the world. / share the world. | rewrite | {Name} wins / {A and B} win |
| app/empire-game.tsx:139 | What an empire. | rewrite | Results |
| app/empire-game.tsx:140 | Finished in round n of m. | rewrite | Round n of m |
| app/empire-game.tsx:140 | The host ended the game. | rewrite | Ended by the host |
| app/empire-game.tsx:146-148 | rank, YOU, WINNER, POINTS, Countries, Final score | keep | |
| app/empire-game.tsx:153 | Back to game lobby ↗ | rewrite | Back to lobby |
| app/replay.tsx:22 | ▶ Play | rewrite | Play |
| app/replay.tsx:22 | Replaying… | keep | |
| app/replay.tsx:23 | CLAIM n OF m · {who} TOOK {X} (+n) | keep | |
| app/replay.tsx:23 | REPLAYING… (caption) | cut | the button already says it |
| app/replay.tsx:23 | PRESS PLAY TO WATCH THE MAP FILL IN | cut | |
| app/replay.tsx:23 | NO CLAIMS WERE MADE | rewrite | No claims were made |
| app/replay.tsx:25 | REPLAY heading | keep | |
| app/world-map.tsx:13 | LIVE WORLD MAP | keep | |
| app/world-map.tsx:32 | n CLAIMED, legend names and counts | keep | |
| app/world-map.tsx:31,36 | aria-labels | keep | |
| app/world-map.tsx:45 | Claimed by {x} (you) · part of their largest territory; Available country | keep | |

## Follow-up: home page intro

The home page's left column was cut in the first pass. It's back, rewritten to explain the game rather than fill space: a heading that names the core action ("Name countries. Paint the map."), one sentence on who it's for and how it works, an example map in the game's own colours, and three concrete steps. On phones the room form comes first and the intro follows.
