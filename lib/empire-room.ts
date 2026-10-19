/**
 * Room-level glue for Empire mode: creates the game on first read after the
 * host starts, applies timeouts lazily, runs actions, and writes with a
 * compare-and-set on a version counter so concurrent requests can't clash.
 */
import type { Redis } from "@upstash/redis";
import { ROOM_TTL_SECONDS } from "@/lib/redis";
import { countryByCode } from "@/lib/countries";
import { geo } from "@/lib/empire/geo";
import { cards } from "@/lib/empire/cards";
import { scoring, largestEmpireGroups } from "@/lib/empire/scoring";
import { actions } from "@/lib/empire/actions";
import { EMPIRE_RULES, type ActionError, type EmpireAction, type EmpireDeps, type EmpireState } from "@/lib/empire/types";

export type EmpireRoom = {
  code: string;
  gameId?: string;
  mode?: string;
  status: "waiting" | "playing" | "ended";
  startedAt: number | null;
  players: { id: string; token: string; name: string; host: boolean }[];
  /** Turn length in seconds picked by the host at creation (15, 20 or 30). */
  turnSeconds?: number;
  empire?: EmpireState;
  empireVersion?: number;
};

/** Writes the new room JSON only if nobody else wrote a newer Empire version meanwhile. */
export const EMPIRE_CAS_SCRIPT = `
  local raw = redis.call('GET', KEYS[1])
  if not raw then return cjson.encode({error='Room not found.'}) end
  local room = cjson.decode(raw)
  if room.status ~= 'playing' or tonumber(room.empireVersion or 0) ~= tonumber(ARGV[1]) then
    return cjson.encode({conflict=true})
  end
  redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))
  return cjson.encode({ok=true})
`;

let rngForTests: (() => number) | null = null;
export function setEmpireRngForTests(rng: (() => number) | null) { rngForTests = rng; }
const deps = (): EmpireDeps => ({ geo, cards, scoring, rng: () => (rngForTests ?? Math.random)() });

export const isEmpireRoom = (room: Pick<EmpireRoom, "gameId" | "mode">) => (room.gameId ?? "countries") === "countries" && room.mode === "empire";

/** Lua's JSON encoder turns empty arrays into {}, so normalise whatever comes back from Redis. */
function normalize(room: EmpireRoom) {
  const list = <V,>(value: unknown): V[] => (Array.isArray(value) ? value as V[] : []);
  const empire = room.empire;
  if (!empire) return room;
  empire.players = list<EmpireState["players"][number]>(empire.players).map((player) => ({ ...player, forts: list<string>(player.forts) }));
  empire.hand = list(empire.hand);
  empire.log = list(empire.log);
  empire.winnerIds = list(empire.winnerIds);
  return room;
}

/** Creates the game if needed and applies expired turns. Mutates `room`. */
function syncEmpire(room: EmpireRoom, now: number) {
  if (room.status !== "playing") return false;
  let changed = false;
  if (!room.empire) {
    room.empire = actions.initEmpire(room.players.map((player) => player.id), room.startedAt ?? now, deps(), room.turnSeconds ? room.turnSeconds * 1000 : undefined);
    changed = true;
  }
  const advanced = actions.advanceTimeouts(room.empire, now, deps());
  if (advanced !== room.empire) { room.empire = advanced; changed = true; }
  if (room.empire.finished) room.status = "ended";
  return changed;
}

async function load(redis: Redis, key: string) {
  const room = await redis.get<EmpireRoom>(key);
  return room ? normalize(room) : null;
}

async function commit(redis: Redis, key: string, expected: number, next: EmpireRoom) {
  next.empireVersion = expected + 1;
  const result = await redis.eval(EMPIRE_CAS_SCRIPT, [key], [String(expected), JSON.stringify(next), String(ROOM_TTL_SECONDS)]);
  const parsed = (typeof result === "string" ? JSON.parse(result) : result) as { ok?: boolean };
  return Boolean(parsed.ok);
}

