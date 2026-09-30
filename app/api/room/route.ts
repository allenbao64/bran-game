import { randomInt, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getRedis, ROOM_TTL_SECONDS } from "@/lib/redis";

export const runtime = "nodejs";
const ROUND_MS = 10 * 60 * 1000;

type Player = { id: string; token: string; name: string; host: boolean };
type Room = { code: string; status: "waiting" | "playing" | "ended"; createdAt: number; startedAt: number | null; players: Player[] };
const roomKey = (code: string) => `bran:room:${code}`;
const cleanPlayer = (p: Player) => ({ id: p.id, name: p.name, host: p.host });
const publicPlayers = (players: Player[]) => players.map(cleanPlayer);

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
function validName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 18;
}
function parseScriptResult<T>(result: unknown): T {
  if (typeof result === "string") return JSON.parse(result) as T;
  if (result !== null && typeof result === "object") return result as T;
  throw new Error("Unexpected response from Redis script.");
}

export async function POST(request: NextRequest) {
  try {
    const redis = getRedis();
    const body = await request.json();
    if (!validName(body.name)) return error("Name must be 1–18 characters.");
    const name = body.name.trim();
    if (body.action === "create") {
      const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      for (let attempt = 0; attempt < 8; attempt++) {
        const code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");
        const token = randomUUID() + randomUUID();
        const player: Player = { id: randomUUID(), token, name, host: true };
        const room: Room = { code, status: "waiting", createdAt: Date.now(), startedAt: null, players: [player] };
        const created = await redis.set(roomKey(code), room, { ex: ROOM_TTL_SECONDS, nx: true });
        if (created) return NextResponse.json({
          code, token, playerId: player.id, status: room.status,
          startedAt: room.startedAt, players: publicPlayers(room.players)
        });
      }
      return error("Could not make a room. Please try again.", 503);
    }

    if (typeof body.code !== "string") return error("Choose create or join.");
    const code = body.code.trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code)) return error("Enter a valid six-character room code.");
    const key = roomKey(code);

    if (body.action === "start") {
      if (typeof body.token !== "string" || body.token.length < 32) return error("Room session is invalid.", 401);
      const script = `
        local raw = redis.call('GET', KEYS[1])
        if not raw then return cjson.encode({error='Room not found. Check the code.'}) end
        local room = cjson.decode(raw)
        local host = nil
        for _, player in ipairs(room.players) do
          if player.token == ARGV[1] then host = player end
        end
        if not host or not host.host then return cjson.encode({error='Only the host can start this round.'}) end
        if room.status ~= 'waiting' then return cjson.encode({error='This round has already started.'}) end
        if #room.players < 2 then return cjson.encode({error='At least two players must join before starting.'}) end
        room.status = 'playing'
        room.startedAt = tonumber(ARGV[2])
        redis.call('SET', KEYS[1], cjson.encode(room), 'EX', tonumber(ARGV[3]))
        local players = {}
        for _, player in ipairs(room.players) do
          table.insert(players, {id=player.id, name=player.name, host=player.host})
        end
        return cjson.encode({ok=true, status=room.status, startedAt=room.startedAt, players=players})
      `;
      const result = await redis.eval(script, [key], [body.token, String(Date.now()), String(ROOM_TTL_SECONDS)]);
      const started = parseScriptResult<{ error?: string; ok?: boolean; status?: Room["status"]; startedAt?: number; players?: ReturnType<typeof publicPlayers> }>(result);
      if (started.error) return error(started.error);
      if (!started.ok) return error("Could not start this round. Please try again.");
      return NextResponse.json({ code, status: started.status, startedAt: started.startedAt, players: started.players });
    }

    if (body.action === "end") {
      if (typeof body.token !== "string" || body.token.length < 32) return error("Room session is invalid.", 401);
      const script = `
        local raw = redis.call('GET', KEYS[1])
        if not raw then return cjson.encode({error='Room not found. Check the code.'}) end
        local room = cjson.decode(raw)
        local host = nil
        for _, player in ipairs(room.players) do
          if player.token == ARGV[1] then host = player end
        end
        if not host or not host.host then return cjson.encode({error='Only the host can end this round.'}) end
        if room.status ~= 'playing' then return cjson.encode({error='This round is not in progress.'}) end
        room.status = 'ended'
        redis.call('SET', KEYS[1], cjson.encode(room), 'EX', tonumber(ARGV[2]))
        return cjson.encode({ok=true, status=room.status})
      `;
      const result = await redis.eval(script, [key], [body.token, String(ROOM_TTL_SECONDS)]);
      const ended = parseScriptResult<{ error?: string; ok?: boolean; status?: Room["status"] }>(result);
      if (ended.error) return error(ended.error);
      if (!ended.ok) return error("Could not end this round. Please try again.");
      return NextResponse.json({ code, status: ended.status });
    }

    if (body.action !== "join") return error("Choose create or join.");
    const playerId = randomUUID();
    const token = randomUUID() + randomUUID();
    const script = `
      local raw = redis.call('GET', KEYS[1])
      if not raw then return cjson.encode({error='Room not found. Check the code.'}) end
      local room = cjson.decode(raw)
      if room.status ~= 'waiting' then return cjson.encode({error='That round has already started.'}) end
      if #room.players >= 3 then return cjson.encode({error='This room is full.'}) end
      table.insert(room.players, {id=ARGV[1], token=ARGV[2], name=ARGV[3], host=false})
      redis.call('SET', KEYS[1], cjson.encode(room), 'EX', tonumber(ARGV[4]))
      local players = {}
      for _, player in ipairs(room.players) do
        table.insert(players, {id=player.id, name=player.name, host=player.host})
      end
      return cjson.encode({ok=true, status=room.status, startedAt=room.startedAt, players=players})
    `;
    const result = await redis.eval(script, [key], [playerId, token, name, String(ROOM_TTL_SECONDS)]);
    const joined = parseScriptResult<{ error?: string; ok?: boolean; status?: Room["status"]; startedAt?: number | null; players?: ReturnType<typeof publicPlayers> }>(result);
    if (joined.error) return error(joined.error);
    if (!joined.ok) return error("Could not join that room. Please try again.");
    return NextResponse.json({ code, token, playerId, status: joined.status, startedAt: joined.startedAt, players: joined.players });
  } catch (cause) {
    console.error("Room POST failed:", cause);
    return error("The room service is unavailable. Try again in a moment.", 503);
  }
}

