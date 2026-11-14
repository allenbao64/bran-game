import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advanceByTimeouts, createTurnState, currentPlayerId, currentRound, expiredTurns, isPlayersTurn, msLeft, nextTurn, totalTurns, turnsLeft
} from "@/lib/turns";

const order = ["a", "b", "c"];
const fresh = () => createTurnState(order, 1000, 12, "card-0");

test("turn order follows join order and rounds count up after everyone has played", () => {
  let state = fresh();
  assert.equal(totalTurns(state), 36);
  const seen: string[] = [];
  for (let i = 0; i < 7; i++) { seen.push(currentPlayerId(state)!); state = nextTurn(state, 1000 + i, `card-${i + 1}`); }
  assert.deepEqual(seen, ["a", "b", "c", "a", "b", "c", "a"]);
  assert.equal(currentRound(state), 3, "7 turns taken with 3 players means turn 8, which is round 3");
  assert.ok(isPlayersTurn(state, "b"));
  assert.ok(!isPlayersTurn(state, "a"));
});

test("a turn expires after 15 seconds and the clock reports time left", () => {
  const state = fresh();
  assert.equal(msLeft(state, 1000), 15000);
  assert.equal(msLeft(state, 6000), 10000);
  assert.equal(expiredTurns(state, 15999), 0);
  assert.equal(expiredTurns(state, 16000), 1);
  assert.equal(expiredTurns(state, 1000 + 15000 * 4 + 5), 4);
  assert.equal(msLeft(state, 99999), 0);
});

test("timeouts advance across several expired turns, keep the 15s cadence and deal once", () => {
  const dealt: number[] = [];
  const { state, advanced } = advanceByTimeouts(fresh(), 1000 + 15000 * 4 + 2000, (next) => { dealt.push(next.number); return `card-${next.number}`; });
  assert.equal(advanced, 4);
  assert.equal(state.number, 4);
  assert.equal(currentPlayerId(state), "b");
  assert.equal(state.startedAt, 1000 + 15000 * 4, "the new turn started when the last expired turn ended");
  assert.equal(state.deal, "card-4");
  assert.deepEqual(dealt, [4]);
  assert.equal(advanceByTimeouts(state, state.startedAt + 14999, () => "x").advanced, 0);
});

test("timeouts cannot go past the final turn and finish the game", () => {
  const { state, advanced } = advanceByTimeouts(fresh(), 1000 + 15000 * 500, () => "never");
  assert.equal(advanced, 36);
  assert.equal(state.finished, true);
  assert.equal(state.deal, null);
  assert.equal(turnsLeft(state), 0);
  assert.equal(currentPlayerId(state), null);
  assert.equal(expiredTurns(state, 10 ** 12), 0, "a finished game never advances further");
});

test("the last turn and an exhausted board both end the game", () => {
  let state = createTurnState(["a", "b"], 0, 1, "c");
  state = nextTurn(state, 5, "c2");
  assert.equal(state.finished, false);
  assert.equal(currentRound(state), 1);
  state = nextTurn(state, 9, "c3");
  assert.equal(state.finished, true);
  assert.equal(currentRound(state), 1, "round is capped at the last round");

  const early = nextTurn(fresh(), 5, "c", true);
  assert.equal(early.finished, true);
  assert.equal(early.deal, null);
});

test("sudden death: when the normal rounds end and onPhaseEnd returns a phase, the game continues with only those players", () => {
  const phase = { order: ["a", "c"], startNumber: 3, round: 1, maxRounds: 3 };
  const onPhaseEnd = () => phase;
  let state = createTurnState(order, 0, 1, "d0");
  state = nextTurn(state, 1, "d1", false, onPhaseEnd);
  state = nextTurn(state, 2, "d2", false, onPhaseEnd);
  assert.equal(state.sudden, undefined, "no sudden phase before the normal turns are over");
  state = nextTurn(state, 3, "d3", false, onPhaseEnd);
  assert.equal(state.finished, false);
  assert.deepEqual(state.sudden, phase);
  assert.equal(currentPlayerId(state), "a");
  assert.equal(turnsLeft(state), 2);
  assert.equal(currentRound(state), 1, "round stays at totalRounds during sudden death");
  state = nextTurn(state, 4, "d4", false, onPhaseEnd);
  assert.equal(currentPlayerId(state), "c");
  assert.equal(turnsLeft(state), 1);
  assert.equal(currentRound(state), 1);
});

