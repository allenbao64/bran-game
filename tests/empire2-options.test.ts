// Rule options (plan step 2). Every option's default is the current rule; these tests cover the non-default values
// and check that the defaults still hold. Walks use buildPlayState and real engine actions; victory points are set
// with cities (a city is 1 victory point and is set as data before a round ends).
import assert from "node:assert/strict";
import test from "node:test";
import { applyAction } from "@/lib/empire2/engine";
import { actionCosts, computeIncome } from "@/lib/empire2/economy";
import { resolveRules } from "@/lib/empire2/rules";
import { createGame } from "@/lib/empire2/setup";
import { isBackToBack, isSecondOfTwo, roundOrder, setupOrder } from "@/lib/empire2/order";
import { computeTitles } from "@/lib/empire2/titles";
import { scorePlayer } from "@/lib/empire2/victory";
import { buildPlayState, ctxAt, err, makeGeo, mulberry32, ok } from "@/tests/empire2-support";
import { parseRulesOverrides } from "@/scripts/empire2-sim/config";
import { winnerPositions } from "@/scripts/empire2-sim/metrics";
import type { GameRecord } from "@/scripts/empire2-sim/types";
import type { EmpireState, Rules, TurnOrder } from "@/lib/empire2/types";

function clique(members: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) out.push([members[i], members[j]]);
  return out;
}
const range = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
const ALPHA = range("A", 6);
const BETA = range("B", 6);
const GAMMA = range("G", 6);
const DELTA = range("D", 6);

/** Four 6-country continents, each also a 6-country region, each a clique. */
const geo = makeGeo({
  continents: { Alpha: ALPHA, Beta: BETA, Gamma: GAMMA, Delta: DELTA },
  regions: { Alpha: ALPHA, Beta: BETA, Gamma: GAMMA, Delta: DELTA },
  edges: [...clique(ALPHA), ...clique(BETA), ...clique(GAMMA), ...clique(DELTA)],
});

/** City codes per seat: 4 each, taken in ascending order, so no seat ever holds 6 countries of one region. */
const SEAT_CODES = [...geo.codes()].sort();
const seatCities = (seat: number, count: number) => SEAT_CODES.slice(4 * seat, 4 * seat + count);
const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
const ctx = (now = 0, seed = 11) => ctxAt(geo, now, mulberry32(seed));

/** Sets each seat's cities (and so its victory points, which are the city count) as data. */
function withCityVp(s: EmpireState, vp: number[]): EmpireState {
  const owners = { ...s.owners };
  for (const c of s.cities) delete owners[c];
  const cities: string[] = [];
  vp.forEach((v, seat) => {
    for (const c of seatCities(seat, v)) {
      owners[c] = s.players[seat].id;
      cities.push(c);
    }
  });
  return { ...s, owners, cities: cities.sort() };
}

type Turn = { round: number; seat: number; second: boolean };
const T = (round: number, seat: number, second = false): Turn => ({ round, seat, second });

/**
 * Plays only end-of-turn actions for `rounds` rounds. `vps[r]` is the victory points by seat at the start of
 * round r+1. They are set on the round's first turn (i === 0), so they are in place when the round's last turn
 * ends, and the engine takes them as the next round's snapshot.
 */
function walk(turnOrder: TurnOrder, n: number, vps: number[][], rounds = 4): Turn[] {
  const names = ids(n);
  let s = buildPlayState({
    geo,
    players: names.map((id, seat) => ({ id, cities: seatCities(seat, vps[0][seat]) })),
    round: 1,
    indexInRound: 0,
    roundStartVp: Object.fromEntries(names.map((id, seat) => [id, vps[0][seat]])),
    rules: { turnOrder },
    now: 0,
  });
  const out: Turn[] = [];
  for (let r = 1; r <= rounds; r++) {
    for (let i = 0; i < n; i++) {
      const t = s.turn;
      assert.ok(t !== null, "walk: no turn");
      out.push(T(r, t.seat, t.isSecondOfTwo));
      if (i === 0 && r < rounds) s = withCityVp(s, vps[r]);
      s = ok(applyAction(s, t.playerId, { type: "endTurn" }, ctx()));
    }
  }
  return out;
}

const FLAT = (n: number) => [[0, 0, 0, 0].slice(0, n), [0, 0, 0, 0].slice(0, n), [0, 0, 0, 0].slice(0, n), [0, 0, 0, 0].slice(0, n)];

