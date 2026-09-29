# Bran Game — Atlas Sprint

A three-player country sprint hosted on Vercel. The room starts when player three joins; each player’s guesses stay private until the shared 10-minute timer ends.

## Online setup

1. Push this repo to GitHub and import it into Vercel.
2. In the Vercel project, open **Storage** and connect an **Upstash Redis** store from the Marketplace. You can let Vercel manage the Upstash account and billing.
3. Redeploy the project. The integration adds the Redis credentials to the server environment.
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
- The round starts as the third player joins.
- Each player can score each country once.
- At 10 minutes, all three lists and the leaderboard unlock.

The answer list uses UN member states, plus the Holy See, Palestine, Taiwan, and Kosovo, with common English aliases.
