/**
 * Room-level glue for turn-based modes: lazily applies timeouts, applies a
 * claim or pass to a room, and writes the result with a compare-and-set on the
 * turn number so concurrent requests can never both advance or both claim.
 */
import type { Redis } from "@upstash/redis";
import { ROOM_TTL_SECONDS } from "@/lib/redis";
import {
  buildEndRecord, buildStartRecord, buildTurnEvent, buildWrongEvent, endsRound, flushQueuedLog, isGameLoggingEnabled, logIdOf, queueLog, totalsOf,
  writeGameEnd, writeGameStart, type GameEndReason, type TurnOutcome, type WrongGuessEvent
} from "@/lib/game-log";
import { countryByCode } from "@/lib/countries";
import { advanceByTimeouts, createTurnState, currentPlayerId, currentRound, isPlayersTurn, nextTurn, type PhaseEnd, type TurnState } from "@/lib/turns";
import {
  allCodes, cardLabel, computeAwards, computeScores, DEFAULT_TURN_ROUNDS, DEFAULT_TURN_SECONDS, dealCards, isDoubleRound, isStartClaim, largestGroupsByPlayer,
  matchCount, pickStartCountries, pointsForClaim, pointsForRound, RECENT_CARDS, SUDDEN_DEATH_ROUNDS, topPlayers, unclaimedCodes, type Card, type Claim, type Deal,
  LEGACY_TURN_ROUNDS
} from "@/lib/turn-rules";

export const MAX_RECENT_GUESSES = 12;
/** `both` is set on a claim that fit every card of a two-card deal. */
export type GuessEvent = { playerId: string; kind: "claimed" | "wrong" | "passed" | "timeout"; code: string | null; text: string; points: number; at: number; both?: boolean };

export type TurnRoom = {
  code: string;
  gameId?: string;
  mode?: "live" | "turns" | "empire";
  status: "waiting" | "playing" | "ended";
  startedAt: number | null;
  players: { id: string; token: string; name: string; host: boolean }[];
  /** Turn length picked by the host at creation (turn-based rooms only). */
  turnSeconds?: number;
  /** Rounds picked by the host at creation (15, 20 or 30). Missing on rooms saved before the choice: those ran 12. */
  rounds?: number;
  turn?: TurnState<Deal>;
  claims?: Claim[];
  /** Each player's free starting country (also a 0-point claim in round 0). Missing on older rooms. */
  startCountries?: Record<string, string>;
  /** Newest first, at most MAX_RECENT_GUESSES. Missing on older rooms. */
  recentGuesses?: GuessEvent[];
  /** Cards dealt lately, newest first (at most RECENT_CARDS), so dealing can vary kinds. */
  recentCards?: Card[];
};
/** `persist` saves the room even though the action failed (a logged wrong guess). */
export type TurnFailure = { error: string; status: number; persist?: boolean };
/** What a successful claim returns to the client (`POST /api/guess`). */
export type ClaimResult = { code: string; points: number; fit: number; cards: number; both: boolean; sudden: boolean };

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

/** Compare-and-set for starting a room: writes ARGV[2] only while the room is still waiting with the same number of players (ARGV[1]), so a join or a second Start can't be overwritten. */
export const START_CAS_SCRIPT = `
  local raw = redis.call('GET', KEYS[1])
  if not raw then return cjson.encode({error='Room not found. Check the code.'}) end
  local room = cjson.decode(raw)
  if room.status ~= 'waiting' or #room.players ~= tonumber(ARGV[1]) then
    return cjson.encode({conflict=true})
  end
  redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))
  return cjson.encode({ok=true})
`;

let rngForTests: (() => number) | null = null;
export function setTurnRngForTests(rng: (() => number) | null) { rngForTests = rng; }
const rng = () => (rngForTests ?? Math.random)();

export const isTurnsRoom = (room: Pick<TurnRoom, "gameId" | "mode">) => (room.gameId ?? "countries") === "countries" && room.mode === "turns";

