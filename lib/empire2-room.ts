/**
 * Room-level glue for Empire 2.0 playtest rooms: creates the game on first read after the host starts, runs the
 * setup and turn clocks lazily, runs actions, and writes with a compare-and-set on a version counter. Also builds
 * the per-viewer view and the members-only log export. Client code must not import this file.
 */
import type { Redis } from "@upstash/redis";
import { ROOM_TTL_SECONDS } from "@/lib/redis";
import { countryByCode } from "@/lib/countries";
import { playerColor } from "@/lib/player-colors";
import {
  DEFAULT_EMPIRE2_TURN_SECONDS, playtestRules, type Empire2Action, type Empire2Phase, type Empire2View, type Empire2ViewPlayer,
} from "@/lib/empire2-playtest";
import {
  actionCosts, advanceTimeouts, applyAction, autoSetupPick, bountyLabel, createGame, currentPlayerId, empire2Geo, eventLabel,
  frontier, isBoomPickPending, legalFootholds, legalMoves, ownedBy, reliefAvailable, scorePlayer,
  type Ctx, type EmpireState, type EventKind, type LogEntry,
} from "@/lib/empire2";
import { resolveCap } from "@/lib/empire2/victory";

export type Empire2RoomPlayer = { id: string; token: string; name: string; host: boolean };
/** Round-start victory points of every player, recorded once per round started (the engine's roundStartVp snapshot). */
export type RoundVpEntry = { round: number; vp: Record<string, number> };
export type Empire2Room = {
  code: string;
  gameId?: string;
  mode?: string;
  status: "waiting" | "playing" | "ended";
  startedAt: number | null;
  players: Empire2RoomPlayer[];
  /** Turn length in seconds picked by the host (20, 30 or 45). */
  turnSeconds?: number;
  empire2Options?: { underdogBoomPick: boolean };
  empire2?: EmpireState;
  empire2Version?: number;
  /** ms: the clock start of the current setup pick. */
  empire2SetupAt?: number;
  empire2RoundVp?: RoundVpEntry[];
};

/** Writes the new room JSON only if nobody else wrote a newer Empire 2.0 version meanwhile. */
export const EMPIRE2_CAS_SCRIPT = `
  local raw = redis.call('GET', KEYS[1])
  if not raw then return cjson.encode({error='Room not found.'}) end
  local room = cjson.decode(raw)
  if room.status ~= 'playing' or tonumber(room.empire2Version or 0) ~= tonumber(ARGV[1]) then
    return cjson.encode({conflict=true})
  end
  redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))
  return cjson.encode({ok=true})
`;

let rngForTests: (() => number) | null = null;
export function setEmpire2RngForTests(rng: (() => number) | null) { rngForTests = rng; }
const rng = () => (rngForTests ?? Math.random)();
const ctxAt = (now: number): Ctx => ({ geo: empire2Geo, rng, now });

export const isEmpire2Room = (room: Pick<Empire2Room, "gameId" | "mode">) => (room.gameId ?? "countries") === "countries" && room.mode === "empire2";

const BAD_REQUEST_CODES = new Set(["unknownCountry", "notOffered", "unknownAction", "unknownRegion", "wrongCapital"]);
const SERVER_CODES = new Set(["badPlayerCount", "duplicatePlayer", "badTurnMs", "badRules"]);
/** HTTP status for an engine error code (section 2.7). */
export function engineErrorStatus(code: string): number {
  if (BAD_REQUEST_CODES.has(code)) return 400;
  if (SERVER_CODES.has(code)) return 500;
  return 409;
}

const list = <V,>(value: unknown): V[] => (Array.isArray(value) ? value as V[] : []);
const dict = <V,>(value: unknown): Record<string, V> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, V> : {};

/**
 * Lua's JSON encoder turns empty arrays into {}, so every array field the engine reads is put back to [] after a load
 * (and every object field that can be an empty array to {}). Returns a new state.
 */
export function normalizeEmpire2State(state: EmpireState): EmpireState {
  const out: EmpireState = {
    ...state,
    players: list(state.players),
    owners: dict(state.owners),
    cities: list(state.cities),
    booms: list(state.booms),
    bounties: list(state.bounties),
    waitingWin: list(state.waitingWin),
    roundStartVp: dict(state.roundStartVp),
    log: list<LogEntry>(state.log),
  };
  if (state.reliefUsed !== undefined) out.reliefUsed = list(state.reliefUsed);
  if (state.setup) out.setup = { ...state.setup, order: list(state.setup.order), offers: list(state.setup.offers) };
  if (state.turn) out.turn = { ...state.turn, actions: list(state.turn.actions) };
  if (state.result) out.result = { ...state.result, winners: list(state.result.winners), vp: dict(state.result.vp), influence: dict(state.result.influence) };
  return out;
}

