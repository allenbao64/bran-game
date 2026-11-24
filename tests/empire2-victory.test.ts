import assert from "node:assert/strict";
import test from "node:test";
import { applyAction } from "@/lib/empire2/engine";
import { empire2Geo } from "@/lib/empire2/geo-adapter";
import { annexProtection, isAnnexable } from "@/lib/empire2/protection";
import { completedRegions, continentsOwned, largestGroupSize } from "@/lib/empire2/state";
import { computeTitles, withTitles } from "@/lib/empire2/titles";
import { scoreAll, scorePlayer } from "@/lib/empire2/victory";
import { advanceTimeouts } from "@/lib/empire2/turns";
import { buildPlayState, ctxAt, err, makeGeo, miniGeo, mulberry32, ok } from "@/tests/empire2-support";
import type { EmpireState } from "@/lib/empire2/types";

const ALPHA = ["A1", "A2", "A3", "A4", "A5", "A6"];
const BETA = ["B1", "B2", "B3", "B4", "B5", "B6"];
const GAMMA = ["G1", "G2", "G3", "G4", "G5", "G6"];
const WIN5 = { winPoints: 5 };
const WIN4 = { winPoints: 4 };

function clique(codes: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < codes.length; i++) for (let j = i + 1; j < codes.length; j++) out.push([codes[i], codes[j]]);
  return out;
}

/** Regions of the given sizes, one continent, codes R<size>_<i>. */
function sizedRegionsGeo(sizes: number[]) {
  const regions: Record<string, string[]> = {};
  for (const size of sizes) {
    regions[`R${size}`] = Array.from({ length: size }, (_, i) => `R${size}_${i}`);
  }
  const all = Object.values(regions).flat();
  return makeGeo({ continents: { Main: all }, regions, edges: [] });
}

test("vp-01 territory is 1 point per 4 countries, floored", () => {
  const all = [...ALPHA, ...BETA, ...GAMMA];
  const expected: [number, number][] = [[3, 0], [4, 1], [7, 1], [8, 2], [12, 3]];
  for (const [n, pts] of expected) {
    const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: all.slice(0, n) }, { id: "p2" }] });
    assert.equal(scorePlayer(s, "p1", miniGeo).territory, pts, `n=${n}`);
  }
});

test("vp-02 each city is 1 point, up to 4", () => {
  const two = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1", "A2"], cities: ["A1", "A2"] }, { id: "p2" }] });
  assert.equal(scorePlayer(two, "p1", miniGeo).cities, 2);
  const five = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1", "A2", "A3", "A4", "A5"], cities: ["A1", "A2", "A3", "A4", "A5"] }, { id: "p2" }],
  });
  assert.equal(scorePlayer(five, "p1", miniGeo).cities, 4);
});

test("vp-03 region set points by size", () => {
  const geo = sizedRegionsGeo([2, 5, 6, 10, 11]);
  const pts = (size: number) => {
    const s = buildPlayState({ geo, players: [{ id: "p1", owned: geo.regionMembers(`R${size}`) }, { id: "p2" }] });
    return scorePlayer(s, "p1", geo).regionSets;
  };
  assert.deepEqual(pts(2), [{ region: "R2", points: 2 }]);
  assert.deepEqual(pts(5), [{ region: "R5", points: 2 }]);
  assert.deepEqual(pts(6), [{ region: "R6", points: 3 }]);
  assert.deepEqual(pts(10), [{ region: "R10", points: 3 }]);
  assert.deepEqual(pts(11), [{ region: "R11", points: 4 }]);
  const two = buildPlayState({
    geo,
    players: [{ id: "p1", owned: [...geo.regionMembers("R2"), ...geo.regionMembers("R5")] }, { id: "p2" }],
  });
  assert.equal(scorePlayer(two, "p1", geo).regionSets.reduce((a, r) => a + r.points, 0), 4);
});

test("vp-04 a region set needs every country, a rival holding one spoils it", () => {
  const geo = sizedRegionsGeo([6]);
  const members = geo.regionMembers("R6");
  const s = buildPlayState({
    geo,
    players: [{ id: "p1", owned: members.slice(0, 5) }, { id: "p2", owned: [members[5]] }],
  });
  assert.deepEqual(completedRegions(s, geo), []);
  assert.deepEqual(scorePlayer(s, "p1", geo).regionSets, []);
});

