import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { logIdOf, logKey, parseGameLog } from "@/lib/game-log";
import { isTurnsRoom, type TurnRoom } from "@/lib/turn-room";

export const runtime = "nodejs";

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** The game log of the room's current (or last) turns game. Same authorisation as the room GET; read-only, so no timeouts are applied. */
export async function GET(request: NextRequest) {
  try {
    const redis = getRedis();
    const code = (request.nextUrl.searchParams.get("code") ?? "").toUpperCase();
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!/^[A-Z2-9]{6}$/.test(code) || token.length < 32) return error("Room session is invalid.", 401);
    const room = await redis.get<TurnRoom>(`bran:room:${code}`);
    if (!room) return error("Room not found. It may have expired.", 404);
    if (!room.players.some((player) => player.token === token)) return error("This browser is not in that room.", 403);
    if (!isTurnsRoom(room) || !room.startedAt) return error("This room has no game log.", 404);
    const logId = logIdOf(code, room.startedAt);
    const hash = await redis.hgetall<Record<string, unknown>>(logKey(logId));
    if (!hash || Object.keys(hash).length === 0) return error("No game log for this game (logging may be off).", 404);
    return NextResponse.json(parseGameLog(logId, hash), { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("Room log GET failed:", cause);
    return error("The room service is unavailable. Try again in a moment.", 503);
  }
}