async function load(redis: Redis, key: string): Promise<Empire2Room | null> {
  const room = await redis.get<Empire2Room>(key);
  if (!room) return null;
  if (room.empire2) room.empire2 = normalizeEmpire2State(room.empire2);
  if (room.empire2RoundVp !== undefined) {
    room.empire2RoundVp = list<RoundVpEntry>(room.empire2RoundVp).map((entry) => ({ round: entry.round, vp: dict<number>(entry.vp) }));
  }
  return room;
}

async function commit(redis: Redis, key: string, expected: number, next: Empire2Room): Promise<boolean> {
  next.empire2Version = expected + 1;
  const result = await redis.eval(EMPIRE2_CAS_SCRIPT, [key], [String(expected), JSON.stringify(next), String(ROOM_TTL_SECONDS)]);
  const parsed = (typeof result === "string" ? JSON.parse(result) : result) as { ok?: boolean };
  return Boolean(parsed.ok);
}

/** The new game for a started room: seats in a random order (Fisher-Yates on the rng), playtest rules. */
function newGame(room: Empire2Room): EmpireState {
  const ids = room.players.map((p) => p.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const started = room.startedAt ?? 0;
  const created = createGame({
    playerIds: ids,
    turnMs: (room.turnSeconds ?? DEFAULT_EMPIRE2_TURN_SECONDS) * 1000,
    rules: playtestRules(room.empire2Options?.underdogBoomPick ?? false),
  }, ctxAt(started));
  if (!created.ok) throw new Error(`Empire 2.0 game could not start: ${created.error.code}`);
  return created.state;
}

/** Clock start of the engine's pending clock (boom pick or turn), or null when none runs. */
function playDeadline(state: EmpireState): number | null {
  if (state.phase !== "play") return null;
  if (isBoomPickPending(state) && state.boomPick) return state.boomPick.startedAt + state.turnMs;
  if (state.turn) return state.turn.startedAt + state.turnMs;
  return null;
}

/** Records the round-start points of a round the first time the state shows it (one entry per round started). */
function recordRoundStart(room: Empire2Room, state: EmpireState) {
  if (state.phase === "setup" || state.round < 1) return;
  const entries = room.empire2RoundVp ?? [];
  if (entries.some((entry) => entry.round === state.round)) return;
  room.empire2RoundVp = [...entries, { round: state.round, vp: { ...state.roundStartVp } }];
}

/**
 * Creates the game if needed, runs the setup clock (autoSetupPick at each expiry) and the turn and boom clocks.
 * Timeouts are applied one clock at a time, so every round start is recorded. Mutates `room`; returns true when
 * something changed.
 */
function syncEmpire2(room: Empire2Room, now: number): boolean {
  let changed = false;
  if (room.empire2 === undefined && room.startedAt !== null) {
    room.empire2 = newGame(room);
    room.empire2SetupAt = room.startedAt;
    changed = true;
  }
  if (room.empire2 === undefined) return changed;
  let state = room.empire2;
  if (room.status === "playing" && state.phase !== "finished") {
    while (state.phase === "setup" && state.setup !== null) {
      const deadline = (room.empire2SetupAt ?? room.startedAt ?? now) + state.turnMs;
      if (now < deadline) break;
      const picker = currentPlayerId(state);
      const action = autoSetupPick(state, ctxAt(deadline));
      if (picker === null || action === null) break;
      const next = applyAction(state, picker, action, ctxAt(deadline));
      if (!next.ok) break;
      state = next.state;
      room.empire2SetupAt = deadline;
      changed = true;
      recordRoundStart(room, state);
    }
    for (let guard = 0; guard < 1000 && state.phase === "play"; guard++) {
      const deadline = playDeadline(state);
      if (deadline === null || now < deadline) break;
      state = advanceTimeouts(state, ctxAt(deadline));
      changed = true;
      room.empire2 = state;
      recordRoundStart(room, state);
    }
    room.empire2 = state;
    if (state.phase === "finished" && room.status === "playing") {
      room.status = "ended";
      changed = true;
    }
  }
  return changed;
}

/** Loads an Empire 2.0 room with the game created and clocks applied (and persisted when something changed). */
export async function loadSyncedEmpire2Room(redis: Redis, key: string, now: number): Promise<Empire2Room | null> {
  let room: Empire2Room | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    room = await load(redis, key);
    if (!room) return null;
    const before = room.empire2Version ?? 0;
    if (!syncEmpire2(room, now) || await commit(redis, key, before, room)) return room;
  }
  // Every save conflicted: the synced copy was never stored, so answer with the stored room (re-synced on the next read).
  return load(redis, key);
}