/** The cards of the current deal. Reads `deal`, falling back to a legacy single `card` (so un-normalised rooms in tests still work). [] when finished. */
export function dealOf(turn: TurnState<Deal> & { card?: Card | null }): Deal {
  if (turn.finished) return [];
  if (Array.isArray(turn.deal)) return turn.deal;
  return turn.card && typeof turn.card === "object" && "kind" in turn.card ? [turn.card] : [];
}

/** Lua's JSON encoder turns empty arrays into {}, so normalise whatever comes back from Redis. */
export function normalizeTurnRoom<T extends TurnRoom>(room: T): T {
  const asArray = <V,>(value: unknown): V[] => (Array.isArray(value) ? value as V[] : []);
  room.claims = asArray<Claim>(room.claims);
  room.recentGuesses = asArray<GuessEvent>(room.recentGuesses);
  room.recentCards = asArray<Card>(room.recentCards);
  if (Array.isArray(room.startCountries)) room.startCountries = {};
  if (room.turn) {
    const turn = room.turn as TurnState<Deal> & { card?: unknown };
    // Rooms saved before two-card turns hold one `card`; Lua turns an empty deal into {}, which is not an array.
    if (!Array.isArray(turn.deal)) {
      const legacy = turn.card;
      turn.deal = legacy && typeof legacy === "object" && "kind" in legacy ? [legacy as Card] : null;
    }
    delete turn.card;
    turn.order = asArray<string>(turn.order);
    if (turn.sudden) turn.sudden.order = asArray<string>(turn.sudden.order);
  }
  return room;
}

/** `taken` are the starting countries, which are not up for grabs on the first deal. */
export function initialTurnState(playerIds: string[], now: number, turnSeconds = DEFAULT_TURN_SECONDS, rounds = DEFAULT_TURN_ROUNDS, taken: string[] = []): TurnState<Deal> {
  return createTurnState(playerIds, now, rounds, dealCards(allCodes().filter((code) => !taken.includes(code)), rng), turnSeconds * 1000);
}
/** Starting countries for a new turns room: far apart, in different subregions, none an island. */
export const pickTurnStarts = (count: number) => pickStartCountries(count, rng);

/** Deals the next turn's cards and remembers them. Rooms from before the history existed seed it with the current deal. */
function dealNext(room: TurnRoom): Deal {
  const recent = room.recentCards?.length ? room.recentCards : dealOf(room.turn!);
  const deal = dealCards(unclaimedCodes(room.claims ?? []), rng, recent);
  room.recentCards = [...deal, ...recent].slice(0, RECENT_CARDS);
  return deal;
}

/** Decides at the end of a phase whether a sudden-death round follows, and who plays it. */
function phaseEnd(room: TurnRoom): PhaseEnd<Deal> {
  return (state) => {
    const ids = room.players.map((player) => player.id);
    const leaders = topPlayers(ids, computeScores(ids, room.claims ?? []));
    const prev = state.sudden;
    if (leaders.length < 2) return null;                       // one winner (or nobody): the game ends
    if (prev && prev.round >= prev.maxRounds) return null;     // all sudden rounds played, still tied: they share the win
    const order = state.order.filter((id) => leaders.includes(id) && (!prev || prev.order.includes(id)));
    if (order.length < 2) return null;
    return { order, startNumber: state.number, round: prev ? prev.round + 1 : 1, maxRounds: SUDDEN_DEATH_ROUNDS };
  };
}

function logGuess(room: TurnRoom, event: GuessEvent) {
  room.recentGuesses = [event, ...(room.recentGuesses ?? [])].slice(0, MAX_RECENT_GUESSES);
}

// Game log (turn-based mode). Every helper is behind the kill switch and swallows its own errors: logging never fails a request.
const dealOrNull = (turn: TurnState<Deal>) => { const deal = dealOf(turn); return deal.length ? deal : null; };

/** Queues the event for a finished turn. `before` is the turn state BEFORE nextTurn. Call AFTER room.claims holds this turn's claim. `unclaimed` is read lazily, only when logging is on. */
function logTurn(room: TurnRoom, before: TurnState<Deal>, outcome: TurnOutcome, playerId: string, at: number, unclaimed: () => string[], claim?: { code: string; points: number }) {
  if (!isGameLoggingEnabled()) return;
  try {
    const totals = endsRound(before) ? totalsOf(computeScores(room.players.map((player) => player.id), room.claims ?? [])) : undefined;
    queueLog(room, buildTurnEvent({ turn: before, deal: dealOrNull(before), playerId, outcome, at, unclaimed: unclaimed(), claim, totals }));
  } catch (cause) {
    console.error("Game log build failed:", cause);
  }
}