test("a sudden-death round ends and onPhaseEnd decides: another round, or finish", () => {
  const phase = { order: ["a", "c"], startNumber: 3, round: 1, maxRounds: 3 };
  const base = { ...createTurnState(order, 0, 1, "d0"), number: 5, sudden: { ...phase, startNumber: 3 } };
  const finished = nextTurn({ ...base, number: 4 }, 9, "x", false, () => null);
  assert.equal(finished.finished, true);
  assert.equal(finished.deal, null);
  assert.deepEqual(finished.sudden, phase, "sudden stays on the state after the game ends");

  const again = nextTurn({ ...base, number: 4 }, 9, "x", false, () => ({ order: ["a", "c"], startNumber: 5, round: 2, maxRounds: 3 }));
  assert.equal(again.finished, false);
  assert.equal(again.sudden?.round, 2);
  assert.equal(currentPlayerId(again), "a");
});

test("timeouts walk through phase boundaries in one call", () => {
  let rounds = 0;
  const onPhaseEnd = (state: { number: number }) => {
    rounds++;
    return rounds <= 3 ? { order: ["a", "c"], startNumber: state.number, round: rounds, maxRounds: 3 } : null;
  };
  const expiredBy: string[] = [];
  const endedAt: number[] = [];
  const dealCalls: number[] = [];
  const normalTurns = 3;
  const contendersTotal = 3 * 2;
  const { state, advanced } = advanceByTimeouts(
    createTurnState(order, 1000, 1, "d0", 15000), 1000 + 15000 * 1000, (next) => { dealCalls.push(next.number); return "d"; },
    onPhaseEnd,
    ({ playerId, endedAt: at }) => { expiredBy.push(playerId); endedAt.push(at); }
  );
  assert.equal(advanced, normalTurns + contendersTotal);
  assert.equal(state.finished, true);
  assert.equal(state.deal, null);
  assert.deepEqual(dealCalls, [], "deal is not called once the game is finished");
  assert.deepEqual(expiredBy.slice(0, 3), ["a", "b", "c"]);
  assert.deepEqual(expiredBy.slice(3), ["a", "c", "a", "c", "a", "c"]);
  endedAt.forEach((at, i) => assert.equal(at, 1000 + 15000 * (i + 1), "each timeout ends 15s after the previous one"));
  assert.equal(rounds, 4, "the phase-end callback runs after the normal rounds and after each sudden round");
});

test("advanceByTimeouts deals exactly once when the game continues", () => {
  let deals = 0;
  const onPhaseEnd = (state: { number: number }) => ({ order: ["a", "b"], startNumber: state.number, round: 1, maxRounds: 3 });
  const { state, advanced } = advanceByTimeouts(createTurnState(order, 0, 1, "d0", 1000), 3000, () => { deals++; return "d"; }, onPhaseEnd);
  assert.equal(advanced, 3);
  assert.equal(state.finished, false);
  assert.equal(deals, 1);
  assert.equal(state.deal, "d");
});

test("turnsLeft is per phase and never negative", () => {
  const normal = createTurnState(order, 0, 2, "d");
  assert.equal(turnsLeft(normal), 6);
  const sudden = { ...normal, number: 6, sudden: { order: ["a", "b"], startNumber: 6, round: 1, maxRounds: 3 } };
  assert.equal(turnsLeft(sudden), 2);
  assert.equal(turnsLeft({ ...sudden, number: 7 }), 1);
  assert.equal(turnsLeft({ ...sudden, number: 8 }), 0);
  assert.equal(turnsLeft({ ...sudden, number: 20 }), 0, "past the phase end it never goes negative");
  assert.equal(turnsLeft({ ...sudden, finished: true }), 0);
  assert.equal(currentPlayerId({ ...sudden, number: 7 }), "b");
});
