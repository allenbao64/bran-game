import { drawBounties } from "./bounties";
import type { Ctx, EmpireState, GameResult, IncomeBreakdown, PlayerId } from "./types";
import { computeIncome, drawBooms, drawBoomsExcept } from "./economy";
import { bestBoomPick, boomPickerId } from "./boom-pick";
import { drawEvent } from "./events";
import { isBackToBack, roundSeatOrder } from "./order";
import { appendLog, frontier, freeCountries, isBoomPickPending, patchState } from "./state";
import { endOfRoundResult, scoreAll, scorePlayer, resolveCap, winnerAtTurnEnd } from "./victory";

/** Starts a turn for the seat at `indexInRound` (section 7.3). `secondOfTwo` is decided by the caller (startRound). */
export function beginTurn(
  state: EmpireState,
  seat: number,
  indexInRound: number,
  now: number,
  geo: Ctx["geo"],
  secondOfTwo = false,
): EmpireState {
  const player = state.players.find((p) => p.seat === seat);
  if (!player) return state;
  const turn = {
    playerId: player.id,
    seat,
    indexInRound,
    isSecondOfTwo: secondOfTwo,
    startedAt: now,
    noFrontierAtStart: frontier(state, player.id, geo).length === 0,
    expands: 0,
    colonizes: 0,
    annexed: false,
    actions: [],
  };
  return patchState(state, { turn });
}

/** Pays every player's income for the round from the booms and snapshot now in the state (section 8.1). */
function collectIncome(state: EmpireState, geo: Ctx["geo"]): EmpireState {
  let s = state;
  const lastIncome: Record<PlayerId, IncomeBreakdown> = {};
  for (const p of s.players) {
    const ib = computeIncome(s, p.id, geo);
    lastIncome[p.id] = ib;
    s = patchState(s, {
      players: s.players.map((x) => (x.id === p.id ? { ...x, influence: x.influence + ib.total } : x)),
    });
  }
  return patchState(s, { lastIncome });
}

/**
 * underdogBoomPick (on): the round waits for the picker's pickBoom. No booms are drawn and no income is paid yet,
 * because booms feed income. No turn exists until applyBoomPick runs.
 */
function openBoomPick(state: EmpireState, ctx: Ctx, secondOfTwo: boolean): EmpireState {
  const playerId = boomPickerId(state);
  let s = patchState(state, {
    turn: null,
    booms: [],
    boomPick: { round: state.round, playerId, region: null, by: null, startedAt: ctx.now, secondOfTwo },
  });
  s = appendLog(s, { type: "roundStart", round: s.round, playerId: null, note: s.event ?? "" });
  return s;
}

/**
 * Makes the round's boom pick (underdogBoomPick): records the region, draws the other boomRegionCount - 1 booms from
 * the other regions, then deals bounties and pays income as startRound does, and starts the round's first turn.
 * `by` is "player" for pickBoom and "timeout" for the engine's pick. Draws rng: remaining booms, then bounties.
 */
export function applyBoomPick(
  state: EmpireState,
  ctx: Ctx,
  region: string,
  by: "player" | "timeout",
  now: number,
): EmpireState {
  const pick = state.boomPick;
  if (pick === undefined || pick.region !== null) throw new Error("applyBoomPick: no pick is pending");
  const geo = ctx.geo;
  const count = state.rules.boomRegionCount;
  // With boomRegionCount 0 no region booms: the pick is still recorded, and no rng is drawn for the other booms.
  const rest = count > 0 ? drawBoomsExcept(ctx.rng, geo, count - 1, region) : [];
  const booms = count > 0 ? [region, ...rest].sort() : [];
  let s = patchState(state, { booms, boomPick: { ...pick, region, by } });
  s = appendLog(s, { type: "boomPick", round: s.round, playerId: pick.playerId, note: region, auto: by === "timeout" });
  const bounties = drawBounties(ctx.rng, geo, freeCountries(s, geo), s.round, s.rules);
  s = patchState(s, { bounties });
  s = collectIncome(s, geo);
  const firstSeat = roundSeatOrder(s, s.round)[0];
  return beginTurn(s, firstSeat, 0, now, geo, pick.secondOfTwo);
}