test("vp-05 largest empire needs a connected group of at least 6", () => {
  const five = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1", "A2", "A3", "A4", "A5"] }, { id: "p2" }] });
  assert.equal(computeTitles(five, miniGeo).largestEmpire, null);
  assert.equal(scorePlayer(five, "p1", miniGeo).largestEmpire, 0);
  const six = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ALPHA }, { id: "p2" }] });
  assert.equal(computeTitles(six, miniGeo).largestEmpire, "p1");
  assert.equal(scorePlayer(six, "p1", miniGeo).largestEmpire, 2);
});

test("vp-06 connectivity uses land borders and sea routes", () => {
  const geo = makeGeo({
    continents: { C: ["M1", "M2", "M3", "M4", "M5", "I1", "L1", "L2", "L3", "L4", "L5", "L6"] },
    regions: { R: ["M1", "M2", "M3", "M4", "M5", "I1", "L1", "L2", "L3", "L4", "L5", "L6"] },
    edges: [...clique(["M1", "M2", "M3", "M4", "M5"]), ["M5", "I1"], ["L1", "L2"], ["L2", "L3"], ["L3", "L4"], ["L4", "L5"], ["L5", "L6"]],
  });
  assert.equal(largestGroupSize(new Set(["M1", "M2", "M3", "M4", "M5", "I1"]), geo), 6, "sea-joined group counts");
  assert.equal(largestGroupSize(new Set(["L1", "L2", "L4", "L5", "L6"]), geo), 3, "group split by a rival-owned L3 does not join");
});

test("vp-07 explorer needs at least 4 continents", () => {
  const geo = makeGeo({
    continents: { C1: ["X1", "X2"], C2: ["Y1", "Y2"], C3: ["Z1", "Z2"], C4: ["W1", "W2"] },
    regions: { R: ["X1", "X2", "Y1", "Y2", "Z1", "Z2", "W1", "W2"] },
    edges: [],
  });
  const three = buildPlayState({ geo, players: [{ id: "p1", owned: ["X1", "Y1", "Z1"] }, { id: "p2" }] });
  assert.equal(computeTitles(three, geo).explorer, null);
  const four = buildPlayState({ geo, players: [{ id: "p1", owned: ["X1", "Y1", "Z1", "W1"] }, { id: "p2" }] });
  assert.equal(computeTitles(four, geo).explorer, "p1");
  assert.equal(scorePlayer(four, "p1", geo).explorer, 2);
  assert.equal(continentsOwned(new Set(["BR", "US"]), empire2Geo), 2);
});

test("vp-08 total adds every source", () => {
  const main = Array.from({ length: 13 }, (_, i) => `m${i + 1}`);
  const geo = makeGeo({
    continents: { Main: main },
    regions: { Small: ["m1", "m2"], Rest: main.slice(2) },
    edges: clique(main),
  });
  const owned = main.slice(0, 12);
  const s = buildPlayState({
    geo,
    players: [{ id: "p1", owned, cities: ["m3", "m4", "m5"] }, { id: "p2" }],
  });
  const vp = scorePlayer(s, "p1", geo);
  assert.equal(vp.territory, 3);
  assert.equal(vp.cities, 3);
  assert.deepEqual(vp.regionSets, [{ region: "Small", points: 2 }]);
  assert.equal(vp.largestEmpire, 2);
  assert.equal(vp.total, 10);
});

test("vp-09 continentsOwned counts distinct continents", () => {
  assert.equal(continentsOwned(new Set<string>(), miniGeo), 0);
  assert.equal(continentsOwned(new Set(["A1", "B1"]), miniGeo), 2);
  assert.equal(continentsOwned(new Set(["A1", "B1", "G1"]), miniGeo), 3);
  assert.equal(continentsOwned(new Set(["ZZ"]), miniGeo), 0);
  assert.equal(Object.keys(scoreAll(buildPlayState({ geo: miniGeo, players: [{ id: "p1" }, { id: "p2" }] }), miniGeo)).length, 2);
});

// ---------- win rule ----------

test("win-01 a player with 10 or more at the end of their own normal turn wins at once", () => {
  const s = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1", "A2", "A4", "A5"], cities: ["A1", "A2", "A4", "A5"] }, { id: "p2" }],
    rules: WIN5,
  });
  const done = ok(applyAction(s, "p1", { type: "endTurn" }, ctxAt(miniGeo, 0)));
  assert.equal(done.phase, "finished");
  assert.equal(done.result?.reason, "points");
  assert.deepEqual(done.result?.winners, ["p1"]);
  assert.equal(done.result?.vp.p1, 5);
});