function logWrong(room: TurnRoom, playerId: string, code: string, why: WrongGuessEvent["why"], now: number) {
  if (!isGameLoggingEnabled()) return;
  try {
    queueLog(room, buildWrongEvent({ turn: room.turn!, deal: dealOrNull(room.turn!), playerId, code, why, at: now }));
  } catch (cause) {
    console.error("Game log build failed:", cause);
  }
}

/** Queues the end record when the game just finished by itself. */
function logEnd(room: TurnRoom, reason: GameEndReason, endedAt: number) {
  if (!isGameLoggingEnabled()) return;
  try {
    if (room.startedAt === null || !room.turn) return;
    const ids = room.players.map((player) => player.id);
    const scores = computeScores(ids, room.claims ?? []);
    queueLog(room, buildEndRecord({ reason, turn: room.turn, scores, winners: topPlayers(ids, scores), startedAt: room.startedAt, endedAt }));
  } catch (cause) {
    console.error("Game log build failed:", cause);
  }
}

/** Applies every fully expired turn as a pass. Returns the same room object, mutated. */
export function syncTurnTime(room: TurnRoom, now: number): { room: TurnRoom; changed: boolean } {
  if (room.status !== "playing" || !room.turn || room.turn.finished) return { room, changed: false };
  let unclaimed: string[] | null = null;
  const getUnclaimed = () => (unclaimed ??= unclaimedCodes(room.claims ?? []));
  const { state, advanced } = advanceByTimeouts(room.turn, now, () => dealNext(room), phaseEnd(room), ({ playerId, endedAt, state: expiring }) => {
    logGuess(room, { playerId, kind: "timeout", code: null, text: "ran out of time", points: 0, at: endedAt });
    logTurn(room, expiring, "timeout", playerId, endedAt, getUnclaimed);
  });
  if (!advanced) return { room, changed: false };
  room.turn = state;
  if (state.finished) room.status = "ended";
  if (state.finished) logEnd(room, "turns_played", state.startedAt);
  return { room, changed: true };
}

