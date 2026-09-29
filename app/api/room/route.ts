import { randomInt, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { redis, ROOM_TTL_SECONDS } from "@/lib/redis";

export const runtime = "nodejs";
const MAX_PLAYERS = 3;
const ROUND_MS = 10 * 60 * 1000;

type Player = { id: string; token: string; name: string; host: boolean };
type Room = { code: string; status: "waiting" | "playing" | "ended"; createdAt: number; startedAt: number | null; players: Player[] };
const roomKey = (code: string) => `bran:room:${code}`;
const cleanPlayer = (p: Player) => ({ id: p.id, name: p.name, host: p.host });

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
function validName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 18;
}

export async function POST(request: NextRequest) {
  try {
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
        if (created) return NextResponse.json({ code, token, playerId: player.id });
      }
      return error("Could not make a room. Please try again.", 503);
    }

    if (body.action !== "join" || typeof body.code !== "string") return error("Choose create or join.");
    const code = body.code.trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code)) return error("Enter a valid six-character room code.");
    const key = roomKey(code);
    const playerId = randomUUID();
    const token = randomUUID() + randomUUID();
    const now = Date.now();
    const script = `
      local raw = redis.call('GET', KEYS[1])
      if not raw then return cjson.encode({error='Room not found. Check the code.'}) end
      local room = cjson.decode(raw)
      if room.status ~= 'waiting' then return cjson.encode({error='That round has already started.'}) end
      if #room.players >= 3 then return cjson.encode({error='This room is full.'}) end
      table.insert(room.players, {id=ARGV[1], token=ARGV[2], name=ARGV[3], host=false})
      if #room.players == 3 then room.status='playing'; room.startedAt=tonumber(ARGV[4]) end
      redis.call('SET', KEYS[1], cjson.encode(room), 'EX', tonumber(ARGV[5]))
      return cjson.encode({ok=true, started=room.status == 'playing'})
    `;
    const result = await redis.eval<string>(script, [key], [playerId, token, name, String(now), String(ROOM_TTL_SECONDS)]);
    const joined = typeof result === "string" ? JSON.parse(result) : result;
    if (joined?.error) return error(joined.error);
    if (!joined?.ok) return error("Could not join that room. Please try again.");
    return NextResponse.json({ code, token, playerId });
  } catch {
    return error("The room service is unavailable. Try again in a moment.", 503);
  }
}

export async function GET(request: NextRequest) {
  try {
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
      players: room.players.map(cleanPlayer), playerId: me.id,
      myGuesses: Object.entries(ownGuesses).map(([countryCode, name]) => ({ code: countryCode, name }))
    };
    if (room.status === "ended") {
      const results = await Promise.all(room.players.map(async (player) => {
        const guesses = await redis.hgetall<Record<string, string>>(`bran:guesses:${code}:${player.id}`) ?? {};
        return { playerId: player.id, name: player.name, guesses: Object.entries(guesses).map(([countryCode, name]) => ({ code: countryCode, name })) };
      }));
      response.results = results.sort((a, b) => b.guesses.length - a.guesses.length);
    }
    return NextResponse.json(response);
  } catch {
    return error("The room service is unavailable. Try again in a moment.", 503);
  }
}