// ---------- 1. Turn order sequences ----------

test("turnOrder snake (default): 4 players alternate ascending and descending seats", () => {
  assert.deepEqual([1, 2, 3, 4].map((r) => roundOrder(r, 4)), [[0, 1, 2, 3], [3, 2, 1, 0], [0, 1, 2, 3], [3, 2, 1, 0]]);
  assert.deepEqual(roundOrder(3, 4, "snake"), roundOrder(3, 4));
});

test("turnOrder clockwise: every round ascending, 4 players", () => {
  assert.deepEqual([1, 2, 3, 4].map((r) => roundOrder(r, 4, "clockwise")), [[0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3]]);
});

test("turnOrder rotate: round r starts at seat (r - 1) mod n and wraps, 4 players", () => {
  assert.deepEqual([1, 2, 3, 4].map((r) => roundOrder(r, 4, "rotate")), [[0, 1, 2, 3], [1, 2, 3, 0], [2, 3, 0, 1], [3, 0, 1, 2]]);
  assert.deepEqual([1, 2, 3].map((r) => roundOrder(r, 3, "rotate")), [[0, 1, 2], [1, 2, 0], [2, 0, 1]]);
});

test("turnOrder leaderLast: lowest round-start VP first, highest last, ties by seat ascending", () => {
  assert.deepEqual(roundOrder(1, 4, "leaderLast", [0, 0, 0, 0]), [0, 1, 2, 3]);
  assert.deepEqual(roundOrder(2, 4, "leaderLast", [2, 0, 1, 1]), [1, 2, 3, 0]);
  assert.deepEqual(roundOrder(2, 3, "leaderLast", [1, 3, 1]), [0, 2, 1]);
  assert.throws(() => roundOrder(2, 3, "leaderLast"), /victory points/);
});

test("setup still snakes under every turn order (setupOrder is unchanged)", () => {
  assert.deepEqual(setupOrder(3), { capital: [0, 1, 2], foothold: [2, 1, 0] });
});

// ---------- 2. Back-to-back (isSecondOfTwo) by order, 2, 3 and 4 players, rounds 1 to 4 ----------

test("turnOrder snake: back-to-back is on the first turn of every round from 2 on, for 2, 3 and 4 players", () => {
  assert.deepEqual(walk("snake", 2, FLAT(2)), [T(1, 0), T(1, 1), T(2, 1, true), T(2, 0), T(3, 0, true), T(3, 1), T(4, 1, true), T(4, 0)]);
  assert.deepEqual(walk("snake", 3, FLAT(3)), [
    T(1, 0), T(1, 1), T(1, 2),
    T(2, 2, true), T(2, 1), T(2, 0),
    T(3, 0, true), T(3, 1), T(3, 2),
    T(4, 2, true), T(4, 1), T(4, 0),
  ]);
  const four = walk("snake", 4, FLAT(4));
  assert.deepEqual(four.filter((t) => t.second).map((t) => `${t.round}:${t.seat}`), ["2:3", "3:0", "4:3"]);
  // The engine's flag equals the snake shorthand used by old fixtures.
  for (const t of four) assert.equal(t.second, isSecondOfTwo(t.round, four.filter((x) => x.round === t.round).indexOf(t)));
});

test("turnOrder clockwise: back-to-back never happens, for 2, 3 and 4 players", () => {
  for (const n of [2, 3, 4]) {
    const turns = walk("clockwise", n, FLAT(n));
    assert.equal(turns.filter((t) => t.second).length, 0, `${n} players`);
  }
});

test("turnOrder rotate: back-to-back never happens for 3 and 4 players; with 2 players the rule holds at every boundary", () => {
  for (const n of [3, 4]) {
    assert.equal(walk("rotate", n, FLAT(n)).filter((t) => t.second).length, 0, `${n} players`);
  }
  // With 2 players, rotate gives the same seats as snake (round 2 starts at seat 1, the last seat of round 1), so
  // the rule is true at each boundary: a round's first turn is back-to-back when its player also took the previous
  // round's last turn (section 7.2).
  assert.deepEqual(walk("rotate", 2, FLAT(2)), [T(1, 0), T(1, 1), T(2, 1, true), T(2, 0), T(3, 0, true), T(3, 1), T(4, 1, true), T(4, 0)]);
});

