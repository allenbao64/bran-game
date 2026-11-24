import assert from "node:assert/strict";
import test from "node:test";
import { applyAction } from "@/lib/empire2/engine";
import { empire2Geo } from "@/lib/empire2/geo-adapter";
import { actionCosts, computeIncome, drawBooms } from "@/lib/empire2/economy";
import { startRound } from "@/lib/empire2/turns";
import { scorePlayer } from "@/lib/empire2/victory";
import { buildPlayState, ctxAt, miniGeo, mulberry32, ok, scriptedRng } from "@/tests/empire2-support";
import type { EmpireState, TurnState } from "@/lib/empire2/types";
import { createGame } from "@/lib/empire2/setup";

function withTurn(s: EmpireState, patch: Partial<TurnState>): EmpireState {
  if (s.turn === null) throw new Error("no turn");
  return { ...s, turn: { ...s.turn, ...patch } };
}

const ALPHA = ["A1", "A2", "A3", "A4", "A5", "A6"];
const BETA = ["B1", "B2", "B3", "B4", "B5", "B6"];
const GAMMA = ["G1", "G2", "G3", "G4", "G5", "G6"];

test("econ-01 base income is 2", () => {
  for (let n = 0; n <= 3; n++) {
    const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ALPHA.slice(0, n) }, { id: "p2" }] });
    assert.equal(computeIncome(s, "p1", miniGeo).total, 2, `n=${n}`);
  }
});

test("econ-02 territory income is 1 per 4 countries, floored", () => {
  const counts = [3, 4, 7, 8];
  const expected = [0, 1, 1, 2];
  counts.forEach((n, i) => {
    const owned = [...ALPHA, ...BETA, ...GAMMA].slice(0, n);
    const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned }, { id: "p2" }] });
    assert.equal(computeIncome(s, "p1", miniGeo).territory, expected[i], `n=${n}`);
  });
});

test("econ-03 each city pays 1", () => {
  const s = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1", "B1"], cities: ["A1", "B1"] }, { id: "p2" }],
  });
  assert.equal(computeIncome(s, "p1", miniGeo).cities, 2);
});

test("econ-04 boom pays 1 per booming region where you own a country, once however many countries", () => {
  const one = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1", "A2", "A3"] }, { id: "p2" }],
    booms: ["Alpha West"],
  });
  assert.equal(computeIncome(one, "p1", miniGeo).boom, 1);
  const two = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1", "B1"] }, { id: "p2" }],
    booms: ["Alpha West", "Beta West"],
  });
  assert.equal(computeIncome(two, "p1", miniGeo).boom, 2);
});

test("econ-05 boom pays 2 in a region where you have a city", () => {
  const s = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1"], cities: ["A1"] }, { id: "p2" }],
    booms: ["Alpha West"],
  });
  const ib = computeIncome(s, "p1", miniGeo);
  assert.equal(ib.boom, 2);
  assert.equal(ib.cities, 1);
});

test("econ-06 boom ignores non-booming regions and players with no country there", () => {
  const s = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1"] }, { id: "p2", owned: ["B1"] }],
    booms: ["Gamma East"],
  });
  assert.equal(computeIncome(s, "p1", miniGeo).boom, 0);
  assert.equal(computeIncome(s, "p2", miniGeo).boom, 0);
});

test("econ-07 underdog +2 when 2 or more points behind the round-start leader", () => {
  const snap = { a: 5, b: 3, c: 3 };
  const s = buildPlayState({
    geo: miniGeo,
    players: [{ id: "a", owned: ["A1"] }, { id: "b", owned: ["B1"] }, { id: "c", owned: ["G1"] }],
    roundStartVp: snap,
  });
  assert.equal(computeIncome(s, "a", miniGeo).underdog, 0);
  assert.equal(computeIncome(s, "b", miniGeo).underdog, 2);
  assert.equal(computeIncome(s, "c", miniGeo).underdog, 2);
  const gap1 = buildPlayState({
    geo: miniGeo,
    players: [{ id: "a", owned: ["A1"] }, { id: "b", owned: ["B1"] }],
    roundStartVp: { a: 4, b: 3 },
  });
  assert.equal(computeIncome(gap1, "b", miniGeo).underdog, 0);
  const gap2 = buildPlayState({
    geo: miniGeo,
    players: [{ id: "a", owned: ["A1"] }, { id: "b", owned: ["B1"] }],
    roundStartVp: { a: 5, b: 3 },
  });
  assert.equal(computeIncome(gap2, "b", miniGeo).underdog, 2);
});

