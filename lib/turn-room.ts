/**
 * Room-level glue for turn-based modes: lazily applies timeouts, applies a
 * claim or pass to a room, and writes the result with a compare-and-set on the
 * turn number so concurrent requests can never both advance or both claim.
 */
import type { Redis } from "@upstash/redis";
import { ROOM_TTL_SECONDS } from "@/lib/redis";
import { countryByCode } from "@/lib/countries";
import { advanceByTimeouts, createTurnState, currentPlayerId, currentRound, isPlayersTurn, nextTurn, type TurnState } from "@/lib/turns";
import { cardFits, cardLabel, computeAwards, computeScores, dealCard, isDoubleRound, pointsForRound, unclaimedCodes, allCodes, V2_ROUNDS, type Card, type Claim } from "@/lib/turn-rules";

export type TurnRoom = {
  code: string;
  gameId?: string;
  mode?: "live" | "turns" | "empire";
  status: "waiting" | "playing" | "ended";
  startedAt: number | null;
  players: { id: string; token: string; name: string; host: boolean }[];
  turn?: TurnState<Card>;
  claims?: Claim[];
};
export type TurnFailure = { error: string; status: number };

/** Compare-and-set on the turn number: writes the new room JSON only if nobody advanced the turn meanwhile. */
export const TURN_CAS_SCRIPT = `
  local raw = redis.call('GET', KEYS[1])
  if not raw then return cjson.encode({error='Room not found.'}) end
  local room = cjson.decode(raw)
  if room.status ~= 'playing' or not room.turn or tonumber(room.turn.number) ~= tonumber(ARGV[1]) then
    return cjson.encode({conflict=true})
  end
  redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))
  return cjson.encode({ok=true})
`;

let rngForTests: (() => number) | null = null;
export function setTurnRngForTests(rng: (() => number) | null) { rngForTests = rng; }
const rng = () => (rngForTests ?? Math.random)();

export const isTurnsRoom = (room: Pick<TurnRoom, "gameId" | "mode">) => (room.gameId ?? "countries") === "countries" && room.mode === "turns";

/** Lua's JSON encoder turns empty arrays into {}, so normalise whatever comes back from Redis. */
export function normalizeTurnRoom<T extends TurnRoom>(room: T): T {
  const asArray = <V,>(value: unknown): V[] => (Array.isArray(value) ? value as V[] : []);
  room.claims = asArray<Claim>(room.claims);
  if (room.turn) room.turn.order = asArray<string>(room.turn.order);
  return room;
}

export function initialTurnState(playerIds: string[], now: number): TurnState<Card> {
  return createTurnState(playerIds, now, V2_ROUNDS, dealCard(allCodes(), rng));
}

const dealFor = (room: TurnRoom) => () => dealCard(unclaimedCodes(room.claims ?? []), rng);

/** Applies every fully expired turn as a pass. Returns the same room object, mutated. */
export function syncTurnTime(room: TurnRoom, now: number): { room: TurnRoom; changed: boolean } {
  if (room.status !== "playing" || !room.turn || room.turn.finished) return { room, changed: false };
  const { state, advanced } = advanceByTimeouts(room.turn, now, dealFor(room));
  if (!advanced) return { room, changed: false };
  room.turn = state;
  if (state.finished) room.status = "ended";
  return { room, changed: true };
}

function checkTurn(room: TurnRoom, playerId: string): TurnFailure | null {
  if (room.status !== "playing" || !room.turn || room.turn.finished) return { error: "The game has ended.", status: 409 };
  if (!isPlayersTurn(room.turn, playerId)) {
    const current = room.players.find((player) => player.id === currentPlayerId(room.turn!));
    return { error: `It's not your turn. Wait for ${current?.name ?? "the other player"}.`, status: 409 };
  }
  return null;
}

function finishTurn(room: TurnRoom, now: number, exhausted: boolean) {
  room.turn = nextTurn(room.turn!, now, exhausted ? null : dealCard(unclaimedCodes(room.claims ?? []), rng), exhausted);
  if (room.turn.finished) room.status = "ended";
}