test("turnOrder leaderLast: back-to-back can happen, for 2, 3 and 4 players (checked against hand-computed orders)", () => {
  // Round-start VP per round (index r = round r+1). The leader of a round moves last in it, and can be the lowest
  // at the next round's start, which makes it first again: that is back-to-back.
  assert.deepEqual(walk("leaderLast", 2, [[0, 0], [1, 0], [1, 1], [1, 2]]), [
    T(1, 0), T(1, 1), T(2, 1, true), T(2, 0), T(3, 0, true), T(3, 1), T(4, 0), T(4, 1),
  ]);
  assert.deepEqual(walk("leaderLast", 3, [[0, 0, 0], [1, 1, 0], [1, 0, 1], [2, 2, 0]]), [
    T(1, 0), T(1, 1), T(1, 2),
    T(2, 2, true), T(2, 0), T(2, 1),
    T(3, 1, true), T(3, 0), T(3, 2),
    T(4, 2, true), T(4, 0), T(4, 1),
  ]);
  assert.deepEqual(walk("leaderLast", 4, [[0, 0, 0, 0], [1, 1, 1, 0], [1, 1, 0, 1], [1, 1, 1, 0]]), [
    T(1, 0), T(1, 1), T(1, 2), T(1, 3),
    T(2, 3, true), T(2, 0), T(2, 1), T(2, 2),
    T(3, 2, true), T(3, 0), T(3, 1), T(3, 3),
    T(4, 3, true), T(4, 0), T(4, 1), T(4, 2),
  ]);
});

test("isBackToBack compares the last seat of the previous round with the first seat of this round", () => {
  assert.equal(isBackToBack(3, 3), true);
  assert.equal(isBackToBack(3, 0), false);
  assert.equal(isBackToBack(null, 0), false);
});

// ---------- 3. winCheck endOfRound ----------

const endRules = (extra: Partial<Rules> = {}): Partial<Rules> => ({ winCheck: "endOfRound", winPoints: 3, ...extra });

function twoPlayers(cities: [number, number], influence: [number, number], extra: Partial<Parameters<typeof buildPlayState>[0]> = {}) {
  return buildPlayState({
    geo,
    players: [
      { id: "p0", cities: seatCities(0, cities[0]), influence: influence[0] },
      { id: "p1", cities: seatCities(1, cities[1]), influence: influence[1] },
    ],
    round: 1,
    indexInRound: 0,
    rules: endRules(),
    roundStartVp: { p0: cities[0], p1: cities[1] },
    now: 0,
    ...extra,
  });
}

test("winCheck endOfRound: a player at the target mid-round does not win until the round ends", () => {
  let s = twoPlayers([3, 0], [0, 0]);
  s = ok(applyAction(s, "p0", { type: "endTurn" }, ctx()));
  assert.equal(s.phase, "play", "no win at the end of p0's turn");
  assert.equal(s.turn?.seat, 1);
  s = ok(applyAction(s, "p1", { type: "endTurn" }, ctx()));
  assert.equal(s.phase, "finished");
  assert.deepEqual(s.result?.winners, ["p0"]);
  assert.equal(s.result?.reason, "points");
  assert.equal(s.result?.round, 1);
});

test("winCheck endOfRound: the most victory points wins among the candidates", () => {
  let s = twoPlayers([3, 4], [9, 0]);
  s = ok(applyAction(s, "p0", { type: "endTurn" }, ctx()));
  s = ok(applyAction(s, "p1", { type: "endTurn" }, ctx()));
  assert.deepEqual(s.result?.winners, ["p1"], "4 points beats 3 points even with less influence");
});

test("winCheck endOfRound: a tie on points goes to more influence left", () => {
  let s = twoPlayers([3, 3], [2, 5]);
  s = ok(applyAction(s, "p0", { type: "endTurn" }, ctx()));
  s = ok(applyAction(s, "p1", { type: "endTurn" }, ctx()));
  assert.deepEqual(s.result?.winners, ["p1"]);
});

test("winCheck endOfRound: a tie on points and influence shares the win", () => {
  let s = twoPlayers([3, 3], [4, 4]);
  s = ok(applyAction(s, "p0", { type: "endTurn" }, ctx()));
  s = ok(applyAction(s, "p1", { type: "endTurn" }, ctx()));
  assert.deepEqual(s.result?.winners, ["p0", "p1"]);
  assert.equal(s.result?.reason, "points");
});