test("win-02 nobody wins mid-turn or on another player's turn", () => {
  const s = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1", "A2", "A4", "A5"], cities: ["A1", "A2", "A4"], influence: 3 }, { id: "p2" }],
    rules: WIN5,
  });
  const mid = ok(applyAction(s, "p1", { type: "city", code: "A5", capital: "cap-a5" }, ctxAt(miniGeo, 0)));
  assert.equal(mid.phase, "play");
  assert.equal(scorePlayer(mid, "p1", miniGeo).total, 5);
  const other = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1", "A2", "A4", "A5"], cities: ["A1", "A2", "A4", "A5"] }, { id: "p2" }],
    indexInRound: 1,
    rules: WIN5,
  });
  const after = ok(applyAction(other, "p2", { type: "endTurn" }, ctxAt(miniGeo, 0, mulberry32(1))));
  assert.equal(after.phase, "play");
});

test("win-03 a player with fewer than 10 does not win", () => {
  const s = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1", "A2", "A4", "A5"], cities: ["A1", "A2"] }, { id: "p2" }],
    rules: WIN5,
  });
  const done = ok(applyAction(s, "p1", { type: "endTurn" }, ctxAt(miniGeo, 0, mulberry32(1))));
  assert.equal(done.phase, "play");
});

/** p2 (seat 1) is the second of two turns in round 2 with 5 points. */
function secondTurnWithFive(): EmpireState {
  return buildPlayState({
    geo: miniGeo,
    players: [
      { id: "p1", owned: ["A1"] },
      { id: "p2", owned: ["B1", "B2", "B4", "G1", "G4"], cities: ["B1", "B2", "G1", "G4"] },
    ],
    round: 2,
    indexInRound: 0,
    rules: WIN5,
  });
}

test("win-04 second turn in a row: 10+ at the end does not win, the player is added to waitingWin", () => {
  const s = secondTurnWithFive();
  assert.equal(s.turn?.playerId, "p2");
  assert.equal(s.turn?.isSecondOfTwo, true);
  const next = ok(applyAction(s, "p2", { type: "endTurn" }, ctxAt(miniGeo, 0, mulberry32(1))));
  assert.equal(next.phase, "play");
  assert.deepEqual(next.waitingWin, ["p2"]);
});

test("win-05 waiting player still at 10+ at the end of their next turn wins", () => {
  let s = ok(applyAction(secondTurnWithFive(), "p2", { type: "endTurn" }, ctxAt(miniGeo, 0, mulberry32(2))));
  s = ok(applyAction(s, "p1", { type: "endTurn" }, ctxAt(miniGeo, 1, mulberry32(2))));
  assert.equal(s.round, 3);
  s = ok(applyAction(s, "p1", { type: "endTurn" }, ctxAt(miniGeo, 2, mulberry32(3))));
  assert.equal(s.turn?.playerId, "p2");
  const done = ok(applyAction(s, "p2", { type: "endTurn" }, ctxAt(miniGeo, 3, mulberry32(3))));
  assert.equal(done.phase, "finished");
  assert.deepEqual(done.result?.winners, ["p2"]);
});

test("win-06 waiting player below 10 at their next turn: game goes on, removed from waitingWin, can win at a later turn as normal", () => {
  const start = buildPlayState({
    geo: miniGeo,
    players: [
      { id: "p1", owned: ["A1", "A2"], influence: 5 },
      { id: "p2", owned: ["A3", "B1", "B4", "G1"], cities: ["B1", "B4", "G1"] },
    ],
    round: 2,
    indexInRound: 0,
    rules: WIN4,
  });
  let s = ok(applyAction(start, "p2", { type: "endTurn" }, ctxAt(miniGeo, 0, mulberry32(4))));
  assert.deepEqual(s.waitingWin, ["p2"]);
  s = ok(applyAction(s, "p1", { type: "annex", code: "A3", capital: "cap-a3" }, ctxAt(miniGeo, 1)));
  assert.equal(scorePlayer(s, "p2", miniGeo).total, 3);
  s = ok(applyAction(s, "p1", { type: "endTurn" }, ctxAt(miniGeo, 2, mulberry32(4))));
  s = ok(applyAction(s, "p1", { type: "endTurn" }, ctxAt(miniGeo, 3, mulberry32(4))));
  assert.equal(s.turn?.playerId, "p2");
  s = ok(applyAction(s, "p2", { type: "endTurn" }, ctxAt(miniGeo, 4, mulberry32(4))));
  assert.equal(s.phase, "play");
  assert.deepEqual(s.waitingWin, []);
});

