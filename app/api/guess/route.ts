import { NextRequest, NextResponse } from "next/server";
import { countryByCode } from "@/lib/countries";
import { championByCode } from "@/lib/champions";
import { overwatchHeroByCode } from "@/lib/overwatch-heroes";
import { gameConfig } from "@/lib/games";
import { getRedis, ROOM_TTL_SECONDS } from "@/lib/redis";
import { applyClaim, isTurnsRoom, runTurnAction } from "@/lib/turn-room";

export const runtime = "nodejs";
type Player = { id: string; token: string; name: string; host: boolean };
type Room = { code: string; mode?: "live" | "turns" | "empire"; gameId?: "countries" | "champions" | "overwatch"; status: "waiting" | "playing" | "ended"; startedAt: number | null; players: Player[] };

function parseScriptResult<T>(result: unknown): T {
  if (typeof result === "string") return JSON.parse(result) as T;
  if (result !== null && typeof result === "object") return result as T;
  throw new Error("Unexpected response from Redis script.");
}

export async function POST(request: NextRequest) {
  try {
    const redis = getRedis();
    const body = await request.json();
    const code = typeof body.code === "string" ? body.code.toUpperCase() : "";
    const token = typeof body.token === "string" ? body.token : "";
    const answerCode = typeof body.answerCode === "string"
      ? body.answerCode.toLowerCase()
      : typeof body.countryCode === "string" ? body.countryCode.toUpperCase() : "";
    if (!/^[A-Z2-9]{6}$/.test(code) || token.length < 32) {
      return NextResponse.json({ error: "That answer is not on the game's list." }, { status: 400 });
    }
    const key = `bran:room:${code}`;
    const room = await redis.get<Room>(key);
    if (!room) return NextResponse.json({ error: "Room not found." }, { status: 404 });
    const gameId = gameConfig(room.gameId).id;
    const answer = gameId === "champions"
      ? championByCode(answerCode)
      : gameId === "overwatch" ? overwatchHeroByCode(answerCode) : countryByCode(answerCode.toUpperCase());
    const answerType = gameId === "champions" ? "champion" : gameId === "overwatch" ? "hero" : "country";
    if (!answer) return NextResponse.json({ error: `That answer is not on the ${answerType} list.` }, { status: 400 });
    const player = room.players.find((entry) => entry.token === token);
    if (!player) return NextResponse.json({ error: "This browser is not in that room." }, { status: 403 });
    if (gameId === "countries" && room.mode === "empire") {
      return NextResponse.json({ error: "Empire rooms use their own actions." }, { status: 409 });
    }
    if (gameId === "countries" && isTurnsRoom(room)) {
      // Turn-based claims are validated and written by the compare-and-set engine, not the live-race script.
      const now = Date.now();
      const outcome = await runTurnAction(redis, key, now, (turnRoom) => applyClaim(turnRoom, player.id, answer.code, now));
      if ("error" in outcome) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
      return NextResponse.json({ ok: true });
    }
    const roundMs = gameConfig(gameId).durationSeconds * 1000;
    if (room.status !== "playing" || room.startedAt === null || Date.now() >= room.startedAt + roundMs) {
      return NextResponse.json({ error: "The round has ended." }, { status: 409 });
    }

    // One Lua transaction makes the claim check and score atomic, so two players
    // racing the same answer cannot both score it.
    const script = `
      local raw = redis.call('GET', KEYS[1])
      if not raw then return cjson.encode({error='Room not found.'}) end
      local room = cjson.decode(raw)
      local player = nil
      for _, entry in ipairs(room.players) do
        if entry.token == ARGV[1] then player = entry end
      end
      if not player then return cjson.encode({error='This browser is not in that room.', status=403}) end
      if room.status ~= 'playing' or not room.startedAt or tonumber(ARGV[4]) >= room.startedAt + tonumber(ARGV[5]) then
        return cjson.encode({error='The round has ended.', status=409})
      end
      local owner = redis.call('HGET', KEYS[2], ARGV[2])
      if owner then
        if owner == player.id then return cjson.encode({error='You already claimed that answer.', status=409}) end
        return cjson.encode({error='Another player already claimed that answer.', status=409})
      end
      redis.call('HSET', KEYS[2], ARGV[2], player.id)
      redis.call('EXPIRE', KEYS[2], tonumber(ARGV[6]))
      redis.call('HSET', KEYS[3], ARGV[2], ARGV[3])
      redis.call('EXPIRE', KEYS[3], tonumber(ARGV[6]))
      return cjson.encode({ok=true})
    `;
    const result = await redis.eval(script,
      [key, `bran:claimed:${code}`, `bran:guesses:${code}:${player.id}`],
      [token, answer.code, answer.name, String(Date.now()), String(roundMs), String(ROOM_TTL_SECONDS)]);
    const claim = parseScriptResult<{ ok?: boolean; error?: string; status?: number }>(result);
    if (claim.error) return NextResponse.json({ error: claim.error }, { status: claim.status ?? 409 });
    if (!claim.ok) return NextResponse.json({ error: `Could not claim that ${answerType}. Please try again.` }, { status: 503 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "The room service is unavailable. Try again in a moment." }, { status: 503 });
  }
}
