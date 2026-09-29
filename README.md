# Bran Game — Atlas Sprint

A three-player country sprint hosted on Vercel. The host starts once all three players are in the room; each player’s guesses stay private until the shared 10-minute timer ends.

## Online setup

1. Push this repo to GitHub and import it into Vercel.
2. In Upstash, click **Connect to Project** and select this Vercel project. You can let Vercel manage the Upstash account and billing.
3. Redeploy the project. The app detects the Redis REST variables added by the integration, including database-prefixed names such as bran_KV_REST_API_URL and bran_KV_REST_API_TOKEN.
4. Share the deployed link with your two friends. One player creates a room and sends the six-character code.

No SQL database or sign-in provider is needed. Room codes and private player tokens identify each player. The API keeps room state in Redis and only returns every player’s answers after the round ends.

## Local development

After linking the repo to Vercel and connecting Redis, pull the project environment and run the app:

    vercel link
    vercel env pull .env.local
    npm install
    npm run dev

The environment variable names are listed in .env.example. Do not commit real credentials.

## Rules

- Exactly three players per room.
- The host can start once all three players have joined.
- Each player can score each country once.
- At 10 minutes, all three lists and the leaderboard unlock.

The answer list uses UN member states, plus the Holy See, Palestine, Taiwan, and Kosovo, with common English aliases.