function joinNames(names: string[]) {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function checkTurn(room: TurnRoom, playerId: string): TurnFailure | null {
  if (room.status !== "playing" || !room.turn || room.turn.finished) return { error: "The game has ended.", status: 409 };
  const sudden = room.turn.sudden;
  if (sudden && !sudden.order.includes(playerId)) {
    const names = sudden.order.map((id) => room.players.find((player) => player.id === id)?.name ?? "the other player");
    return { error: `Sudden death: only ${joinNames(names)} play.`, status: 409 };
  }
  if (!isPlayersTurn(room.turn, playerId)) {
    const current = room.players.find((player) => player.id === currentPlayerId(room.turn!));
    return { error: `It's not your turn. Wait for ${current?.name ?? "the other player"}.`, status: 409 };
  }
  return null;
}

function finishTurn(room: TurnRoom, now: number, exhausted: boolean) {
  room.turn = nextTurn(room.turn!, now, exhausted ? null : dealNext(room), exhausted, phaseEnd(room));
  if (room.turn.finished) room.status = "ended";
  if (room.turn.finished) logEnd(room, exhausted ? "board_exhausted" : "turns_played", now);
}

/** The current player names a country. Mutates the room on success. */
export function applyClaim(room: TurnRoom, playerId: string, code: string, now: number): TurnFailure | null {
  const failure = checkTurn(room, playerId);
  if (failure) return failure;
  const country = countryByCode(code);
  if (!country) return { error: "That answer is not on the country list.", status: 400 };
  const claims = room.claims ?? [];
  const wrong = (text: string, error: string, status: number, why: WrongGuessEvent["why"]): TurnFailure => {
    logGuess(room, { playerId, kind: "wrong", code: country.code, text, points: 0, at: now });
    logWrong(room, playerId, country.code, why, now);
    return { error, status, persist: true };
  };
  const owner = claims.find((claim) => claim.code === country.code);
  if (owner) {
    const ownerName = room.players.find((player) => player.id === owner.playerId)?.name ?? "someone";
    return owner.playerId === playerId ? wrong("already yours", "You already claimed that country.", 409, "own")
      : wrong(`already ${ownerName}'s`, `${country.name} is already claimed.`, 409, "taken");
  }
  const turn = room.turn!;
  const deal = dealOf(turn);
  const matched = matchCount(deal, country.code);
  if (deal.length && matched === 0) {
    return wrong("doesn't fit", deal.length === 1
      ? `${country.name} doesn't fit this card: ${cardLabel(deal[0])}.`
      : `${country.name} doesn't fit either card: ${deal.map(cardLabel).join(" / ")}.`, 400, "no_fit");
  }
  const sudden = Boolean(turn.sudden);
  const round = sudden ? turn.totalRounds + turn.sudden!.round : currentRound(turn);
  const points = pointsForClaim(matched, deal.length, round, turn.totalRounds, sudden);
  const unclaimedBefore = isGameLoggingEnabled() ? unclaimedCodes(claims) : [];   // before the push; only needed for the log
  claims.push({ code: country.code, playerId, points, round, turn: turn.number, at: now, fit: matched, ...(sudden ? { sudden: true } : {}) });
  room.claims = claims;
  const both = deal.length >= 2 && matched === deal.length;
  logGuess(room, { playerId, kind: "claimed", code: country.code, text: country.name, points, at: now, ...(both ? { both: true } : {}) });
  logTurn(room, turn, "claim", playerId, now, () => unclaimedBefore, { code: country.code, points });
  finishTurn(room, now, unclaimedCodes(claims).length === 0);
  return null;
}

export function applyPass(room: TurnRoom, playerId: string, now: number): TurnFailure | null {
  const failure = checkTurn(room, playerId);
  if (failure) return failure;
  logGuess(room, { playerId, kind: "passed", code: null, text: "passed", points: 0, at: now });
  logTurn(room, room.turn!, "pass", playerId, now, () => unclaimedCodes(room.claims ?? []));
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
  const ok = Boolean(parsed.ok);
  // Only the request whose compare-and-set succeeded writes the records it queued (see flushQueuedLog).
  if (ok && next.startedAt) await flushQueuedLog(redis, next, logIdOf(next.code, next.startedAt));
  return ok;
}

/** Writes the started room only if it is still waiting with `expectedPlayers` players. Returns "ok", "conflict" (someone joined or started meanwhile) or "missing". */
export async function commitRoomStart(redis: Redis, key: string, expectedPlayers: number, next: object): Promise<"ok" | "conflict" | "missing"> {
  const result = await redis.eval(START_CAS_SCRIPT, [key], [String(expectedPlayers), JSON.stringify(next), String(ROOM_TTL_SECONDS)]);
  const parsed = (typeof result === "string" ? JSON.parse(result) : result) as { ok?: boolean; conflict?: boolean; error?: string };
  if (parsed.ok) return "ok";
  return parsed.error ? "missing" : "conflict";
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
      if (failure.persist || room.turn.number !== before) await commitTurnRoom(redis, key, before, room);
      return failure;
    }
    if (await commitTurnRoom(redis, key, before, room)) return { room };
  }
  return { error: "The turn just changed. Please try again.", status: 409 };
}

/** After a successful start of a turns room. `players` = started.players from the start script, `starts` = the picked start countries (same index as players, as the Lua start script assigns them). */
export async function logGameStart(redis: Redis, room: TurnRoom, started: { startedAt: number; players: { id: string; name: string; host: boolean }[] }, starts: string[]): Promise<void> {
  if (!isGameLoggingEnabled()) return;
  try {
    const record = buildStartRecord({
      logId: logIdOf(room.code, started.startedAt),
      room: room.code,
      startedAt: started.startedAt,
      turnSeconds: room.turnSeconds ?? DEFAULT_TURN_SECONDS,
      rounds: room.rounds ?? LEGACY_TURN_ROUNDS,
      players: started.players,
      startCountries: Object.fromEntries(started.players.flatMap((player, index) => (starts[index] ? [[player.id, starts[index]]] : []))),
    });
    await writeGameStart(redis, record);
  } catch (cause) {
    console.error("Game log build failed:", cause);
  }
}