export type Empire2ActionOutcome = { room: Empire2Room } | { error: string; status: number };

/** Runs one action against the freshest room, retrying when another request wrote first. */
export async function runEmpire2Action(
  redis: Redis, key: string, now: number, playerId: string, action: Empire2Action,
): Promise<Empire2ActionOutcome> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const room = await load(redis, key);
    if (!room) return { error: "Room not found.", status: 404 };
    if (room.status === "waiting") return { error: "The game hasn't started yet.", status: 409 };
    const before = room.empire2Version ?? 0;
    const synced = syncEmpire2(room, now);
    if (room.status !== "playing" || room.empire2 === undefined || room.empire2.phase === "finished") {
      // A sync that ended the game was written while the stored room was still playing; otherwise the room is over.
      if (!synced || await commit(redis, key, before, room)) return { error: "The game is over.", status: 409 };
      continue;
    }
    const state = room.empire2;
    const setupPick = state.phase === "setup";
    const result = applyAction(state, playerId, action, ctxAt(now));
    if (!result.ok) {
      if (!synced) return { error: result.error.message, status: engineErrorStatus(result.error.code) };
      if (await commit(redis, key, before, room)) return { error: result.error.message, status: engineErrorStatus(result.error.code) };
      continue;
    }
    room.empire2 = result.state;
    if (setupPick) room.empire2SetupAt = now;
    recordRoundStart(room, result.state);
    if (result.state.phase === "finished") room.status = "ended";
    if (await commit(redis, key, before, room)) return { room };
  }
  return { error: "The turn just changed. Please try again.", status: 409 };
}

const nameOfCountry = (code: string) => countryByCode(code)?.name ?? code;

/** One plain-text log line (section 2.6.1). */
export function renderLogLine(
  entry: LogEntry,
  nameOf: (id: string | null | undefined) => string,
  countryName: (code: string) => string,
): string {
  const who = nameOf(entry.playerId);
  const country = entry.code ? countryName(entry.code) : "";
  const cost = Math.abs(entry.amount ?? 0);
  switch (entry.type) {
    case "capital": return `${who} picked ${country} as capital.`;
    case "foothold": return `${who} placed a second foothold in ${country}.`;
    case "expand": return `${who} expanded into ${country}` + ((entry.amount ?? 0) < 0 ? ` (-${cost})` : " (free)") + ".";
    case "colonize": return `${who} colonized ${country} (-${cost}).`;
    case "city": return `${who} built a city in ${country} (-${cost}).`;
    case "annex": return `${who} annexed ${country} from ${nameOf(entry.from)} (-${cost}).`;
    case "bounty": return `${who} claimed a bounty in ${country} (+${entry.amount ?? 0}).`;
    case "endTurn": return `${who} ended their turn.`;
    case "timeout": return `${who}'s time ran out.`;
    case "roundStart": return `Round ${entry.round} starts.` + (entry.note ? ` Event: ${eventLabel(entry.note as EventKind)}.` : "");
    case "title":
      if (entry.playerId === null) return "Nobody holds the largest empire now.";
      return `${who} now holds the ${entry.note === "explorer" ? "explorer title" : "largest empire"}.`;
    case "boomPick":
      return entry.auto
        ? `Time ran out. ${who} got ${entry.note} as the boom region.`
        : `${who} picked ${entry.note} as the boom region.`;
    case "win": return `${who} wins.`;
    case "cap": return "The round cap was reached. The game ends on points.";
  }
}