test("winCheck endOfRound: no candidate at the round end means the game goes on", () => {
  let s = twoPlayers([2, 2], [0, 0]);
  s = ok(applyAction(s, "p0", { type: "endTurn" }, ctx()));
  s = ok(applyAction(s, "p1", { type: "endTurn" }, ctx()));
  assert.equal(s.phase, "play");
  assert.equal(s.round, 2);
  assert.deepEqual(s.waitingWin, []);
});

test("winCheck endOfRound: a second-of-two turn at the target does not start a delayed win", () => {
  // Round 2 snake order is [1, 0], so seat 1's turn is the second of two.
  let s = buildPlayState({
    geo,
    players: [{ id: "p0", cities: [] }, { id: "p1", cities: seatCities(1, 3) }],
    round: 2, indexInRound: 0, rules: endRules(), roundStartVp: { p0: 0, p1: 3 }, now: 0,
  });
  assert.equal(s.turn?.isSecondOfTwo, true);
  s = ok(applyAction(s, "p1", { type: "endTurn" }, ctx()));
  assert.equal(s.phase, "play");
  assert.deepEqual(s.waitingWin, [], "no delayed win under endOfRound");
  s = ok(applyAction(s, "p0", { type: "endTurn" }, ctx()));
  assert.deepEqual(s.result?.winners, ["p1"], "p1 wins when the round ends");
});

test("winCheck endOfRound: the round 20 cap still applies to a game nobody won", () => {
  // Round 20 is even, so the snake order is descending: index 1 is seat 0.
  let s = twoPlayers([2, 1], [0, 0], { round: 20, indexInRound: 1 });
  assert.equal(s.turn?.seat, 0);
  s = ok(applyAction(s, "p0", { type: "endTurn" }, ctx()));
  assert.equal(s.phase, "finished");
  assert.equal(s.result?.reason, "cap");
  assert.deepEqual(s.result?.winners, ["p0"], "cap: most points wins");
});

test("winCheck endOfRound: a candidate at the round 20 end wins by points, not by the cap", () => {
  let s = twoPlayers([3, 1], [0, 0], { round: 20, indexInRound: 1 });
  assert.equal(s.turn?.seat, 0);
  s = ok(applyAction(s, "p0", { type: "endTurn" }, ctx()));
  assert.equal(s.result?.reason, "points");
  assert.deepEqual(s.result?.winners, ["p0"]);
});

test("winCheck endOfTurn (default): a player at the target wins at the end of their own turn", () => {
  let s = buildPlayState({
    geo,
    players: [{ id: "p0", cities: seatCities(0, 3) }, { id: "p1" }],
    round: 1, indexInRound: 0, rules: { winPoints: 3 }, roundStartVp: { p0: 3, p1: 0 }, now: 0,
  });
  s = ok(applyAction(s, "p0", { type: "endTurn" }, ctx()));
  assert.equal(s.phase, "finished");
  assert.deepEqual(s.result?.winners, ["p0"]);
});

// ---------- 4. territoryPoints off ----------

test("territoryPoints false: territory gives no victory points, but income, region sets and largest empire stay", () => {
  const owned = [...ALPHA];  // a full region (and a connected group of 6)
  const base = { geo, players: [{ id: "p0", owned }, { id: "p1" }], round: 1, indexInRound: 0, now: 0 };
  const on = buildPlayState({ ...base, rules: {} });
  const off = buildPlayState({ ...base, rules: { territoryPoints: false } });

  const vpOn = scorePlayer(on, "p0", geo);
  const vpOff = scorePlayer(off, "p0", geo);
  assert.equal(vpOn.territory, 1, "default: 6 countries give 1 point");
  assert.equal(vpOff.territory, 0, "option: no territory points");
  assert.deepEqual(vpOff.regionSets, [{ region: "Alpha", points: 3 }], "a 6-country region is worth 3");
  assert.equal(vpOff.largestEmpire, 2);
  assert.equal(vpOff.total, vpOn.total - 1);

  assert.equal(computeIncome(off, "p0", geo).territory, 1, "income still counts territory");
  assert.equal(computeIncome(off, "p0", geo).total, computeIncome(on, "p0", geo).total);
  assert.equal(computeTitles(off, geo).largestEmpire, "p0");
});

