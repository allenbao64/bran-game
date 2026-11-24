import assert from "node:assert/strict";
import test from "node:test";
import { applyAction } from "@/lib/empire2/engine";
import { applyPlayAction } from "@/lib/empire2/actions";
import { advanceTimeouts, endTurn, startRound, beginTurn } from "@/lib/empire2/turns";
import { isSecondOfTwo, roundOrder } from "@/lib/empire2/order";
import { miniGeo, buildPlayState, ctxAt, deepFreeze, err, mulberry32, ok } from "@/tests/empire2-support";
import type { EmpireState } from "@/lib/empire2/types";

test("turn-01 roundOrder snakes: odd rounds ascending, even rounds descending", () => {
  assert.deepEqual(roundOrder(1, 3), [0, 1, 2]);
  assert.deepEqual(roundOrder(2, 3), [2, 1, 0]);
  assert.deepEqual(roundOrder(3, 3), [0, 1, 2]);
  assert.deepEqual(roundOrder(1, 2), [0, 1]);
  assert.deepEqual(roundOrder(2, 2), [1, 0]);
});

test("turn-02 isSecondOfTwo is true only for the first turn of rounds 2 and later", () => {
  assert.equal(isSecondOfTwo(1, 0), false);
  assert.equal(isSecondOfTwo(2, 0), true);
  assert.equal(isSecondOfTwo(2, 1), false);
  assert.equal(isSecondOfTwo(3, 0), true);
});

test("turn-03 the player who goes last in a round goes first in the next", () => {
  for (const n of [2, 3, 4]) {
    for (let r = 1; r <= 6; r++) {
      const last = roundOrder(r, n)[n - 1];
      const first = roundOrder(r + 1, n)[0];
      assert.equal(last, first, `n=${n} round ${r}`);
    }
  }
});

test("turn-04 a second turn's next turn is never a second turn", () => {
  for (const n of [2, 3, 4]) {
    const perPlayer = new Map<number, boolean[]>();
    for (let r = 1; r <= 10; r++) {
      const order = roundOrder(r, n);
      order.forEach((seat, idx) => {
        const list = perPlayer.get(seat) ?? [];
        list.push(isSecondOfTwo(r, idx));
        perPlayer.set(seat, list);
      });
    }
    for (const [, flags] of perPlayer) {
      for (let i = 1; i < flags.length; i++) {
        assert.ok(!(flags[i - 1] && flags[i]), `n=${n}: two consecutive second turns`);
      }
    }
  }
});

test("turn-05 endTurn advances to the next seat and starts that turn at the end time", () => {
  const s = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
    now: 1000,
  });
  const next = ok(applyAction(s, "p1", { type: "endTurn" }, ctxAt(miniGeo, 5000)));
  assert.equal(next.turn?.playerId, "p2");
  assert.equal(next.turn?.seat, 1);
  assert.equal(next.turn?.indexInRound, 1);
  assert.equal(next.turn?.startedAt, 5000);
});

test("turn-06 last turn of a round starts the next round: round+1, new snapshot, booms, bounties, income, first seat of the new order", () => {
  const s = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1"], influence: 0 }, { id: "p2", owned: ["B1"], influence: 0 }],
    indexInRound: 1,
    round: 1,
    roundStartVp: { p1: 0, p2: 0 },
  });
  const next = ok(applyAction(s, "p2", { type: "endTurn" }, ctxAt(miniGeo, 9000, mulberry32(4))));
  assert.equal(next.round, 2);
  assert.deepEqual(next.roundStartVp, { p1: 0, p2: 0 });
  assert.equal(next.booms.length, 3);
  assert.equal(next.bounties.length, 2);
  assert.ok(next.bounties.every((c) => c.id.startsWith("r2-")));
  assert.ok(next.lastIncome?.p1 && next.lastIncome?.p2);
  assert.equal(next.turn?.playerId, "p2");
  assert.equal(next.turn?.indexInRound, 0);
  assert.equal(next.turn?.isSecondOfTwo, true);
});

test("turn-07 unspent influence carries over into the next round", () => {
  const s = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1"], influence: 5 }, { id: "p2", owned: ["B1"], influence: 0 }],
    indexInRound: 1,
    round: 1,
  });
  const next = ok(applyAction(s, "p2", { type: "endTurn" }, ctxAt(miniGeo, 0, mulberry32(5))));
  const income = next.lastIncome?.p1.total ?? -1;
  assert.equal(next.players[0].influence, 5 + income);
});

