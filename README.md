# Bran Game — Atlas Sprint

A two- or three-player naming-game lobby hosted on Vercel. Players can choose a 10-minute country sprint, a two-minute League of Legends champion sprint, or a two-minute Overwatch hero sprint. The host can start when at least two players have joined. Every valid answer is first come, first claimed for the round.

## Online setup

1. Push this repo to GitHub and import it into Vercel.
2. In Upstash, click **Connect to Project** and select this Vercel project. You can let Vercel manage the Upstash account and billing.
3. Redeploy the project. The app detects the Redis REST variables added by the integration, including database-prefixed names such as bran_KV_REST_API_URL and bran_KV_REST_API_TOKEN.
4. Share the deployed link with one or two friends. One player creates a room and sends the six-character code.

No SQL database or sign-in provider is needed. Room codes and private player tokens identify each player. The API keeps room state in Redis. In the countries game every claim is shown live on the map in its owner's colour; in the other games, answers stay private until the round ends.

## Local development

After linking the repo to Vercel and connecting Redis, pull the project environment and run the app:

    vercel link
    vercel env pull .env.local
    npm install
    npm run dev

## Automated checks

Run the game flow checks and production build before shipping a change:

    npm test
    npm run build

The tests call the real room and guess route handlers with an in-memory Redis test double, and mount the real page in jsdom for lobby and multiplayer interactions. They cover both player counts, room capacity, host-only start and early end, duplicate clicks, room-wide answer locks for every game, private answers, game selection, game-specific answer validation, authorization, and timer-based reveal. The Redis test double models the commands used by these routes; it does not contact the hosted Upstash database.

## Build version

The header shows the first seven characters of the Git commit SHA used for the Vercel deployment. Every new commit pushed to GitHub produces a different build version, so compare the badge with the latest commit on `main` to confirm the deploy is current. Local builds show `local`. Vercel supplies `VERCEL_GIT_COMMIT_SHA` as a system environment variable.

The environment variable names are listed in .env.example. Do not commit real credentials.

## Rules

- Two or three players per room.
- The host can start once a second player has joined. A third player can join while the room is waiting.
- The host can end a round early to reveal the answers; otherwise it ends when that game's timer runs out.
- Country Sprint lasts 10 minutes; Champion Sprint and Overwatch Hero Sprint last 2 minutes.
- Each valid answer can only score once per room. The first player to name it claims it; later attempts are rejected without revealing the owner.
- Country Sprint includes a shared live world map. It shows which countries are claimed, but never who claimed them.
- At the selected game's time limit, all players’ lists and the leaderboard unlock.

Country Sprint uses UN member states, plus the Holy See, Palestine, Taiwan, and Kosovo, with common English aliases. Champion Sprint uses the English League of Legends roster from Riot Data Dragon version 16.18.1. Overwatch Hero Sprint uses Blizzard's English live hero roster as of October 2, 2026. Both game rosters accept common punctuation, accent, and spacing variants.

## Turn-based cards and country stats

Each turn deals two different cards, each fitting between 12 and 60 of the unclaimed countries (the range shrinks as the board empties). Pairs are dealt so that at least 2 countries fit both when possible. Fitting one card scores 1 point, both cards 3; the last three rounds count double. Wild is a 3% draw per turn and counts as fitting any country. Your largest linked group scores +1 for every 3 countries. A tie for first after the last round goes to sudden death: only the tied players play, up to 3 rounds at normal points, and they share the win if still tied. Every player also starts with a free country: not an island, 2+ land neighbours, a different subregion from the other starts. It is a round-0 claim worth 0 points that still counts for territory and region bonuses.

Population, GDP, GDP per capita, time zones and flag colours live in the committed file lib/data/country-stats.json. Regenerate it (needs network) with:

    node --import tsx scripts/build-country-stats.ts

Sources: World Bank API (latest non-empty value), countries-and-timezones (distinct standard UTC offsets), flag-icons SVGs rasterised with resvg (a colour counts at 0.8% of the flag, orange at 3%). Countries with no value (for example GDP for North Korea) never fit cards on that stat.

## Game logging (turn-based mode)

Every finished turn of a turn-based game is logged: one record per turn (the cards shown, the outcome, the time taken, and for a claim which cards the country fit), one per wrong guess, and a start and an end record for each game. Start records carry player ids and display names only; end records carry scores. No player tokens, IP addresses or user agents are ever stored. Live and Empire rooms are not logged.

Where: one Redis hash per game, `bran:glog:<ROOM>-<startedAt>`, plus the sorted set `bran:glog:index` that lists the games. Logs are kept for 30 days. The room itself still expires after 24 hours, so the read API below works for a game only while its room exists.

Kill switch: set `GAME_LOGGING=off` (or `0`, `false`, `no`) to stop writing logs. It is read on every request, so on Vercel a change takes effect with the next deployment, like any environment variable change.

Cost: one extra Redis command for each request that ends a turn (including a timeout caught up by a poll), and four at game start. Requests that change nothing write nothing.

Reading the logs:

- `GET /api/room/log?code=ABC234` with the room's `Authorization: Bearer <token>` returns one game's log as JSON. It uses the same checks as the room GET.
- The report script reads every game in the index:

      node --env-file=.env.local --import tsx scripts/game-log-report.ts            # plain-text report
      node --env-file=.env.local --import tsx scripts/game-log-report.ts --json     # raw JSON lines
      node --env-file=.env.local --import tsx scripts/game-log-report.ts --days 7   # only games started in the last 7 days

  `.env.local` comes from `vercel env pull .env.local`. Without `--env-file`, export the same variables the app reads (`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, or the `KV_*` variants).

The logging tests run with the same in-memory Redis double as the other tests.

## Writing UI text

Keep a line only if it tells the player something they need at that moment. If deleting it loses no information, delete it. Prefer deleting to rewriting; when text is needed, make it short, plain and specific. Show state in-game (whose turn, the card, time, scores) and put rules in one place per mode: the mode picker and lobby. The earlier audit is in `docs/copy-audit.md`.

| Don't | Do |
|---|---|
| Slogan headline: "Pick a game. Call your crew." | Nothing, or a plain title: "Country Sprint" |
| Intro that repeats the screen: "Type an answer and press enter." | Delete it; the input and the Claim button already say so |
| Flourish: "Your move." / "What a showing." / "Smith rules the world." | "Your turn" / "Results" / "Smith wins" |
| Fake chrome: "✳ BRAN GAME • FRIEND ROOM", footer taglines, decorative ◉ ↗ ↵ | Leave out; keep the one logo in the top bar |
| Rules repeated in the lobby, sidebar and buttons | One short rules line per mode, in the mode picker and lobby |