// ---------- 5. cheapColonize ----------

/** Two home continents, each owned by one player and cut off from everything else; an isolated free country. */
const HOME_A = range("H", 6);
const HOME_B = range("J", 6);
const AWAY = range("Z", 6);
const cheapGeo = makeGeo({
  continents: { Home: HOME_A, Island: HOME_B, Away: AWAY },
  regions: {},
  edges: [...clique(HOME_A), ...clique(HOME_B)],
});
const cheapCtx = () => ctxAt(cheapGeo, 0, mulberry32(5));

function stuckGame(cheapColonize: "everyStuckTurn" | "oncePerGame", extra: Partial<Parameters<typeof buildPlayState>[0]> = {}) {
  return buildPlayState({
    geo: cheapGeo,
    players: [{ id: "p0", owned: HOME_A, influence: 30 }, { id: "p1", owned: HOME_B, influence: 30 }],
    round: 1, indexInRound: 0, rules: { cheapColonize }, now: 0, ...extra,
  });
}

/**
 * The influence the last colonize cost. Read from the turn's action record: a bounty paid on the same colonize
 * can hide the cost in the influence total.
 */
const lastCost = (s: EmpireState): number => {
  const a = s.turn?.actions.at(-1);
  assert.ok(a && a.type === "colonize", "last action is a colonize");
  return a.cost;
};

/** Ends turns (and rounds) until it is `id`'s turn. */
function endTurnsUntil(s: EmpireState, id: string): EmpireState {
  let cur = s;
  for (let guard = 0; guard < 20; guard++) {
    const t = cur.turn;
    assert.ok(t !== null);
    if (t.playerId === id) return cur;
    cur = ok(applyAction(cur, t.playerId, { type: "endTurn" }, cheapCtx()));
  }
  throw new Error("turn never came");
}

test("cheapColonize everyStuckTurn (default): every stuck turn's first colonize costs the relief price", () => {
  let s = stuckGame("everyStuckTurn");
  assert.equal(actionCosts(s).colonize, 2);
  s = ok(applyAction(s, "p0", { type: "colonize", code: "Z1" }, cheapCtx()));
  assert.equal(lastCost(s), 2);
  assert.equal(actionCosts(s).colonize, 4, "still in the turn: a second colonize is full price");
  s = ok(applyAction(s, "p0", { type: "endTurn" }, cheapCtx()));
  s = endTurnsUntil(s, "p0");
  assert.equal(actionCosts(s).colonize, 2, "next stuck turn: relief again");
  s = ok(applyAction(s, "p0", { type: "colonize", code: "Z2" }, cheapCtx()));
  assert.equal(lastCost(s), 2);
});

test("cheap colonize under the default rule does not record reliefUsed", () => {
  const s = stuckGame("everyStuckTurn");
  assert.equal(actionCosts(s).colonize, 2);
  const after = ok(applyAction(s, "p0", { type: "colonize", code: "Z1" }, cheapCtx()));
  assert.equal(lastCost(after), 2, "the reduced price applies");
  assert.equal(after.reliefUsed, undefined, "reliefUsed is absent under everyStuckTurn");
});

test("cheapColonize oncePerGame: each player gets the relief once, then the full price while still stuck", () => {
  let s = stuckGame("oncePerGame");
  assert.equal(actionCosts(s).colonize, 2);
  s = ok(applyAction(s, "p0", { type: "colonize", code: "Z1" }, cheapCtx()));
  assert.equal(lastCost(s), 2);
  assert.deepEqual(s.reliefUsed, ["p0"], "p0 has used the relief");

  s = ok(applyAction(s, "p0", { type: "endTurn" }, cheapCtx()));
  s = ok(applyAction(s, "p1", { type: "colonize", code: "Z2" }, cheapCtx()));
  assert.equal(lastCost(s), 2, "p1 still gets its own relief");
  assert.deepEqual(s.reliefUsed, ["p0", "p1"]);
  s = ok(applyAction(s, "p1", { type: "endTurn" }, cheapCtx()));

  s = endTurnsUntil(s, "p0");
  assert.equal(actionCosts(s).colonize, 4, "p0 is still stuck, but the relief is used up");
  s = ok(applyAction(s, "p0", { type: "colonize", code: "Z3" }, cheapCtx()));
  assert.equal(lastCost(s), 4, "full price once the relief is used");
});

