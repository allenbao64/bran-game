import { Redis } from "@upstash/redis";

export const ROOM_TTL_SECONDS = 60 * 60 * 24;

let client: Redis | null = null;
let testClient: Redis | null = null;

// Route tests inject an in-memory Redis implementation so they exercise the
// same handlers without needing Vercel credentials or a hosted database.
export function setRedisForTests(redis: Redis | null) {
  testClient = redis;
}

export function getRedis() {
  if (testClient) return testClient;
  if (client) return client;

  const entries = Object.entries(process.env);
  const url =
    process.env.UPSTASH_REDIS_REST_URL ??
    process.env.KV_REST_API_URL ??
    entries.find(([key, value]) => key.endsWith("_KV_REST_API_URL") && value)?.[1];
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ??
    process.env.KV_REST_API_TOKEN ??
    entries.find(([key, value]) => key.endsWith("_KV_REST_API_TOKEN") && value)?.[1];

  if (!url || !token) {
    throw new Error("Connect the Upstash Redis database to this Vercel project.");
  }

  client = new Redis({ url, token, enableTelemetry: false });
  return client;
}
