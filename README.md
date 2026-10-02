# Bran Game — Atlas Sprint

A two- or three-player naming-game lobby hosted on Vercel. Players can choose a 10-minute country sprint, a two-minute League of Legends champion sprint, or a two-minute Overwatch hero sprint. The host can start when at least two players have joined; each player’s answers stay private until the shared timer ends.

## Online setup

1. Push this repo to GitHub and import it into Vercel.
2. In Upstash, click **Connect to Project** and select this Vercel project. You can let Vercel manage the Upstash account and billing.
3. Redeploy the project. The app detects the Redis REST variables added by the integration, including database-prefixed names such as bran_KV_REST_API_URL and bran_KV_REST_API_TOKEN.
4. Share the deployed link with one or two friends. One player creates a room and sends the six-character code.

No SQL database or sign-in provider is needed. Room codes and private player tokens identify each player. The API keeps room state in Redis and only returns every player’s answers after the round ends.

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

The tests call the real room and guess route handlers with an in-memory Redis test double, and mount the real page in jsdom for lobby and multiplayer interactions. They cover both player counts, room capacity, host-only start and early end, duplicate clicks and guesses, private answers, game selection, game-specific answer validation, authorization, and timer-based reveal. The Redis test double models the commands used by these routes; it does not contact the hosted Upstash database.

## Build version

The header shows the first seven characters of the Git commit SHA used for the Vercel deployment. Every new commit pushed to GitHub produces a different build version, so compare the badge with the latest commit on `main` to confirm the deploy is current. Local builds show `local`. Vercel supplies `VERCEL_GIT_COMMIT_SHA` as a system environment variable.

The environment variable names are listed in .env.example. Do not commit real credentials.

## Rules

- Two or three players per room.
- The host can start once a second player has joined. A third player can join while the room is waiting.
- The host can end a round early to reveal the answers; otherwise it ends when that game's timer runs out.
- Country Sprint lasts 10 minutes; Champion Sprint and Overwatch Hero Sprint last 2 minutes.
- Each player can score each valid answer once.
- At the selected game's time limit, all players’ lists and the leaderboard unlock.

Country Sprint uses UN member states, plus the Holy See, Palestine, Taiwan, and Kosovo, with common English aliases. Champion Sprint uses the English League of Legends roster from Riot Data Dragon version 16.18.1. Overwatch Hero Sprint uses Blizzard's English live hero roster as of October 2, 2026. Both game rosters accept common punctuation, accent, and spacing variants.
