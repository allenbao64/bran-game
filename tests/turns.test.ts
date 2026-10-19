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
  assert.equal(state.card, "card-4");
  assert.deepEqual(dealt, [4]);
  assert.equal(advanceByTimeouts(state, state.startedAt + 14999, () => "x").advanced, 0);
});

test("timeouts cannot go past the final turn and finish the game", () => {
  const { state, advanced } = advanceByTimeouts(fresh(), 1000 + 15000 * 500, () => "never");
  assert.equal(advanced, 36);
  assert.equal(state.finished, true);
  assert.equal(state.card, null);
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
  assert.equal(early.card, null);
});