test("win-07 another player ending a normal turn with 10+ before the waiting player's next turn wins at once", () => {
  let s = ok(applyAction(secondTurnWithFive(), "p2", { type: "endTurn" }, ctxAt(miniGeo, 0, mulberry32(5))));
  s = buildPlayState({
    geo: miniGeo,
    players: [
      { id: "p1", owned: ["A1", "A2", "A4", "A5"], cities: ["A1", "A2", "A4"] },
      { id: "p2", owned: ["B1", "B2", "B4", "G1", "G4"], cities: ["B1", "B2", "G1", "G4"] },
    ],
    round: 2,
    indexInRound: 1,
    rules: WIN4,
    waitingWin: ["p2"],
  });
  const done = ok(applyAction(s, "p1", { type: "endTurn" }, ctxAt(miniGeo, 1)));
  assert.equal(done.phase, "finished");
  assert.deepEqual(done.result?.winners, ["p1"]);
  assert.deepEqual(done.waitingWin, ["p2"]);
});

test("win-08 the turn after a second turn is never second", () => {
  let s = ok(applyAction(secondTurnWithFive(), "p2", { type: "endTurn" }, ctxAt(miniGeo, 0, mulberry32(6))));
  assert.equal(s.turn?.playerId, "p1");
  assert.equal(s.turn?.isSecondOfTwo, false);
  s = ok(applyAction(s, "p1", { type: "endTurn" }, ctxAt(miniGeo, 1, mulberry32(6))));
  assert.equal(s.turn?.playerId, "p1");
  assert.equal(s.turn?.isSecondOfTwo, true);
  s = ok(applyAction(s, "p1", { type: "endTurn" }, ctxAt(miniGeo, 2, mulberry32(6))));
  assert.equal(s.turn?.playerId, "p2");
  assert.equal(s.turn?.isSecondOfTwo, false);
});

test("win-09 round 20 cap: highest victory points wins", () => {
  const s = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1", "A2"] }, { id: "p2", owned: ["B1", "B2", "B3", "B4"] }],
    round: 20,
    indexInRound: 1,
  });
  const done = ok(applyAction(s, "p1", { type: "endTurn" }, ctxAt(miniGeo, 0)));
  assert.equal(done.result?.reason, "cap");
  assert.deepEqual(done.result?.winners, ["p2"]);
});

test("win-10 cap tie-break: more influence left, then shared", () => {
  const more = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", influence: 5 }, { id: "p2", influence: 3 }],
    round: 20,
    indexInRound: 1,
  });
  assert.deepEqual(ok(applyAction(more, "p1", { type: "endTurn" }, ctxAt(miniGeo, 0))).result?.winners, ["p1"]);
  const tie = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", influence: 4 }, { id: "p2", influence: 4 }],
    round: 20,
    indexInRound: 1,
  });
  const shared = ok(applyAction(tie, "p1", { type: "endTurn" }, ctxAt(miniGeo, 0)));
  assert.deepEqual(shared.result?.winners, ["p1", "p2"]);
  assert.equal(shared.result?.reason, "cap");
});

test("win-11 waiting wins count for nothing at the cap", () => {
  const s = buildPlayState({
    geo: miniGeo,
    players: [
      { id: "p1", owned: ["A1", "A2", "A3", "A4"], cities: ["A1", "A2", "A3", "A4"] },
      { id: "p2", owned: ["B1", "B2", "B4", "G1"], cities: ["B1", "B2", "G1"] },
    ],
    round: 20,
    indexInRound: 1,
    waitingWin: ["p2"],
  });
  const done = ok(applyAction(s, "p1", { type: "endTurn" }, ctxAt(miniGeo, 0)));
  assert.equal(done.result?.reason, "cap");
  assert.deepEqual(done.result?.winners, ["p1"]);
});