/** Starts a round (section 7.4). Rng order: event, booms, bounties; then income per player. */
export function startRound(state: EmpireState, round: number, ctx: Ctx): EmpireState {
  const geo = ctx.geo;
  const rules = state.rules;
  const n = state.players.length;

  // The previous round's order uses its own snapshot, so read it before the snapshot is replaced below.
  const previousOrder = state.round >= 1 ? roundSeatOrder(state, state.round) : null;
  let s = patchState(state, { round });

  const roundStartVp: Record<PlayerId, number> = {};
  for (const p of s.players) roundStartVp[p.id] = scorePlayer(s, p.id, geo).total;
  s = patchState(s, { roundStartVp });

  const event = round > 1 && (round - 1) % rules.eventEvery === 0 ? drawEvent(ctx.rng) : null;
  s = patchState(s, { event });

  const firstSeat = roundSeatOrder(s, round)[0];
  const secondOfTwo = previousOrder !== null && isBackToBack(previousOrder[n - 1], firstSeat);
  if (rules.underdogBoomPick) return openBoomPick(s, ctx, secondOfTwo);

  const booms = drawBooms(ctx.rng, geo, rules.boomRegionCount);
  s = patchState(s, { booms });

  const bounties = drawBounties(ctx.rng, geo, freeCountries(s, geo), round, rules);
  s = patchState(s, { bounties });

  s = collectIncome(s, geo);

  s = appendLog(s, { type: "roundStart", round, playerId: null, note: event ?? "" });

  return beginTurn(s, firstSeat, 0, ctx.now, geo, secondOfTwo);
}

/**
 * Ends the current turn (section 7.5). kind "timeout" uses the same rules as "endTurn".
 * Draws rng only through startRound.
 */
export function endTurn(
  state: EmpireState,
  ctx: Ctx,
  kind: "endTurn" | "timeout",
  endedAt: number,
): EmpireState {
  const turn = state.turn;
  if (state.phase !== "play" || turn === null) return state;
  const geo = ctx.geo;
  const rules = state.rules;
  const P = turn.playerId;

  const vp = scorePlayer(state, P, geo).total;
  let s = patchState(state, { waitingWin: state.waitingWin.filter((id) => id !== P) });

  // winCheck "endOfTurn" (default): a win or a delayed win is decided here. "endOfRound" decides at round end.
  if (rules.winCheck === "endOfTurn") {
    if (winnerAtTurnEnd(vp, turn.isSecondOfTwo, rules.winPoints)) {
      const scores = scoreAll(s, geo);
      const vpAll: Record<PlayerId, number> = {};
      const influence: Record<PlayerId, number> = {};
      for (const p of s.players) {
        vpAll[p.id] = scores[p.id].total;
        influence[p.id] = p.influence;
      }
      const result: GameResult = { winners: [P], reason: "points", round: s.round, vp: vpAll, influence };
      s = patchState(s, { phase: "finished", turn: null, result });
      return appendLog(s, { type: "win", round: s.round, playerId: P, second: turn.isSecondOfTwo });
    }

    if (turn.isSecondOfTwo && vp >= rules.winPoints) {
      const waiting = [...s.waitingWin, P];
      s = patchState(s, {
        waitingWin: s.players.map((p) => p.id).filter((id) => waiting.includes(id)),
      });
    }
  }

  s = appendLog(s, {
    type: kind === "timeout" ? "timeout" : "endTurn",
    round: s.round,
    playerId: P,
    second: turn.isSecondOfTwo,
  });

  const n = s.players.length;
  const next = turn.indexInRound + 1;
  if (next < n) {
    return beginTurn(s, roundSeatOrder(s, s.round)[next], next, endedAt, geo);
  }
  if (rules.winCheck === "endOfRound") {
    const result = endOfRoundResult(s, geo);
    if (result !== null) {
      s = patchState(s, { phase: "finished", turn: null, result });
      for (const w of result.winners) s = appendLog(s, { type: "win", round: s.round, playerId: w, second: false });
      return s;
    }
  }
  if (s.round >= rules.roundCap) {
    const result = resolveCap(s, geo);
    s = patchState(s, { phase: "finished", turn: null, result });
    return appendLog(s, { type: "cap", round: s.round, playerId: null });
  }
  return startRound(s, s.round + 1, { ...ctx, now: endedAt });
}

/**
 * Lazy catch-up of expired turns (section 7.6). A pending boom pick (underdogBoomPick) expires like a turn: when its
 * clock runs out, the engine makes it with bestBoomPick and the round goes on.
 */
export function advanceTimeouts(state: EmpireState, ctx: Ctx): EmpireState {
  let s = state;
  let guard = 0;
  while (s.phase === "play" && guard < 1000) {
    if (isBoomPickPending(s) && s.boomPick !== undefined) {
      const deadline = s.boomPick.startedAt + s.turnMs;
      if (ctx.now < deadline) break;
      guard += 1;
      s = applyBoomPick(s, ctx, bestBoomPick(s, s.boomPick.playerId, ctx.geo), "timeout", deadline);
      continue;
    }
    if (s.turn === null) break;
    const deadline = s.turn.startedAt + s.turnMs;
    if (ctx.now < deadline) break;
    guard += 1;
    s = endTurn(s, ctx, "timeout", deadline);
  }
  return s;
}
