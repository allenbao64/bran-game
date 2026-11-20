import { NextRequest, NextResponse } from "next/server";
import { errorDetail } from "@/lib/error-detail";
import { getRedis } from "@/lib/redis";
import type { Empire2Action } from "@/lib/empire2-playtest";
import { empire2LogExport, isEmpire2Room, loadSyncedEmpire2Room, runEmpire2Action, type Empire2Room } from "@/lib/empire2-room";

export const runtime = "nodejs";

const error = (message: string, status = 400) => NextResponse.json({ error: message }, { status });
const CODE = /^[A-Z2-9]{6}$/;
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;

/** Checks the action's shape only. The engine checks everything else (section 2.8). */
function parseAction(value: unknown): Empire2Action | null {
  if (!value || typeof value !== "object") return null;
  const action = value as Record<string, unknown>;
  switch (action.type) {
    case "pickCapital":
    case "pickFoothold":
    case "expand":
    case "colonize":
      return text(action.code, 8) ? { type: action.type, code: action.code } : null;
    case "city":
    case "annex":
      return text(action.code, 8) && text(action.capital, 80)
        ? { type: action.type, code: action.code, capital: action.capital.trim() }
        : null;
    case "pickBoom":
      return text(action.region, 40) ? { type: "pickBoom", region: action.region } : null;
    case "endTurn":
      return { type: "endTurn" };
    default:
      return null;
  }
}

/** One Empire 2.0 action by a player of the room. */
export async function POST(request: NextRequest) {
  try {
    const redis = getRedis();
    const body = await request.json().catch(() => null) as Record<string, any> | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) return error("That action isn't valid.");
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    const token = typeof body.token === "string" ? body.token : "";
    if (!CODE.test(code) || token.length < 32) return error("Room session is invalid.", 401);
    const action = parseAction(body.action);
    if (!action) return error("That action isn't valid.");
    const key = `bran:room:${code}`;
    const room = await redis.get<Empire2Room>(key);
    if (!room) return error("Room not found.", 404);
    const player = room.players.find((entry) => entry.token === token);
    if (!player) return error("This browser is not in that room.", 403);
    if (!isEmpire2Room(room)) return error("This room is not in Empire 2.0 mode.", 409);
    const outcome = await runEmpire2Action(redis, key, Date.now(), player.id, action);
    if ("error" in outcome) return error(outcome.error, outcome.status);
    return NextResponse.json({ ok: true, status: outcome.room.status });
  } catch (cause) {
    console.error("Empire 2.0 POST failed:", cause);
    return error(`The room service is unavailable${errorDetail(cause)}. Try again in a moment.`, 503);
  }
}

/** The members-only game log (engine log, result, round-start points and final standings). */
export async function GET(request: NextRequest) {
  try {
    const redis = getRedis();
    const code = (request.nextUrl.searchParams.get("code") ?? "").trim().toUpperCase();
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!CODE.test(code) || token.length < 32) return error("Room session is invalid.", 401);
    const key = `bran:room:${code}`;
    const found = await redis.get<Empire2Room>(key);
    if (!found) return error("Room not found.", 404);
    if (!found.players.some((entry) => entry.token === token)) return error("This browser is not in that room.", 403);
    if (!isEmpire2Room(found)) return error("This room is not in Empire 2.0 mode.", 409);
    if (found.status === "waiting") return error("The game hasn't started yet.", 409);
    const now = Date.now();
    const room = await loadSyncedEmpire2Room(redis, key, now);
    if (!room) return error("Room not found.", 404);
    return NextResponse.json(empire2LogExport(room, now));
  } catch (cause) {
    console.error("Empire 2.0 GET failed:", cause);
    return error(`The room service is unavailable${errorDetail(cause)}. Try again in a moment.`, 503);
  }
}