/** Everything one player may see of an Empire 2.0 room. Never includes tokens or another player's offers. */
export function empire2View(room: Empire2Room, now: number, viewerId: string): Empire2View {
  const state = room.empire2;
  if (!state) throw new Error("The Empire 2.0 game has not been created.");
  const geo = empire2Geo;
  const ended = room.status === "ended" || state.phase === "finished";
  const setupPhase = state.phase === "setup" && state.setup !== null;
  const phase: Empire2Phase = ended ? "ended"
    : setupPhase ? (state.setup?.step === "foothold" ? "foothold" : "capital")
    : isBoomPickPending(state) ? "boomPick"
    : "playing";
  const picker = ended ? null : currentPlayerId(state);
  const isPicker = picker === viewerId;
  const turnMs = state.turnMs;
  const deadline = ended ? null
    : setupPhase ? (room.empire2SetupAt ?? room.startedAt ?? now) + turnMs
    : phase === "boomPick" && state.boomPick ? state.boomPick.startedAt + turnMs
    : state.turn ? state.turn.startedAt + turnMs
    : null;
  const order = room.players.map((p) => p.id);
  const nameOf = (id: string | null | undefined) => room.players.find((p) => p.id === id)?.name ?? "Someone";

  const players: Empire2ViewPlayer[] = room.players.map((p) => {
    const seat = state.players.find((x) => x.id === p.id);
    return {
      id: p.id,
      name: p.name,
      color: playerColor(order, p.id),
      host: p.host,
      influence: seat?.influence ?? 0,
      capital: seat?.capital ?? null,
      foothold: seat?.foothold ?? null,
      countries: ownedBy(state, p.id).length,
      cities: state.cities.filter((c) => state.owners[c] === p.id).length,
      titles: state.titles.largestEmpire === p.id ? ["Largest empire"] : [],
      vp: scorePlayer(state, p.id, geo),
      income: state.lastIncome?.[p.id] ?? null,
    };
  });

  const setup = setupPhase && state.setup && !ended ? {
    step: state.setup.step,
    offers: isPicker && state.setup.step === "capital" ? [...state.setup.offers] : null,
    footholds: isPicker && state.setup.step === "foothold" ? legalFootholds(state, viewerId, geo) : null,
  } : null;

  const acting = phase === "playing" && isPicker && state.turn !== null;
  const legal = acting ? legalMoves(state, geo) : null;
  const costs = acting && state.turn ? { ...actionCosts(state), relief: reliefAvailable(state, state.turn) } : null;

  const result = state.result
    ? { reason: state.result.reason, winnerIds: [...state.result.winners] }
    : room.status === "ended" ? { reason: "hostEnded" as const, winnerIds: resolveCap(state, geo).winners }
    : null;

  return {
    phase,
    viewerId,
    currentPlayerId: picker,
    round: state.round,
    roundCap: state.rules.roundCap,
    winPoints: state.rules.winPoints,
    turnMs,
    deadline,
    serverNow: now,
    underdogBoomPick: state.rules.underdogBoomPick,
    players,
    owners: { ...state.owners },
    cities: [...state.cities],
    frontier: ended ? [] : frontier(state, viewerId, geo),
    setup,
    boomPick: state.boomPick
      ? { playerId: state.boomPick.playerId, region: state.boomPick.region, by: state.boomPick.by, regions: [...geo.regionNames()] }
      : null,
    booms: [...state.booms],
    bounties: state.bounties.map((card) => ({ id: card.id, label: bountyLabel(card) })),
    event: state.event ? eventLabel(state.event) : null,
    turn: !ended && state.turn
      ? { playerId: state.turn.playerId, expands: state.turn.expands, colonizes: state.turn.colonizes, annexed: state.turn.annexed, second: state.turn.isSecondOfTwo }
      : null,
    legal,
    costs,
    log: state.log.slice(-12).reverse().map((entry) => renderLogLine(entry, nameOf, nameOfCountry)),
    result,
  };
}

/** The members-only log export: the engine log and result, the round-start points, and the final standings. */
export function empire2LogExport(room: Empire2Room, now: number) {
  const state = room.empire2;
  if (!state) throw new Error("The Empire 2.0 game has not been created.");
  const geo = empire2Geo;
  return {
    code: room.code,
    status: room.status,
    startedAt: room.startedAt,
    turnMs: state.turnMs,
    underdogBoomPick: state.rules.underdogBoomPick,
    rules: state.rules,
    players: room.players.map((p) => ({ id: p.id, name: p.name, host: p.host })),
    endedBy: state.phase === "finished" ? "engine" : room.status === "ended" ? "host" : null,
    result: state.result,
    roundVp: room.empire2RoundVp ?? [],
    finalState: {
      phase: state.phase,
      round: state.round,
      titles: state.titles,
      owners: state.owners,
      cities: state.cities,
      booms: state.booms,
      boomPick: state.boomPick ?? null,
      players: state.players.map((p) => ({ id: p.id, influence: p.influence, capital: p.capital, foothold: p.foothold, vp: scorePlayer(state, p.id, geo) })),
    },
    log: state.log,
    exportedAt: now,
  };
}