/** After the host ended the game (script returned ok). Reads the room once; does nothing unless it is a turns room with a turn state. */
export async function logHostEnd(redis: Redis, key: string): Promise<void> {
  if (!isGameLoggingEnabled()) return;
  try {
    const room = await loadTurnRoom(redis, key);
    if (!room || !isTurnsRoom(room) || !room.turn || !room.startedAt) return;
    const ids = room.players.map((player) => player.id);
    const scores = computeScores(ids, room.claims ?? []);
    await writeGameEnd(redis, logIdOf(room.code, room.startedAt), buildEndRecord({
      reason: "host_ended", turn: room.turn, scores, winners: topPlayers(ids, scores), startedAt: room.startedAt, endedAt: Date.now()
    }));
  } catch (cause) {
    console.error("Game log build failed:", cause);
  }
}

/** Everything a client needs to draw a turns-mode room. Never includes tokens. */
export function turnSnapshot(room: TurnRoom, now: number) {
  const turn = room.turn!;
  const claims = room.claims ?? [];
  const played = claims.filter((claim) => !isStartClaim(claim));
  const playerIds = room.players.map((player) => player.id);
  const scores = computeScores(playerIds, claims);
  const round = currentRound(turn);
  const sudden = turn.sudden ?? null;
  // Sudden-death claims are never doubled: they are priced at the sudden round's own (non-doubling) round number.
  const pointRound = sudden ? turn.totalRounds + sudden.round : round;
  const shownCards = dealOf(turn).map((card) => ({ ...card, label: cardLabel(card) }));
  const snapshot: Record<string, unknown> = {
    turn: {
      number: turn.number, round, totalRounds: turn.totalRounds, currentPlayerId: currentPlayerId(turn),
      startedAt: turn.startedAt, turnMs: turn.turnMs, serverNow: now, finished: turn.finished,
      cards: shownCards,
      // LEGACY, remove one deploy after the two-card release: tabs still running the old client read `card` and
      // `cardLabel` (main's shape: a card object or null, and a label string or null) and show "No card" without them.
      // `cardLabel` joins every label so a stale tab shows the whole deal. Nothing in the new client reads these two fields.
      card: shownCards[0] ?? null,
      cardLabel: shownCards.length ? shownCards.map((card) => card.label).join(" or ") : null,
      doubleRound: !sudden && isDoubleRound(round, turn.totalRounds),
      pointsOne: pointsForClaim(1, 1, pointRound, turn.totalRounds, Boolean(sudden)),
      pointsBoth: pointsForClaim(2, 2, pointRound, turn.totalRounds, Boolean(sudden)),
      sudden: sudden ? { round: sudden.round, maxRounds: sudden.maxRounds, playerIds: [...sudden.order] } : null,
    },
    scores,
    turnSeconds: Math.round(turn.turnMs / 1000),
    largestGroups: largestGroupsByPlayer(playerIds, claims),
    startCountries: room.startCountries ?? {},
    recentGuesses: room.recentGuesses ?? [],
    claimLog: played.map((claim, order) => ({ ...claim, order, name: countryByCode(claim.code)?.name ?? claim.code })),
    countryClaims: Object.fromEntries(claims.map((claim) => [claim.code, claim.playerId])),
  };
  if (room.status === "ended") {
    snapshot.awards = computeAwards(playerIds, claims, turn.totalRounds);
    snapshot.results = room.players.map((player) => ({
      playerId: player.id, name: player.name, ...scores[player.id],
      guesses: played.filter((claim) => claim.playerId === player.id)
        .map((claim) => ({ code: claim.code, name: countryByCode(claim.code)?.name ?? claim.code, points: claim.points }))
    })).sort((a, b) => b.total - a.total || b.points - a.points);
    snapshot.winners = topPlayers(playerIds, scores);
  }
  return snapshot;
}
