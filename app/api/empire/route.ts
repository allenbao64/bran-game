import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { isEmpireRoom, runEmpireAction, type EmpireRoom } from "@/lib/empire-room";
import type { EmpireAction } from "@/lib/empire/types";

export const runtime = "nodejs";

const error = (message: string, status = 400) => NextResponse.json({ error: message }, { status });
const text = (value: unknown) => typeof value === "string" && value.trim().length > 0 && value.length <= 80;

function parseAction(value: unknown): EmpireAction | null {
  if (!value || typeof value !== "object") return null;
  const action = value as Record<string, unknown>;
  switch (action.type) {
    case "pick": return Number.isInteger(action.index) ? { type: "pick", index: action.index as number } : null;
    case "claim": return text(action.code) ? { type: "claim", code: (action.code as string).toUpperCase() } : null;
    case "fortify": return text(action.code) ? { type: "fortify", code: (action.code as string).toUpperCase() } : null;
    case "steal": return text(action.code) && typeof action.capital === "string" && action.capital.length <= 80
      ? { type: "steal", code: (action.code as string).toUpperCase(), capital: action.capital } : null;
    case "pass": return { type: "pass" };
    default: return null;
  }
}

/** One Empire action by the current player: pick, claim, steal, fortify or pass. */
export async function POST(request: NextRequest) {
  try {
    const redis = getRedis();
    const body = await request.json();
    const code = typeof body.code === "string" ? body.code.toUpperCase() : "";
    const token = typeof body.token === "string" ? body.token : "";
    if (!/^[A-Z2-9]{6}$/.test(code) || token.length < 32) return error("Room session is invalid.", 401);
    const action = parseAction(body.action);
    if (!action) return error("That action isn't valid.");
    const key = `bran:room:${code}`;
    const room = await redis.get<EmpireRoom>(key);
    if (!room) return error("Room not found.", 404);
    const player = room.players.find((entry) => entry.token === token);
    if (!player) return error("This browser is not in that room.", 403);
    if (!isEmpireRoom(room)) return error("This room is not in Empire mode.", 409);
    const outcome = await runEmpireAction(redis, key, Date.now(), player.id, action);
    if ("error" in outcome) return error(outcome.error, outcome.status);
    return NextResponse.json({ ok: true, status: outcome.room.status });
  } catch {
    return error("The room service is unavailable. Try again in a moment.", 503);
  }
}