test("econ-08 underdog reads the snapshot, not current points", () => {
  const s = buildPlayState({
    geo: miniGeo,
    players: [
      { id: "a", owned: ["A1", "A2", "A3", "A4", "A5", "A6", "G1", "G2"] },
      { id: "b", owned: [] },
    ],
    roundStartVp: { a: 3, b: 3 },
  });
  assert.ok(scorePlayer(s, "a", miniGeo).total - scorePlayer(s, "b", miniGeo).total >= 2);
  assert.equal(computeIncome(s, "b", miniGeo).underdog, 0);
});

test("econ-09 golden age: each city pays 2, boom unchanged", () => {
  const s = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1", "A2"], cities: ["A1", "A2"] }, { id: "p2" }],
    booms: ["Alpha West"],
    event: "goldenAge",
  });
  const ib = computeIncome(s, "p1", miniGeo);
  assert.equal(ib.cities, 4);
  assert.equal(ib.boom, 2);
});

test("econ-10 income is applied at every round start including round 1, in seat order", () => {
  const rng = scriptedRng([
    0.9, 0.9, 0, 0, 0, 0.9, 0.9, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0.4,
    0, 0, 0, 0, 0, 0, 0.9, 0.5, 0.0,
  ]);
  const at = (now: number) => ctxAt(miniGeo, now, rng);
  let s = ok(createGame({ playerIds: ["p1", "p2"], turnMs: 30000, rules: { winPoints: 5 } }, at(0)));
  s = ok(applyAction(s, "p1", { type: "pickCapital", code: "A1" }, at(1)));
  s = ok(applyAction(s, "p2", { type: "pickCapital", code: "B1" }, at(2)));
  s = ok(applyAction(s, "p2", { type: "pickFoothold", code: "G1" }, at(3)));
  s = ok(applyAction(s, "p1", { type: "pickFoothold", code: "A2" }, at(4)));
  assert.deepEqual(Object.keys(s.lastIncome ?? {}), ["p1", "p2"]);
  assert.equal(s.players[0].influence, 3 + (s.lastIncome?.p1.total ?? 0));
  assert.equal(s.players[1].influence, 3 + (s.lastIncome?.p2.total ?? 0));
  const before = s.players.map((p) => p.influence);
  s = ok(applyAction(s, "p1", { type: "endTurn" }, at(5)));
  s = ok(applyAction(s, "p2", { type: "endTurn" }, at(6)));
  assert.equal(s.round, 2);
  assert.deepEqual(Object.keys(s.lastIncome ?? {}), ["p1", "p2"]);
  assert.equal(s.players[0].influence, before[0] + (s.lastIncome?.p1.total ?? 0));
  assert.equal(s.players[1].influence, before[1] + (s.lastIncome?.p2.total ?? 0));
});

test("econ-11 drawBooms picks 3 regions with a Fisher-Yates over sorted names", () => {
  const rng = scriptedRng([0, 0, 0, 0, 0]);
  const booms = drawBooms(rng, miniGeo, 3);
  assert.deepEqual(booms, ["Alpha West", "Beta East", "Beta West"]);
  assert.equal(rng.consumed(), 5);
  assert.deepEqual(booms, [...booms].sort());
  assert.deepEqual(drawBooms(mulberry32(7), miniGeo, 3), drawBooms(mulberry32(7), miniGeo, 3));
  const real = drawBooms(mulberry32(1), empire2Geo, 3);
  assert.equal(real.length, 3);
  assert.equal(new Set(real).size, 3);
});

test("econ-12 booms are in state and identical for every player", () => {
  const s = startRound(
    buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"] }, { id: "p2", owned: ["B1"] }], round: 1 }),
    2,
    ctxAt(miniGeo, 0, mulberry32(3)),
  );
  assert.equal(s.booms.length, 3);
});