export async function GET(request: NextRequest) {
  try {
    const redis = getRedis();
    const code = (request.nextUrl.searchParams.get("code") ?? "").toUpperCase();
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!/^[A-Z2-9]{6}$/.test(code) || token.length < 32) return error("Room session is invalid.", 401);
    const room = await redis.get<Room>(roomKey(code));
    if (!room) return error("Room not found. It may have expired.", 404);
    const me = room.players.find((player) => player.token === token);
    if (!me) return error("This browser is not in that room.", 403);

    const timedOut = room.status === "playing" && room.startedAt !== null && Date.now() >= room.startedAt + ROUND_MS;
    if (timedOut) {
      room.status = "ended";
      await redis.set(roomKey(code), room, { ex: ROOM_TTL_SECONDS });
    }
    const ownGuesses = await redis.hgetall<Record<string, string>>(`bran:guesses:${code}:${me.id}`) ?? {};
    const response: Record<string, unknown> = {
      code: room.code, status: room.status, startedAt: room.startedAt,
      players: publicPlayers(room.players), playerId: me.id,
      myGuesses: Object.entries(ownGuesses).map(([countryCode, countryName]) => ({ code: countryCode, name: countryName }))
    };
    if (room.status === "ended") {
      const results = await Promise.all(room.players.map(async (player) => {
        const guesses = await redis.hgetall<Record<string, string>>(`bran:guesses:${code}:${player.id}`) ?? {};
        return { playerId: player.id, name: player.name, guesses: Object.entries(guesses).map(([countryCode, countryName]) => ({ code: countryCode, name: countryName })) };
      }));
      response.results = results.sort((a, b) => b.guesses.length - a.guesses.length);
    }
    return NextResponse.json(response);
  } catch (cause) {
    console.error("Room GET failed:", cause);
    return error("The room service is unavailable. Try again in a moment.", 503);
  }
}
