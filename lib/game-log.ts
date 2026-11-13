/**
 * Per-game log for the turn-based mode: one record per finished turn, one per wrong guess, a start and an end record.
 * Stored in a Redis hash per game, separately from the room. Records are built by pure functions, queued on the room
 * object by the turn mutators, and written by `flushQueuedLog` / `writeGameStart` / `writeGameEnd`. Logging never
 * throws into a request: every writer swallows its errors and gives up after LOG_WRITE_TIMEOUT_MS.
 * Pure parts (builders, parser) take no Redis, env or clock, except the kill switch, which reads the env by argument.
 */
import type { Redis } from "@upstash/redis";
import { LOG_TTL_SECONDS } from "@/lib/redis";
import { cardFits, cardLabel, fittingAll, fittingCodes, type Card, type Deal, type Score } from "@/lib/turn-rules";
import { roundOfTurn, type TurnState } from "@/lib/turns";

export const LOG_VERSION = 1;
export const LOG_INDEX_KEY = "bran:glog:index";
export const LOG_WRITE_TIMEOUT_MS = 800;
export const logKey = (logId: string) => `bran:glog:${logId}`;
export const logIdOf = (code: string, startedAt: number) => `${code}-${startedAt}`;
export const LOG_ID_PATTERN = /^[A-Z2-9]{6}-\d{10,15}$/;

/** On unless GAME_LOGGING is off|0|false|no (case-insensitive, trimmed). */
export function isGameLoggingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const value = (env.GAME_LOGGING ?? "").trim().toLowerCase();
  return !["off", "0", "false", "no"].includes(value);
}

/** fit = unclaimed countries that fit this card (wild: all of them) */
export type LogCard = { kind: Card["kind"]; label: string; fit: number };

export type TurnOutcome = "claim" | "pass" | "timeout";
export type TurnLogEvent = {
  t: "turn";
  n: number;                    // turn.number, 0-based, unique per game: this is the dedupe key
  round: number;                // same convention as Claim.round: sudden round k = totalRounds + k
  sudden: boolean;
  pid: string;                  // acting player
  outcome: TurnOutcome;
  ms: number;                   // claim/pass: now - turn.startedAt (>= 0). timeout: turnMs
  at: number;                   // epoch ms the turn ended (timeout: startedAt + turnMs)
  unclaimed: number;            // countries unclaimed while the turn was played
  deal: LogCard[] | null;       // null = never dealt/shown (timeout catch-up beyond the first expired turn)
  fitBoth: number | null;       // unclaimed countries fitting EVERY card; null unless the deal has 2+ cards
  claim?: { code: string; points: number; fit: number; both: boolean; hit: number[] };  // outcome "claim" only; hit = indexes into deal of the cards the country fit
  totals?: Record<string, number>;  // total score per player after this turn; ONLY on the turn that ends a round
};

export type WrongGuessEvent = {
  t: "wrong";
  n: number; round: number; sudden: boolean;
  pid: string;
  code: string;                 // the (valid) country the player named
  why: "no_fit" | "taken" | "own";   // doesn't fit the cards | already owned by someone else | already owned by the guesser
  kinds: string[];              // card kinds of the deal at that moment ([] if none)
  ms: number;                   // now - turn.startedAt (>= 0)
  at: number;
};

export type GameStartRecord = {
  t: "start"; v: typeof LOG_VERSION;
  logId: string; room: string; startedAt: number; mode: "turns";
  turnSeconds: number; rounds: number;
  players: { id: string; name: string; host: boolean }[];   // turn order; NO token
  startCountries: Record<string, string>;                    // playerId -> country code
};

export type GameEndReason = "turns_played" | "board_exhausted" | "host_ended";
export type GameEndRecord = {
  t: "end";
  endedAt: number;
  reason: GameEndReason;
  turnsPlayed: number;          // turn.number when the game ended (host_ended: the interrupted turn is not counted)
  suddenRounds: number;         // 0 = no sudden death; else turn.sudden.round (rounds actually played)
  winners: string[];            // topPlayers(...): several = shared win
  scores: Record<string, { points: number; bonus: number; total: number; territory: number }>;
  durationMs: number;           // endedAt - startedAt
};
export type LogRecord = GameStartRecord | TurnLogEvent | WrongGuessEvent | GameEndRecord;

export const START_FIELD = "start", END_FIELD = "end";
const pad = (n: number) => String(n).padStart(4, "0");
export const turnField = (n: number) => `t:${pad(n)}`;
export const wrongField = (n: number, at: number, code: string) => `w:${pad(n)}:${at}:${code}`;
export function fieldOf(record: LogRecord): string {
  switch (record.t) {
    case "start": return START_FIELD;
    case "end": return END_FIELD;
    case "turn": return turnField(record.n);
    case "wrong": return wrongField(record.n, record.at, record.code);
  }
}