test("win-12 a normal-turn ender with 10+ on the last turn of round 20 wins by points before the cap check", () => {
  const s = buildPlayState({
    geo: miniGeo,
    players: [
      { id: "p1", owned: ["A1", "A2", "A4", "A5"], cities: ["A1", "A2", "A4"] },
      { id: "p2", owned: ["B4", "B5", "B6", "G1", "G2", "G3", "B1"], cities: ["B1"] },
    ],
    round: 20,
    indexInRound: 1,
    waitingWin: ["p2"],
    rules: WIN4,
  });
  assert.ok(scorePlayer(s, "p2", miniGeo).total > scorePlayer(s, "p1", miniGeo).total);
  const done = ok(applyAction(s, "p1", { type: "endTurn" }, ctxAt(miniGeo, 0)));
  assert.equal(done.result?.reason, "points");
  assert.deepEqual(done.result?.winners, ["p1"]);
});

test("win-13 timeout uses the same win rule as endTurn", () => {
  const normal = buildPlayState({
    geo: miniGeo,
    players: [
      { id: "p1", owned: ["A1", "A2", "A4", "A5"], cities: ["A1", "A2", "A4"] },
      { id: "p2" },
    ],
    rules: WIN4,
    now: 0,
    turnMs: 30000,
  });
  const won = advanceTimeouts(normal, ctxAt(miniGeo, 30000));
  assert.equal(won.phase, "finished");
  assert.equal(won.result?.reason, "points");
  const second = secondTurnWithFive();
  const timed = advanceTimeouts({ ...second, turnMs: 30000, turn: second.turn && { ...second.turn, startedAt: 0 } }, ctxAt(miniGeo, 30000));
  assert.equal(timed.phase, "play");
  assert.deepEqual(timed.waitingWin, ["p2"]);
});

test("win-14 game over: every action returns gameOver", () => {
  const s = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1", "A2", "A3", "A4"], cities: ["A1", "A2", "A3", "A4"] }, { id: "p2" }],
    rules: WIN5,
  });
  const done = ok(applyAction(s, "p1", { type: "endTurn" }, ctxAt(miniGeo, 0)));
  const ctx = ctxAt(miniGeo, 1);
  assert.equal(err(applyAction(done, "p1", { type: "expand", code: "A5" }, ctx)), "gameOver");
  assert.equal(err(applyAction(done, "p2", { type: "endTurn" }, ctx)), "gameOver");
  assert.equal(err(applyAction(done, "p1", { type: "pickCapital", code: "A5" }, ctx)), "gameOver");
});

// ---------- titles ----------

test("tit-01 largest empire goes to the unique biggest group of at least 6", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ALPHA }, { id: "p2", owned: ["B1", "B2", "B3"] }] });
  assert.equal(computeTitles(s, miniGeo).largestEmpire, "p1");
});

test("tit-02 the holder keeps largest empire on a tie", () => {
  const s = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ALPHA }, { id: "p2", owned: BETA }],
    titles: { largestEmpire: "p1", explorer: null },
  });
  assert.equal(computeTitles(s, miniGeo).largestEmpire, "p1");
  const s2 = { ...s, titles: { largestEmpire: "p2", explorer: null } };
  assert.equal(computeTitles(s2, miniGeo).largestEmpire, "p2");
});

test("tit-03 a strictly bigger group displaces the holder in the same action", () => {
  const geo = makeGeo({
    continents: { P: ["P1", "P2", "P3", "P4", "P5", "P6"], Q: ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8"] },
    regions: { RP: ["P1", "P2", "P3", "P4", "P5", "P6"], RQ: ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8"] },
    edges: [...clique(["P1", "P2", "P3", "P4", "P5", "P6"]), ...clique(["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8"])],
  });
  const s = buildPlayState({
    geo,
    players: [{ id: "p1", owned: ["P1", "P2", "P3", "P4", "P5", "P6"] }, { id: "p2", owned: ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7"] }],
    titles: { largestEmpire: "p1", explorer: null },
  });
  const after = withTitles(s, geo);
  assert.equal(after.titles.largestEmpire, "p2");
  assert.deepEqual(after.log.filter((e) => e.type === "title").map((e) => e.playerId), ["p2"]);
});

test("tit-04 holder who drops below 6 loses it; a unique qualifier takes it; if several non-holders tie it is vacant", () => {
  const a = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1", "A2", "A3", "A4", "A5"] }, { id: "p2", owned: BETA }],
    titles: { largestEmpire: "p1", explorer: null },
  });
  assert.equal(computeTitles(a, miniGeo).largestEmpire, "p2");
  const b = buildPlayState({
    geo: miniGeo,
    players: [
      { id: "p1", owned: ["A1", "A2", "A3", "A4", "A5"] },
      { id: "p2", owned: BETA },
      { id: "p3", owned: GAMMA },
    ],
    titles: { largestEmpire: "p1", explorer: null },
  });
  assert.equal(computeTitles(b, miniGeo).largestEmpire, null);
  const c = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1", "A2", "A3", "A4", "A5"] }, { id: "p2" }],
    titles: { largestEmpire: "p1", explorer: null },
  });
  assert.equal(computeTitles(c, miniGeo).largestEmpire, null);
});

