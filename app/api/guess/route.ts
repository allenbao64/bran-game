import { NextRequest, NextResponse } from "next/server";
import { countryByCode } from "@/lib/countries";
import { championByCode } from "@/lib/champions";
import { gameConfig } from "@/lib/games";
import { getRedis, ROOM_TTL_SECONDS } from "@/lib/redis";

export const runtime = "nodejs";
type Player = { id: string; token: string; name: string; host: boolean };
type Room = { code: string; gameId?: "countries" | "champions"; status: "waiting" | "playing" | "ended"; startedAt: number | null; players: Player[] };

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
    const answer = gameId === "champions" ? championByCode(answerCode) : countryByCode(answerCode.toUpperCase());
    if (!answer) return NextResponse.json({ error: `That answer is not on the ${gameId === "champions" ? "champion" : "country"} list.` }, { status: 400 });
    const player = room.players.find((entry) => entry.token === token);
    if (!player) return NextResponse.json({ error: "This browser is not in that room." }, { status: 403 });
    const roundMs = gameConfig(gameId).durationSeconds * 1000;
    if (room.status !== "playing" || room.startedAt === null || Date.now() >= room.startedAt + roundMs) {
      return NextResponse.json({ error: "The round has ended." }, { status: 409 });
    }
    const guessKey = `bran:guesses:${code}:${player.id}`;
    const added = await redis.hsetnx(guessKey, answer.code, answer.name);
    if (added) await redis.expire(guessKey, ROOM_TTL_SECONDS);
    if (!added) return NextResponse.json({ error: `You already named that ${gameId === "champions" ? "champion" : "country"}.` }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "The room service is unavailable. Try again in a moment." }, { status: 503 });
  }
}