/** True when `turn` (the state BEFORE it finishes) is the last turn of its round: normal phase (turn.number + 1) % order.length === 0; sudden phase turn.number - sudden.startNumber + 1 >= sudden.order.length. */
export function endsRound(turn: TurnState<unknown>): boolean {
  if (turn.sudden) return turn.number - turn.sudden.startNumber + 1 >= turn.sudden.order.length;
  return (turn.number + 1) % turn.order.length === 0;
}
export const roundOfState = (turn: TurnState<unknown>) => turn.sudden ? turn.totalRounds + turn.sudden.round : roundOfTurn(turn, turn.number);

const dealOrNull = (deal: Deal | null | undefined): Deal | null => (deal && deal.length ? deal : null);

export function buildTurnEvent(input: {
  turn: TurnState<Deal>;
  deal: Deal | null;
  playerId: string; outcome: TurnOutcome; at: number;
  unclaimed: string[];
  claim?: { code: string; points: number };
  totals?: Record<string, number>;
}): TurnLogEvent {
  const deal = dealOrNull(input.deal);
  const unclaimed = input.unclaimed;
  const event: TurnLogEvent = {
    t: "turn",
    n: input.turn.number,
    round: roundOfState(input.turn),
    sudden: Boolean(input.turn.sudden),
    pid: input.playerId,
    outcome: input.outcome,
    ms: input.outcome === "timeout" ? input.turn.turnMs : Math.max(0, input.at - input.turn.startedAt),
    at: input.at,
    unclaimed: unclaimed.length,
    deal: deal ? deal.map((card) => ({ kind: card.kind, label: cardLabel(card), fit: fittingCodes(card, unclaimed).length })) : null,
    fitBoth: deal && deal.length >= 2 ? fittingAll(deal, unclaimed).length : null,
  };
  if (input.claim) {
    const hit = deal ? deal.flatMap((card, i) => (cardFits(card, input.claim!.code) ? [i] : [])) : [];
    event.claim = {
      code: input.claim.code,
      points: input.claim.points,
      fit: hit.length,
      both: Boolean(deal && deal.length >= 2 && hit.length === deal.length),
      hit,
    };
  }
  if (input.totals) event.totals = { ...input.totals };
  return event;
}

export function buildWrongEvent(input: { turn: TurnState<Deal>; deal: Deal | null; playerId: string; code: string; why: WrongGuessEvent["why"]; at: number }): WrongGuessEvent {
  const deal = dealOrNull(input.deal);
  return {
    t: "wrong",
    n: input.turn.number,
    round: roundOfState(input.turn),
    sudden: Boolean(input.turn.sudden),
    pid: input.playerId,
    code: input.code,
    why: input.why,
    kinds: deal ? deal.map((card) => card.kind) : [],
    ms: Math.max(0, input.at - input.turn.startedAt),
    at: input.at,
  };
}

export function buildStartRecord(input: { logId: string; room: string; startedAt: number; turnSeconds: number; rounds: number; players: { id: string; name: string; host: boolean }[]; startCountries: Record<string, string> }): GameStartRecord {
  return {
    t: "start",
    v: LOG_VERSION,
    logId: input.logId,
    room: input.room,
    startedAt: input.startedAt,
    mode: "turns",
    turnSeconds: input.turnSeconds,
    rounds: input.rounds,
    players: input.players.map((player) => ({ id: player.id, name: player.name, host: player.host })),
    startCountries: { ...input.startCountries },
  };
}

export function buildEndRecord(input: { reason: GameEndReason; turn: TurnState<unknown>; scores: Record<string, Score>; winners: string[]; startedAt: number; endedAt: number }): GameEndRecord {
  const scores: GameEndRecord["scores"] = {};
  for (const [id, score] of Object.entries(input.scores)) {
    scores[id] = { points: score.points, bonus: score.bonusTotal, total: score.total, territory: score.territory };
  }
  return {
    t: "end",
    endedAt: input.endedAt,
    reason: input.reason,
    turnsPlayed: input.turn.number,
    suddenRounds: input.turn.sudden?.round ?? 0,
    winners: [...input.winners],
    scores,
    durationMs: Math.max(0, input.endedAt - input.startedAt),
  };
}

export const totalsOf = (scores: Record<string, Score>): Record<string, number> =>
  Object.fromEntries(Object.entries(scores).map(([id, score]) => [id, score.total]));

// Records waiting for the room's compare-and-set to succeed. Keyed by the room object, so a retry (a new object) starts empty.
const queued = new WeakMap<object, LogRecord[]>();

export function queueLog(owner: object, ...records: LogRecord[]): void {
  queued.set(owner, [...(queued.get(owner) ?? []), ...records]);
}