test("econ-13 actionCosts: expand 0, 1, 1 then null", () => {
  const base = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"] }, { id: "p2" }] });
  const seq = [0, 1, 2, 3].map((n) => actionCosts(withTurn(base, { expands: n })).expand);
  assert.deepEqual(seq, [0, 1, 1, null]);
});

test("econ-14 actionCosts: closed borders adds 1 to every expand, not to colonize", () => {
  const base = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"] }, { id: "p2" }], event: "closedBorders" });
  const seq = [0, 1, 2, 3].map((n) => actionCosts(withTurn(base, { expands: n })).expand);
  assert.deepEqual(seq, [1, 2, 2, null]);
  assert.equal(actionCosts(base).colonize, 4);
});

test("econ-15 actionCosts: colonize 4 normally", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"] }, { id: "p2" }] });
  assert.equal(actionCosts(s).colonize, 4);
});

test("econ-16 actionCosts: colonize relief is 2 only for the first colonize of a turn that started with no frontier", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ALPHA }, { id: "p2" }] });
  assert.equal(s.turn?.noFrontierAtStart, true);
  assert.equal(actionCosts(withTurn(s, { colonizes: 0, noFrontierAtStart: true })).colonize, 2);
  assert.equal(actionCosts(withTurn(s, { colonizes: 1, noFrontierAtStart: true })).colonize, 4);
  assert.equal(actionCosts(withTurn(s, { colonizes: 0, noFrontierAtStart: false })).colonize, 4);
});

test("econ-17 actionCosts: trade winds make colonize 2, never below 2, and do not stack with relief", () => {
  const plain = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"] }, { id: "p2" }], event: "tradeWinds" });
  assert.equal(actionCosts(plain).colonize, 2);
  assert.equal(actionCosts(withTurn(plain, { colonizes: 1 })).colonize, 2);
  const relief = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ALPHA }, { id: "p2" }], event: "tradeWinds" });
  assert.equal(actionCosts(relief).colonize, 2);
});

test("econ-18 actionCosts: city is 3 and annex is 5 (null on ceasefire, second turn, or after an annex)", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"] }, { id: "p2" }] });
  assert.equal(actionCosts(s).city, 3);
  assert.equal(actionCosts(s).annex, 5);
  assert.equal(actionCosts(buildPlayState({ geo: miniGeo, players: [{ id: "p1" }, { id: "p2" }], event: "ceasefire" })).annex, null);
  assert.equal(actionCosts(buildPlayState({ geo: miniGeo, players: [{ id: "p1" }, { id: "p2" }], round: 2 })).annex, null);
  assert.equal(actionCosts(withTurn(s, { annexed: true })).annex, null);
});

test("econ-19 noFrontierAtStart is computed once at turn start", () => {
  // p1 owns all of Alpha (no free neighbour). Relief colonize B1, then G1 at full price; the flag stays true.
  let s: EmpireState = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ALPHA, influence: 20 }, { id: "p2", owned: ["G1"], influence: 0 }],
  });
  assert.equal(s.turn?.noFrontierAtStart, true);
  const ctx = ctxAt(miniGeo, 1, mulberry32(6));
  s = ok(applyAction(s, "p1", { type: "colonize", code: "B1" }, ctx));
  assert.equal(s.players[0].influence, 18);
  assert.equal(s.turn?.noFrontierAtStart, true);
  assert.equal(actionCosts(s).colonize, 4);
  s = ok(applyAction(s, "p1", { type: "colonize", code: "G2" }, ctxAt(miniGeo, 2)));
  assert.equal(s.players[0].influence, 14);
  s = ok(applyAction(s, "p1", { type: "endTurn" }, ctxAt(miniGeo, 3, mulberry32(6))));
  assert.equal(s.turn?.playerId, "p2");
  s = ok(applyAction(s, "p2", { type: "endTurn" }, ctxAt(miniGeo, 4, mulberry32(6))));
  assert.equal(s.round, 2);
  assert.equal(s.turn?.playerId, "p2");
  s = ok(applyAction(s, "p2", { type: "endTurn" }, ctxAt(miniGeo, 5, mulberry32(6))));
  assert.equal(s.turn?.playerId, "p1");
  assert.equal(s.turn?.noFrontierAtStart, false);
});