test("tit-05 annex that shrinks the holder moves the title in the same action", () => {
  const geo = makeGeo({
    continents: { Main: ["X1", "X2", "X3", "X4", "X5", "X6", "Y1", "Y2", "Y3", "Y4", "Y5", "F1", "F2"] },
    regions: {
      W: ["X1", "X2", "X3", "F1"],
      E: ["X4", "X5", "X6"],
      Y: ["Y1", "Y2", "Y3", "Y4", "Y5", "F2"],
    },
    edges: [...clique(["X1", "X2", "X3", "X4", "X5", "X6"]), ...clique(["Y1", "Y2", "Y3", "Y4", "Y5"]), ["Y5", "X1"]],
  });
  const s = buildPlayState({
    geo,
    players: [
      { id: "p1", owned: ["Y1", "Y2", "Y3", "Y4", "Y5"], influence: 5 },
      { id: "p2", owned: ["X1", "X2", "X3", "X4", "X5", "X6"] },
    ],
    titles: { largestEmpire: "p2", explorer: null },
    now: 0,
  });
  const after = ok(applyAction(s, "p1", { type: "annex", code: "X1", capital: "cap-x1" }, ctxAt(geo, 1)));
  assert.equal(after.owners.X1, "p1");
  assert.equal(after.titles.largestEmpire, "p1");
  assert.equal(largestGroupSize(new Set(["X2", "X3", "X4", "X5", "X6"]), geo), 5);
  assert.equal(after.log.filter((e) => e.type === "title").at(-1)?.playerId, "p1");
});

test("tit-06 explorer: same hold-on-tie and displacement rules with the 4-continent minimum", () => {
  const codes = Array.from({ length: 9 }, (_, i) => `X${i + 1}`);
  const continents: Record<string, string[]> = {};
  codes.forEach((c, i) => {
    continents[`C${i + 1}`] = [c];
  });
  const geo = makeGeo({ continents, regions: { R: codes }, edges: [] });
  const tie = buildPlayState({
    geo,
    players: [{ id: "p1", owned: ["X1", "X2", "X3", "X4"] }, { id: "p2", owned: ["X5", "X6", "X7", "X8"] }],
    titles: { largestEmpire: null, explorer: "p1" },
  });
  assert.equal(computeTitles(tie, geo).explorer, "p1");
  const displaced = buildPlayState({
    geo,
    players: [{ id: "p1", owned: ["X1", "X2", "X3", "X4"] }, { id: "p2", owned: ["X5", "X6", "X7", "X8", "X9"] }],
    titles: { largestEmpire: null, explorer: "p1" },
  });
  assert.equal(computeTitles(displaced, geo).explorer, "p2");
  const belowMin = buildPlayState({
    geo,
    players: [{ id: "p1", owned: ["X1", "X2", "X3"] }, { id: "p2", owned: ["X5", "X6", "X7", "X8"] }],
    titles: { largestEmpire: null, explorer: "p1" },
  });
  assert.equal(computeTitles(belowMin, geo).explorer, "p2");
});