test("cheapColonize oncePerGame: a trade winds colonize does not use up the relief", () => {
  const s = stuckGame("oncePerGame", { event: "tradeWinds" });
  assert.equal(actionCosts(s).colonize, 2);
  const after = ok(applyAction(s, "p0", { type: "colonize", code: "Z1" }, cheapCtx()));
  assert.equal(lastCost(after), 2);
  assert.deepEqual(after.reliefUsed ?? [], [], "the event price, not the relief, paid for it");
});

test("cheapColonize oncePerGame: a colonize that is not stuck never uses the relief", () => {
  // p0 borders a free country, so the turn is not stuck and the price is the full 4.
  const s = buildPlayState({
    geo: cheapGeo,
    players: [{ id: "p0", owned: [...HOME_A.slice(0, 5)], influence: 30 }],
    round: 1, indexInRound: 0, rules: { cheapColonize: "oncePerGame" }, now: 0,
  });
  assert.equal(actionCosts(s).colonize, 4);
  const after = ok(applyAction(s, "p0", { type: "colonize", code: "Z1" }, cheapCtx()));
  assert.equal(lastCost(after), 4);
  assert.deepEqual(after.reliefUsed ?? [], []);
});

// ---------- 6. maxExpandsPerTurn ----------

test("maxExpandsPerTurn 2: a third expand in a turn is rejected with the cap in the message", () => {
  let s = buildPlayState({
    geo, players: [{ id: "p0", owned: ["A1"], influence: 5 }, { id: "p1" }],
    round: 1, indexInRound: 0, rules: { maxExpandsPerTurn: 2 }, now: 0,
  });
  s = ok(applyAction(s, "p0", { type: "expand", code: "A2" }, ctx()));
  s = ok(applyAction(s, "p0", { type: "expand", code: "A3" }, ctx()));
  assert.equal(s.turn?.expands, 2);
  const r = applyAction(s, "p0", { type: "expand", code: "A4" }, ctx());
  assert.equal(err(r), "expandCap");
  if (!r.ok) assert.equal(r.error.message, "You can only expand 2 times a turn.");
});

test("maxExpandsPerTurn 3 (default): a third expand in a turn is allowed, and the fourth is not", () => {
  let s = buildPlayState({
    geo, players: [{ id: "p0", owned: ["A1"], influence: 5 }, { id: "p1" }], round: 1, indexInRound: 0, now: 0,
  });
  s = ok(applyAction(s, "p0", { type: "expand", code: "A2" }, ctx()));
  s = ok(applyAction(s, "p0", { type: "expand", code: "A3" }, ctx()));
  s = ok(applyAction(s, "p0", { type: "expand", code: "A4" }, ctx()));
  assert.equal(s.turn?.expands, 3);
  assert.equal(actionCosts(s).expand, null);
  assert.equal(err(applyAction(s, "p0", { type: "expand", code: "A5" }, ctx())), "expandCap");
});

// ---------- 7. explorerMinContinents 5 ----------

const FIVE = geoFiveContinents();
function geoFiveContinents() {
  const names = ["E", "F", "G", "H", "I"];
  const continents: Record<string, string[]> = {};
  for (const x of names) continents[`C${x}`] = [`${x}1`];
  return makeGeo({ continents, regions: {}, edges: [] });
}

test("explorerMinContinents 5: four continents is not enough, five gives the explorer title", () => {
  const four = buildPlayState({
    geo: FIVE, players: [{ id: "p0", owned: ["E1", "F1", "G1", "H1"] }, { id: "p1" }], round: 1, rules: { explorerMinContinents: 5 },
  });
  assert.equal(computeTitles(four, FIVE).explorer, null);
  assert.equal(scorePlayer(four, "p0", FIVE).explorer, 0);

  const five = buildPlayState({
    geo: FIVE, players: [{ id: "p0", owned: ["E1", "F1", "G1", "H1", "I1"] }, { id: "p1" }], round: 1, rules: { explorerMinContinents: 5 },
  });
  assert.equal(computeTitles(five, FIVE).explorer, "p0");
  assert.equal(scorePlayer(five, "p0", FIVE).explorer, 2);
});

