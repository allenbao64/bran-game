/**
 * Prints a report of the turn-based game logs in Redis. Read-only: it only runs ZRANGE and HGETALL.
 * Run: node --env-file=.env.local --import tsx scripts/game-log-report.ts [--json] [--days N]
 */
import { LOG_ID_PATTERN, LOG_INDEX_KEY, logKey, parseGameLog, type GameLog } from "@/lib/game-log";
import { aggregateGames, formatReport, toJsonLines } from "@/lib/game-log-report";
import { getRedis } from "@/lib/redis";

const USAGE = "Usage: node --env-file=.env.local --import tsx scripts/game-log-report.ts [--json] [--days N]";
const CHUNK = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

function usage(message?: string): never {
  if (message) console.error(message);
  console.error(USAGE);
  process.exit(2);
}

function parseArgs(argv: string[]): { json: boolean; days: number | null } {
  let json = false;
  let days: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") json = true;
    else if (arg === "--days") {
      const value = argv[++i];
      if (value === undefined || !/^[1-9]\d*$/.test(value)) usage("--days needs a positive whole number.");
      days = Number(value);
    } else {
      usage(`Unknown option: ${arg}`);
    }
  }
  return { json, days };
}

/** The startedAt is the part of the logId after its last "-". */
const startedAtOf = (logId: string) => Number(logId.slice(logId.lastIndexOf("-") + 1));

async function main() {
  const { json, days } = parseArgs(process.argv.slice(2));
  const redis = getRedis();
  const ids = await redis.zrange<string[]>(LOG_INDEX_KEY, 0, -1);
  const cutoff = days === null ? null : Date.now() - days * DAY_MS;
  const selected = ids.filter((id) => LOG_ID_PATTERN.test(id) && (cutoff === null || startedAtOf(id) >= cutoff));

  const games: GameLog[] = [];
  for (let i = 0; i < selected.length; i += CHUNK) {
    const chunk = selected.slice(i, i + CHUNK);
    const hashes = await Promise.all(chunk.map((id) => redis.hgetall<Record<string, unknown>>(logKey(id))));
    chunk.forEach((id, index) => {
      const hash = hashes[index];
      if (hash && Object.keys(hash).length > 0) games.push(parseGameLog(id, hash));   // null or empty: expired, skip
    });
  }

  if (json) {
    for (const line of toJsonLines(games)) console.log(line);
  } else {
    console.log(formatReport(aggregateGames(games)));
  }
}

main().catch((cause: unknown) => {
  console.error(cause instanceof Error ? cause.message : "The game log report failed.");
  process.exit(1);
});
