import { drawBounties } from "./bounties";
import type { Ctx, EmpireState, GameResult, IncomeBreakdown, PlayerId } from "./types";
import { computeIncome, drawBooms } from "./economy";
import { drawEvent } from "./events";
import { isBackToBack, roundSeatOrder } from "./order";
import { appendLog, frontier, freeCountries, patchState } from "./state";
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

  const booms = drawBooms(ctx.rng, geo, rules.boomRegionCount);
  s = patchState(s, { booms });

  const bounties = drawBounties(ctx.rng, geo, freeCountries(s, geo), round, rules);
  s = patchState(s, { bounties });

  const lastIncome: Record<PlayerId, IncomeBreakdown> = {};
  for (const p of s.players) {
    const ib = computeIncome(s, p.id, geo);
    lastIncome[p.id] = ib;
    s = patchState(s, {
      players: s.players.map((x) => (x.id === p.id ? { ...x, influence: x.influence + ib.total } : x)),
    });
  }
  s = patchState(s, { lastIncome });

  s = appendLog(s, { type: "roundStart", round, playerId: null, note: event ?? "" });

  const firstSeat = roundSeatOrder(s, round)[0];
  const secondOfTwo = previousOrder !== null && isBackToBack(previousOrder[n - 1], firstSeat);
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

/** Lazy catch-up of expired turns (section 7.6). */
export function advanceTimeouts(state: EmpireState, ctx: Ctx): EmpireState {
  let s = state;
  let guard = 0;
  while (s.phase === "play" && s.turn !== null && guard < 1000) {
    const deadline = s.turn.startedAt + s.turnMs;
    if (ctx.now < deadline) break;
    guard += 1;
    s = endTurn(s, ctx, "timeout", deadline);
  }
  return s;
}