export function takeQueued(owner: object): LogRecord[] {
  const records = queued.get(owner) ?? [];
  queued.delete(owner);
  return records;
}

let timeoutMs: number = LOG_WRITE_TIMEOUT_MS;
export function setLogTimeoutForTests(ms: number | null): void {
  timeoutMs = ms ?? LOG_WRITE_TIMEOUT_MS;
}

/** Resolves with the work, or rejects after the cap. The timer is always cleared. */
async function withTimeout(work: PromiseLike<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve(work),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("game log write timed out")), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Concurrency: records are queued on the room object and written only after its compare-and-set returned ok (never before).
// A retry loads a fresh object with an empty queue, so a losing request writes nothing. Turn-ending commits form a chain
// a -> b, so their turn events partition the turns with no overlap and no hole. Wrong guesses use their own fields, and
// turn events use t:<n>, so a duplicate write overwrites instead of appending. A crash between the CAS and this write
// loses that turn's event; the report counts such gaps.
/** Writes every queued record of `owner` with ONE hset (plus an expire in a pipeline when an "end" record is among them). No-op when nothing is queued or logging is off. */
export async function flushQueuedLog(redis: Redis, owner: object, logId: string): Promise<void> {
  if (!isGameLoggingEnabled()) return;
  const records = takeQueued(owner);
  if (!records.length) return;
  try {
    const key = logKey(logId);
    const fields = Object.fromEntries(records.map((record) => [fieldOf(record), record]));
    const work = records.some((record) => record.t === "end")
      ? redis.pipeline().hset(key, fields).expire(key, LOG_TTL_SECONDS).exec()
      : redis.hset(key, fields);
    await withTimeout(work);
  } catch (cause) {
    console.error("Game log write failed:", cause);
  }
}

/** Start of a game: pipeline of 4 commands, in this order (order matters: expire needs the key to exist): hset(key, {start: record}), expire(key, LOG_TTL_SECONDS), zadd(LOG_INDEX_KEY, {score: startedAt, member: logId}), zremrangebyscore(LOG_INDEX_KEY, 0, startedAt - LOG_TTL_SECONDS * 1000). */
export async function writeGameStart(redis: Redis, record: GameStartRecord): Promise<void> {
  if (!isGameLoggingEnabled()) return;
  try {
    const key = logKey(record.logId);
    await withTimeout(redis.pipeline()
      .hset(key, { [START_FIELD]: record })
      .expire(key, LOG_TTL_SECONDS)
      .zadd(LOG_INDEX_KEY, { score: record.startedAt, member: record.logId })
      .zremrangebyscore(LOG_INDEX_KEY, 0, record.startedAt - LOG_TTL_SECONDS * 1000)
      .exec());
  } catch (cause) {
    console.error("Game log write failed:", cause);
  }
}

/** Host ended the game: pipeline hset(key, {end: record}) + expire(key, LOG_TTL_SECONDS). */
export async function writeGameEnd(redis: Redis, logId: string, record: GameEndRecord): Promise<void> {
  if (!isGameLoggingEnabled()) return;
  try {
    const key = logKey(logId);
    await withTimeout(redis.pipeline().hset(key, { [END_FIELD]: record }).expire(key, LOG_TTL_SECONDS).exec());
  } catch (cause) {
    console.error("Game log write failed:", cause);
  }
}

export type GameLog = { logId: string; start: GameStartRecord | null; turns: TurnLogEvent[]; wrong: WrongGuessEvent[]; end: GameEndRecord | null; badFields: number };

const TURN_FIELD = /^t:\d{4,}$/;
const WRONG_FIELD = /^w:\d{4,}:\d+:[A-Z]{2,3}$/;

/** `hash` is what hgetall returns: values may be JSON strings (real Redis, test double) or already-parsed objects (Upstash client). Sorts turns by n, wrong by (n, at). A value that is not valid JSON or has an unknown field name is skipped and counted in badFields. */
export function parseGameLog(logId: string, hash: Record<string, unknown>): GameLog {
  const log: GameLog = { logId, start: null, turns: [], wrong: [], end: null, badFields: 0 };
  for (const [field, raw] of Object.entries(hash ?? {})) {
    let value: unknown;
    try {
      value = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      log.badFields++;
      continue;
    }
    if (typeof value !== "object" || value === null) {
      log.badFields++;
      continue;
    }
    if (field === START_FIELD) log.start = value as GameStartRecord;
    else if (field === END_FIELD) log.end = value as GameEndRecord;
    else if (TURN_FIELD.test(field)) log.turns.push(value as TurnLogEvent);
    else if (WRONG_FIELD.test(field)) log.wrong.push(value as WrongGuessEvent);
    else log.badFields++;
  }
  log.turns.sort((a, b) => a.n - b.n);
  log.wrong.sort((a, b) => a.n - b.n || a.at - b.at);
  return log;
}