/** Loads an Empire room with the game created and timeouts applied (and persisted). */
export async function loadSyncedEmpireRoom(redis: Redis, key: string, now: number): Promise<EmpireRoom | null> {
  let room: EmpireRoom | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    room = await load(redis, key);
    if (!room) return null;
    const before = room.empireVersion ?? 0;
    if (!syncEmpire(room, now) || await commit(redis, key, before, room)) return room;
  }
  return room;
}

/** Runs one action against the freshest room, retrying if another request wins the race. */
export async function runEmpireAction(
  redis: Redis, key: string, now: number, playerId: string, action: EmpireAction
): Promise<{ room: EmpireRoom } | ActionError> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const room = await load(redis, key);
    if (!room) return { error: "Room not found.", status: 404 };
    if (room.status !== "playing") return { error: "The game is over.", status: 409 };
    const before = room.empireVersion ?? 0;
    const synced = syncEmpire(room, now);
    if (room.status !== "playing" || !room.empire) {
      if (synced) await commit(redis, key, before, room);
      return { error: "The game is over.", status: 409 };
    }
    const result = actions.applyAction(room.empire, playerId, action, now, deps());
    if ("error" in result) {
      // Persist any timeouts we noticed so other readers see the same turn.
      if (synced) await commit(redis, key, before, room);
      return result;
    }
    room.empire = result;
    if (result.finished) room.status = "ended";
    if (await commit(redis, key, before, room)) return { room };
  }
  return { error: "The turn just changed. Please try again.", status: 409 };
}

const nameOf = (code: string) => countryByCode(code)?.name ?? code;

/** Everything a client needs to draw an Empire room. Never includes tokens. */
export function empireSnapshot(room: EmpireRoom, now: number) {
  const empire = room.empire;
  if (!empire) return { empire: null, countryClaims: {}, claimLog: [] };
  const { scores } = scoring.scoreEmpire(empire, geo);
  // Replay: capitals first, then every claim and successful steal in order.
  const claimLog = [
    ...empire.players.map((player) => ({ code: player.capital, playerId: player.id, points: 1, round: 0, at: room.startedAt ?? 0 })),
    ...empire.log.filter((entry) => (entry.kind === "claim" || entry.kind === "steal") && entry.code)
      .map((entry) => ({ code: entry.code!, playerId: entry.playerId, points: entry.points ?? 1, round: entry.round, at: entry.at }))
  ].map((entry, order) => ({ ...entry, order, name: nameOf(entry.code) }));
  const roundsUntilEvent = EMPIRE_RULES.eventEvery - ((empire.round - 1) % EMPIRE_RULES.eventEvery);
  return {
    empire: {
      round: empire.round, roundCap: EMPIRE_RULES.roundCap, winPoints: EMPIRE_RULES.winPoints,
      currentPlayerId: empire.finished ? null : empire.players[empire.seat]?.id ?? null,
      turnStartedAt: empire.turnStartedAt, turnMs: empire.turnMs ?? EMPIRE_RULES.turnMs, serverNow: now,
      largestGroups: largestEmpireGroups(empire, geo),
      event: empire.event ? { ...empire.event, label: cards.eventLabel(empire.event) } : null,
      nextEventAfterRound: empire.round + roundsUntilEvent - 1,
      hand: empire.hand.map((card) => ({ ...card, label: cards.cardLabel(card) })),
      chosen: empire.chosen,
      players: empire.players.map((player) => ({
        id: player.id, capital: player.capital, capitalName: nameOf(player.capital),
        stealTokens: player.stealTokens, forts: player.forts, fortNames: player.forts.map(nameOf)
      })),
      scores, empireHolder: empire.empireHolder,
      protected: [...scoring.protectedCodes(empire, geo)],
      finished: empire.finished, winnerIds: empire.winnerIds,
      log: empire.log.slice(-8).reverse().map((entry) => ({ ...entry, name: entry.code ? nameOf(entry.code) : null }))
    },
    countryClaims: empire.owners,
    claimLog
  };
}