test("turn-08 timeout is an endTurn: unspent influence kept, next turn starts at startedAt+turnMs", () => {
  const s = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1"], influence: 4 }, { id: "p2", owned: ["B1"] }],
    now: 0,
    turnMs: 30000,
  });
  const after = advanceTimeouts(s, ctxAt(miniGeo, 30000));
  assert.equal(after.turn?.playerId, "p2");
  assert.equal(after.turn?.startedAt, 30000);
  assert.equal(after.players[0].influence, 4);
  assert.equal(after.log.at(-1)?.type, "timeout");
});

test("turn-09 advanceTimeouts catches up several expired turns deterministically", () => {
  const start = 0;
  const s = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
    now: start,
    turnMs: 30000,
  });
  const after = advanceTimeouts(s, ctxAt(miniGeo, start + 3.5 * 30000, mulberry32(8)));
  const timeouts = after.log.filter((e) => e.type === "timeout");
  assert.equal(timeouts.length, 3);
  assert.equal(after.turn?.startedAt, start + 3 * 30000);
  assert.equal(after.round, 2);
});

test("turn-10 advanceTimeouts does nothing before the deadline and in setup/finished", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1" }, { id: "p2" }], now: 0, turnMs: 30000 });
  assert.equal(advanceTimeouts(s, ctxAt(miniGeo, 29999)), s);
  const setupLike: EmpireState = { ...s, phase: "setup", turn: null };
  assert.equal(advanceTimeouts(setupLike, ctxAt(miniGeo, 999999)), setupLike);
  const finished: EmpireState = { ...s, phase: "finished", turn: null };
  assert.equal(advanceTimeouts(finished, ctxAt(miniGeo, 999999)), finished);
});

test("turn-11 actions after the deadline return turnExpired and change nothing", () => {
  const s = deepFreeze(buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 9 }, { id: "p2" }], now: 0, turnMs: 30000 }));
  const before = structuredClone(s);
  assert.equal(err(applyAction(s, "p1", { type: "endTurn" }, ctxAt(miniGeo, 30000))), "turnExpired");
  assert.equal(err(applyAction(s, "p1", { type: "expand", code: "A2" }, ctxAt(miniGeo, 31000))), "turnExpired");
  assert.deepEqual(s, before);
});

test("turn-12 round snapshot is taken at the start of the round and never changes during it", () => {
  const s = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1"], influence: 9 }, { id: "p2", owned: ["B1"] }],
    roundStartVp: { p1: 3, p2: 4 },
  });
  const snapshot = structuredClone(s.roundStartVp);
  let cur = ok(applyAction(s, "p1", { type: "expand", code: "A2" }, ctxAt(miniGeo, 1)));
  cur = ok(applyAction(cur, "p1", { type: "expand", code: "A3" }, ctxAt(miniGeo, 2)));
  assert.deepEqual(cur.roundStartVp, snapshot);
});

test("turn-13 turn state records actions this turn", () => {
  const s = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1", "A2"], influence: 5, capital: "A1" }, { id: "p2" }],
  });
  let cur = ok(applyPlayAction(s, "p1", { type: "city", code: "A1", capital: "cap-a1" }, ctxAt(miniGeo, 1)));
  cur = ok(applyPlayAction(cur, "p1", { type: "expand", code: "A3" }, ctxAt(miniGeo, 2)));
  assert.equal(cur.turn?.actions.length, 2);
  assert.deepEqual(cur.turn?.actions[0], { type: "city", code: "A1", cost: 3, bounty: 0 });
  assert.deepEqual(cur.turn?.actions[1], { type: "expand", code: "A3", cost: 0, bounty: 0 });
});

test("turn-14 the clock fields come from rules", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1" }, { id: "p2" }], now: 4000, turnMs: 45000 });
  assert.equal(s.turnMs, 45000);
  assert.equal(s.turn?.startedAt, 4000);
  const direct = beginTurn(s, 1, 1, 7000, miniGeo);
  assert.equal(direct.turn?.startedAt, 7000);
  assert.equal(direct.turn?.playerId, "p2");
  const round = startRound(s, 2, ctxAt(miniGeo, 8000, mulberry32(2)));
  assert.equal(round.turn?.startedAt, 8000);
  const ended = endTurn(s, ctxAt(miniGeo, 9000), "endTurn", 9000);
  assert.equal(ended.turn?.startedAt, 9000);
});