test("tit-07 titles are recomputed after expand, colonize, city and annex", () => {
  const stale = { largestEmpire: null, explorer: null };
  const expand = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1", "A2", "A3", "A4", "A5"], influence: 2 }, { id: "p2" }],
    titles: stale,
  });
  assert.equal(ok(applyAction(expand, "p1", { type: "expand", code: "A6" }, ctxAt(miniGeo, 0))).titles.largestEmpire, "p1");
  const colonize = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1", "A2", "A3", "A4", "A5"], influence: 10 }, { id: "p2" }],
    titles: stale,
  });
  assert.equal(ok(applyAction(colonize, "p1", { type: "colonize", code: "A6" }, ctxAt(miniGeo, 0))).titles.largestEmpire, "p1");
  const city = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ALPHA, influence: 5 }, { id: "p2" }],
    titles: stale,
  });
  assert.equal(ok(applyAction(city, "p1", { type: "city", code: "A1", capital: "cap-a1" }, ctxAt(miniGeo, 0))).titles.largestEmpire, "p1");
  const annex = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1", "A2", "A3", "A4", "A5"], influence: 5 }, { id: "p2", owned: ["A6"] }],
    titles: stale,
  });
  assert.equal(ok(applyAction(annex, "p1", { type: "annex", code: "A6", capital: "cap-a6" }, ctxAt(miniGeo, 0))).titles.largestEmpire, "p1");
});

test("tit-08 one player can hold both titles and both are worth 2", () => {
  const geo = makeGeo({
    continents: { C1: ["X1", "X2"], C2: ["X3"], C3: ["X4"], C4: ["X5", "X6"] },
    regions: { R: ["X1", "X2", "X3", "X4", "X5", "X6", "F"] },
    edges: clique(["X1", "X2", "X3", "X4", "X5", "X6"]),
  });
  const s = buildPlayState({ geo, players: [{ id: "p1", owned: ["X1", "X2", "X3", "X4", "X5", "X6"] }, { id: "p2" }] });
  const vp = scorePlayer(s, "p1", geo);
  assert.equal(vp.largestEmpire, 2);
  assert.equal(vp.explorer, 2);
  assert.equal(vp.total, 1 + 2 + 2);
});

test("tit-09 title log entries are written only when the holder changes", () => {
  const s = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1", "A2", "A3", "A4", "A5"], influence: 2 }, { id: "p2", influence: 10 }],
    titles: { largestEmpire: null, explorer: null },
  });
  const first = ok(applyAction(s, "p1", { type: "expand", code: "A6" }, ctxAt(miniGeo, 0)));
  assert.equal(first.log.filter((e) => e.type === "title").length, 1);
  const turned = ok(applyAction(first, "p1", { type: "endTurn" }, ctxAt(miniGeo, 1, mulberry32(7))));
  const again = ok(applyAction(turned, "p2", { type: "colonize", code: "B1" }, ctxAt(miniGeo, 2)));
  assert.equal(again.log.filter((e) => e.type === "title").length, 1);
});

// ---------- protection ----------

test("prot-01 annexProtection precedence and null cases", () => {
  const withCity = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1" }, { id: "p2", owned: ["A1"], cities: ["A1"], capital: "A1", foothold: "A1" }],
  });
  assert.equal(annexProtection(withCity, "A1", miniGeo), "city");
  const capitalOnly = buildPlayState({ geo: miniGeo, players: [{ id: "p1" }, { id: "p2", owned: ["A1"], capital: "A1", foothold: "A1" }] });
  assert.equal(annexProtection(capitalOnly, "A1", miniGeo), "startingCapital");
  const footholdOnly = buildPlayState({ geo: miniGeo, players: [{ id: "p1" }, { id: "p2", owned: ["A1"], foothold: "A1" }] });
  assert.equal(annexProtection(footholdOnly, "A1", miniGeo), "foothold");
  const set = buildPlayState({ geo: miniGeo, players: [{ id: "p1" }, { id: "p2", owned: ["A4", "A5", "A6"] }] });
  assert.equal(annexProtection(set, "A4", miniGeo), "regionSet");
  const plain = buildPlayState({ geo: miniGeo, players: [{ id: "p1" }, { id: "p2", owned: ["A2"] }] });
  assert.equal(annexProtection(plain, "A2", miniGeo), null);
  assert.equal(annexProtection(plain, "A3", miniGeo), null);
  assert.equal(isAnnexable(plain, "A3", miniGeo), false);
});

test("prot-02 isAnnexable is derived from state only", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"] }, { id: "p2", owned: ["A4", "A5", "A6"] }] });
  assert.equal(isAnnexable(s, "A4", miniGeo), false);
  assert.equal(isAnnexable(s, "A4", miniGeo), false);
  const broken = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1", "A6"] }, { id: "p2", owned: ["A4", "A5"] }] });
  assert.equal(isAnnexable(broken, "A4", miniGeo), true);
  assert.equal(completedRegions(broken, miniGeo).length, 0);
});
