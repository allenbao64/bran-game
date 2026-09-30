# Bran Game — Atlas Sprint

A two- or three-player country sprint hosted on Vercel. The host can start when at least two players have joined; each player’s guesses stay private until the shared 10-minute timer ends.

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

The tests call the real room and guess route handlers with an in-memory Redis test double, and mount the real page in jsdom for join and start interactions. They cover two- and three-player rooms, room capacity, host-only start, duplicate clicks and guesses, private answers, authorization, and timer-based reveal. The Redis test double models the commands used by these routes; it does not contact the hosted Upstash database.

## Build version

The header shows the first seven characters of the Git commit SHA used for the Vercel deployment. Every new commit pushed to GitHub produces a different build version, so compare the badge with the latest commit on `main` to confirm the deploy is current. Local builds show `local`. Vercel supplies `VERCEL_GIT_COMMIT_SHA` as a system environment variable.

The environment variable names are listed in .env.example. Do not commit real credentials.

## Rules

- Two or three players per room.
- The host can start once a second player has joined. A third player can join while the room is waiting.
- Each player can score each country once.
- At 10 minutes, all players’ lists and the leaderboard unlock.

The answer list uses UN member states, plus the Holy See, Palestine, Taiwan, and Kosovo, with common English aliases.
