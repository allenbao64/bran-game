import { NextRequest, NextResponse } from "next/server";
import { countryByCode } from "@/lib/countries";
import { redis, ROOM_TTL_SECONDS } from "@/lib/redis";

export const runtime = "nodejs";
const ROUND_MS = 10 * 60 * 1000;
type Player = { id: string; token: string; name: string; host: boolean };
type Room = { code: string; status: "waiting" | "playing" | "ended"; startedAt: number | null; players: Player[] };

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const code = typeof body.code === "string" ? body.code.toUpperCase() : "";
    const token = typeof body.token === "string" ? body.token : "";
    const countryCode = typeof body.countryCode === "string" ? body.countryCode.toUpperCase() : "";
    const country = countryByCode(countryCode);
    if (!/^[A-Z2-9]{6}$/.test(code) || token.length < 32 || !country) {
      return NextResponse.json({ error: "That answer is not on the country list." }, { status: 400 });
    }
    const key = `bran:room:${code}`;
    const room = await redis.get<Room>(key);
    if (!room) return NextResponse.json({ error: "Room not found." }, { status: 404 });
    const player = room.players.find((entry) => entry.token === token);
    if (!player) return NextResponse.json({ error: "This browser is not in that room." }, { status: 403 });
    if (room.status !== "playing" || room.startedAt === null || Date.now() >= room.startedAt + ROUND_MS) {
      return NextResponse.json({ error: "The round has ended." }, { status: 409 });
    }
    const guessKey = `bran:guesses:${code}:${player.id}`;
    const added = await redis.hsetnx(guessKey, country.code, country.name);
    if (added) await redis.expire(guessKey, ROOM_TTL_SECONDS);
    if (!added) return NextResponse.json({ error: "You already named that country." }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "The room service is unavailable. Try again in a moment." }, { status: 503 });
  }
}