/** The current player names a country. Mutates the room on success. */
export function applyClaim(room: TurnRoom, playerId: string, code: string, now: number): TurnFailure | null {
  const failure = checkTurn(room, playerId);
  if (failure) return failure;
  const country = countryByCode(code);
  if (!country) return { error: "That answer is not on the country list.", status: 400 };
  const card = room.turn!.card;
  if (card && !cardFits(card, country.code)) return { error: `${country.name} doesn't fit this card: ${cardLabel(card)}.`, status: 400 };
  const claims = room.claims ?? [];
  const owner = claims.find((claim) => claim.code === country.code);
  if (owner) return { error: owner.playerId === playerId ? "You already claimed that country." : `${country.name} is already claimed.`, status: 409 };
  const round = currentRound(room.turn!);
  claims.push({ code: country.code, playerId, points: pointsForRound(round, room.turn!.totalRounds), round, turn: room.turn!.number, at: now });
  room.claims = claims;
  finishTurn(room, now, unclaimedCodes(claims).length === 0);
  return null;
}

export function applyPass(room: TurnRoom, playerId: string, now: number): TurnFailure | null {
  const failure = checkTurn(room, playerId);
  if (failure) return failure;
  finishTurn(room, now, unclaimedCodes(room.claims ?? []).length === 0);
  return null;
}

export async function loadTurnRoom(redis: Redis, key: string): Promise<TurnRoom | null> {
  const room = await redis.get<TurnRoom>(key);
  return room ? normalizeTurnRoom(room) : null;
}

/** Writes `next` only if the stored turn number still equals `expectedTurn`. */
export async function commitTurnRoom(redis: Redis, key: string, expectedTurn: number, next: TurnRoom): Promise<boolean> {
  const result = await redis.eval(TURN_CAS_SCRIPT, [key], [String(expectedTurn), JSON.stringify(next), String(ROOM_TTL_SECONDS)]);
  const parsed = (typeof result === "string" ? JSON.parse(result) : result) as { ok?: boolean; conflict?: boolean; error?: string };
  return Boolean(parsed.ok);
}

/** Loads a turns room with timeouts applied (and persisted). */
export async function loadSyncedTurnRoom(redis: Redis, key: string, now: number): Promise<TurnRoom | null> {
  let room: TurnRoom | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    room = await loadTurnRoom(redis, key);
    if (!room || !room.turn) return room;
    const before = room.turn.number;
    const { changed } = syncTurnTime(room, now);
    if (!changed || await commitTurnRoom(redis, key, before, room)) return room;
  }
  return room;
}

/** Runs a claim/pass against the freshest room, retrying if another request wins the race. */
export async function runTurnAction(
  redis: Redis, key: string, now: number, action: (room: TurnRoom) => TurnFailure | null
): Promise<{ room: TurnRoom } | TurnFailure> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const room = await loadTurnRoom(redis, key);
    if (!room) return { error: "Room not found.", status: 404 };
    if (!room.turn) return { error: "This room is not in turn-based mode.", status: 409 };
    const before = room.turn.number;
    syncTurnTime(room, now);
    const failure = action(room);
    if (failure) {
      // Persist any timeouts we noticed so other readers see the same turn.
      if (room.turn.number !== before) await commitTurnRoom(redis, key, before, room);
      return failure;
    }
    if (await commitTurnRoom(redis, key, before, room)) return { room };
  }
  return { error: "The turn just changed. Please try again.", status: 409 };
}

/** Everything a client needs to draw a turns-mode room. Never includes tokens. */
export function turnSnapshot(room: TurnRoom, now: number) {
  const turn = room.turn!;
  const claims = room.claims ?? [];
  const playerIds = room.players.map((player) => player.id);
  const scores = computeScores(playerIds, claims);
  const round = currentRound(turn);
  const snapshot: Record<string, unknown> = {
    turn: {
      number: turn.number, round, totalRounds: turn.totalRounds, currentPlayerId: currentPlayerId(turn),
      startedAt: turn.startedAt, turnMs: turn.turnMs, serverNow: now, finished: turn.finished,
      card: turn.card, cardLabel: turn.card ? cardLabel(turn.card) : null,
      doubleRound: isDoubleRound(round, turn.totalRounds)
    },
    scores,
    claimLog: claims.map((claim, order) => ({ ...claim, order, name: countryByCode(claim.code)?.name ?? claim.code })),
    countryClaims: Object.fromEntries(claims.map((claim) => [claim.code, claim.playerId])),
  };
  if (room.status === "ended") {
    snapshot.awards = computeAwards(playerIds, claims, turn.totalRounds);
    snapshot.results = room.players.map((player) => ({
      playerId: player.id, name: player.name, ...scores[player.id],
      guesses: claims.filter((claim) => claim.playerId === player.id)
        .map((claim) => ({ code: claim.code, name: countryByCode(claim.code)?.name ?? claim.code, points: claim.points }))
    })).sort((a, b) => b.total - a.total || b.points - a.points);
  }
  return snapshot;
}