test("explorerMinContinents default 4: four continents give the explorer title", () => {
  const four = buildPlayState({
    geo: FIVE, players: [{ id: "p0", owned: ["E1", "F1", "G1", "H1"] }, { id: "p1" }], round: 1,
  });
  assert.equal(computeTitles(four, FIVE).explorer, "p0");
});

// ---------- 8. winnerPositions follows the game's turn order ----------

test("winnerPositions reads the turn order of the game: leaderLast uses the final round's snapshot", () => {
  // 3 players, 2 rounds. Final round start VP: seat 0 has 2, seat 1 has 0, seat 2 has 1.
  const g = { n: 3, rounds: 2, winners: [1], startVp: [[0, 0, 0], [2, 0, 1]] } as unknown as GameRecord;
  assert.deepEqual(winnerPositions([g], { turnOrder: "leaderLast" }).byPosition, [1, 0, 0], "seat 1 moves first");
  assert.deepEqual(winnerPositions([g], { turnOrder: "snake" }).byPosition, [0, 1, 0], "snake: round 2 is 2-1-0");
  assert.deepEqual(winnerPositions([g], { turnOrder: "clockwise" }).byPosition, [0, 1, 0]);
  assert.deepEqual(winnerPositions([g]).byPosition, [0, 1, 0], "default is snake");
});

// ---------- 9. rules.json accepts the options and validates them ----------

test("rules file accepts the four engine options with valid values", () => {
  const raw = { turnOrder: "leaderLast", winCheck: "endOfRound", territoryPoints: false, cheapColonize: "oncePerGame", explorerMinContinents: 5 };
  const parsed = parseRulesOverrides(raw);
  assert.ok(parsed.ok);
  if (!parsed.ok) throw new Error("unreachable");
  assert.deepEqual(parsed.overrides, raw);
  const rules = resolveRules(parsed.overrides);
  assert.equal(rules.turnOrder, "leaderLast");
  assert.equal(rules.explorerMinContinents, 5, "a rules.json number changes the rules the engine reads");
});

test("rules file rejects bad option values and names the key", () => {
  for (const [raw, key] of [
    [{ turnOrder: "random" }, "turnOrder"],
    [{ winCheck: 1 }, "winCheck"],
    [{ territoryPoints: "no" }, "territoryPoints"],
    [{ cheapColonize: "always" }, "cheapColonize"],
  ] as const) {
    const parsed = parseRulesOverrides(raw);
    assert.ok(!parsed.ok && parsed.errors.some((e) => e.includes(key)), `${key} should be rejected`);
  }
  assert.deepEqual(parseRulesOverrides({ turnOrder: "x" }).ok, false);
});

test("createGame rejects invalid rule options", () => {
  const bad: [string, unknown][] = [["turnOrder", "x"], ["winCheck", "x"], ["territoryPoints", "yes"], ["cheapColonize", "x"]];
  for (const [key, value] of bad) {
    const r = createGame({ playerIds: ["p0", "p1"], rules: { [key]: value } as Partial<Rules> }, ctx());
    assert.equal(r.ok, false, `${key} = ${String(value)} should be rejected`);
    if (!r.ok) {
      assert.equal(r.error.code, "badRules");
      assert.ok(r.error.message.includes(key), `message names ${key}`);
    }
  }
  const valid: Partial<Rules>[] = [
    { turnOrder: "snake" }, { turnOrder: "clockwise" }, { turnOrder: "rotate" }, { turnOrder: "leaderLast" },
    { winCheck: "endOfTurn" }, { winCheck: "endOfRound" },
    { territoryPoints: true }, { territoryPoints: false },
    { cheapColonize: "everyStuckTurn" }, { cheapColonize: "oncePerGame" },
  ];
  for (const rules of valid) ok(createGame({ playerIds: ["p0", "p1"], rules }, ctx()));
});

test("the engine defaults are the current rules", () => {
  const r = resolveRules();
  assert.equal(r.turnOrder, "snake");
  assert.equal(r.winCheck, "endOfTurn");
  assert.equal(r.territoryPoints, true);
  assert.equal(r.cheapColonize, "everyStuckTurn");
  assert.equal(r.maxExpandsPerTurn, 3);
  assert.equal(r.explorerMinContinents, 4);
});
