import assert from "node:assert/strict";
import test from "node:test";
import { applyAction } from "@/lib/empire2/engine";
import { applyPlayAction, legalMoves } from "@/lib/empire2/actions";
import { empire2Geo } from "@/lib/empire2/geo-adapter";
import { frontier, freeCountries } from "@/lib/empire2/state";
import { buildPlayState, ctxAt, deepFreeze, err, makeGeo, miniGeo, mulberry32, ok } from "@/tests/empire2-support";
import type { Action, EmpireState, TurnState } from "@/lib/empire2/types";

const c0 = () => ctxAt(miniGeo, 0);
const ALPHA = ["A1", "A2", "A3", "A4", "A5", "A6"];

function withTurn(s: EmpireState, patch: Partial<TurnState>): EmpireState {
  if (s.turn === null) throw new Error("no turn");
  return { ...s, turn: { ...s.turn, ...patch } };
}

/** Island map: M1-M2 on the mainland, I1 linked only by a sea route to M1. */
const islandGeo = makeGeo({
  continents: { Main: ["M1", "M2"], Isle: ["I1", "I2"] },
  regions: { Main: ["M1", "M2"], Isle: ["I1", "I2"] },
  edges: [["M1", "M2"], ["M1", "I1"]],
});

// ---------- expand ----------

test("exp-01 first expand each turn is free", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 0 }, { id: "p2" }] });
  const next = ok(applyAction(s, "p1", { type: "expand", code: "A2" }, c0()));
  assert.equal(next.players[0].influence, 0);
  assert.equal(next.turn?.actions[0].cost, 0);
});

test("exp-02 second and third expand cost 1 each", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 5 }, { id: "p2" }] });
  const a = ok(applyAction(s, "p1", { type: "expand", code: "A2" }, c0()));
  const b = ok(applyAction(a, "p1", { type: "expand", code: "A3" }, c0()));
  const c = ok(applyAction(b, "p1", { type: "expand", code: "A4" }, c0()));
  assert.deepEqual([s.players[0].influence, a.players[0].influence, b.players[0].influence, c.players[0].influence], [5, 5, 4, 3]);
});

test("exp-03 a fourth expand is rejected with expandCap", () => {
  let s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 100 }, { id: "p2" }] });
  for (const code of ["A2", "A3", "A4"]) s = ok(applyAction(s, "p1", { type: "expand", code }, c0()));
  assert.equal(err(applyAction(s, "p1", { type: "expand", code: "A5" }, c0())), "expandCap");
});

test("exp-04 expand needs a free country on the frontier", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 5 }, { id: "p2" }] });
  assert.equal(err(applyAction(s, "p1", { type: "expand", code: "B1" }, c0())), "notOnFrontier");
});

test("exp-05 expand reaches across a sea route", () => {
  const s = buildPlayState({ geo: islandGeo, players: [{ id: "p1", owned: ["M1"] }, { id: "p2" }] });
  assert.ok(frontier(s, "p1", islandGeo).includes("I1"));
  assert.equal(ok(applyAction(s, "p1", { type: "expand", code: "I1" }, ctxAt(islandGeo, 0))).owners.I1, "p1");
});

test("exp-06 an owned country (any owner) cannot be expanded into", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 5 }, { id: "p2", owned: ["A2"] }] });
  assert.equal(err(applyAction(s, "p1", { type: "expand", code: "A2" }, c0())), "countryTaken");
});

test("exp-07 blocking: a rival-owned chokepoint removes the frontier through it", () => {
  const chain = makeGeo({
    continents: { C: ["A", "B", "C"] },
    regions: { R: ["A", "B", "C"] },
    edges: [["A", "B"], ["B", "C"]],
  });
  const s = buildPlayState({ geo: chain, players: [{ id: "p1", owned: ["A"] }, { id: "p2", owned: ["B"] }] });
  assert.deepEqual(frontier(s, "p1", chain), []);
  assert.equal(err(applyAction(s, "p1", { type: "expand", code: "C" }, ctxAt(chain, 0))), "notOnFrontier");
});

test("exp-08 expand with too little influence is rejected", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 0 }, { id: "p2" }] });
  const first = ok(applyAction(s, "p1", { type: "expand", code: "A2" }, c0()));
  assert.equal(err(applyAction(first, "p1", { type: "expand", code: "A3" }, c0())), "notEnoughInfluence");
});

test("exp-09 closed borders: expands cost 1 more including the first", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 1 }, { id: "p2" }], event: "closedBorders" });
  const first = ok(applyAction(s, "p1", { type: "expand", code: "A2" }, c0()));
  assert.equal(first.players[0].influence, 0);
  assert.equal(err(applyAction(first, "p1", { type: "expand", code: "A3" }, c0())), "notEnoughInfluence");
  const overridden = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1"], influence: 5 }, { id: "p2" }],
    event: "closedBorders",
    rules: { closedBordersExtra: 2 },
  });
  assert.equal(ok(applyAction(overridden, "p1", { type: "expand", code: "A2" }, c0())).players[0].influence, 3);
});

test("exp-10 unknown or lowercase codes", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 5 }, { id: "p2" }] });
  assert.equal(err(applyAction(s, "p1", { type: "expand", code: "zz" }, c0())), "unknownCountry");
  assert.equal(ok(applyAction(s, "p1", { type: "expand", code: "a2" }, c0())).owners.A2, "p1");
});

// ---------- colonize ----------

test("col-01 colonize costs 4 and can name any free country", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 10 }, { id: "p2" }] });
  const next = ok(applyAction(s, "p1", { type: "colonize", code: "G6" }, c0()));
  assert.equal(next.players[0].influence, 6);
  assert.equal(next.owners.G6, "p1");
});

test("col-02 colonize with less than 4 influence is rejected", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 3 }, { id: "p2" }] });
  assert.equal(err(applyAction(s, "p1", { type: "colonize", code: "B1" }, c0())), "notEnoughInfluence");
});

test("col-03 colonize relief: first colonize of a no-frontier turn costs 2, the second costs 4", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ALPHA, influence: 10 }, { id: "p2" }] });
  const one = ok(applyAction(s, "p1", { type: "colonize", code: "B1" }, c0()));
  assert.equal(one.players[0].influence, 8);
  const two = ok(applyAction(one, "p1", { type: "colonize", code: "B2" }, c0()));
  assert.equal(two.players[0].influence, 4);
});

test("col-04 relief needs no free country on the frontier at the start of the turn", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 10 }, { id: "p2" }] });
  assert.equal(ok(applyAction(s, "p1", { type: "colonize", code: "B1" }, c0())).players[0].influence, 6);
});

test("col-05 trade winds colonize costs 2, never less, and relief does not stack", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ALPHA, influence: 10 }, { id: "p2" }], event: "tradeWinds" });
  const one = ok(applyAction(s, "p1", { type: "colonize", code: "B1" }, c0()));
  assert.equal(one.players[0].influence, 8);
  const two = ok(applyAction(one, "p1", { type: "colonize", code: "B2" }, c0()));
  assert.equal(two.players[0].influence, 6);
});

test("col-06 closed borders does not change colonize", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 10 }, { id: "p2" }], event: "closedBorders" });
  assert.equal(ok(applyAction(s, "p1", { type: "colonize", code: "B1" }, c0())).players[0].influence, 6);
});

test("col-07 colonize has no per-turn limit beyond influence", () => {
  let s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 20 }, { id: "p2" }] });
  for (const code of ["B1", "B2", "B3"]) s = ok(applyAction(s, "p1", { type: "colonize", code }, c0()));
  assert.equal(s.players[0].influence, 8);
  assert.equal(s.turn?.colonizes, 3);
});

test("col-08 colonizing a taken country is rejected", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 10 }, { id: "p2", owned: ["B1"] }] });
  assert.equal(err(applyAction(s, "p1", { type: "colonize", code: "B1" }, c0())), "countryTaken");
});

test("col-09 colonizing a frontier country is allowed at the colonize price", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 4 }, { id: "p2" }] });
  const next = ok(applyAction(s, "p1", { type: "colonize", code: "A2" }, c0()));
  assert.equal(next.players[0].influence, 0);
  assert.equal(next.owners.A2, "p1");
});

// ---------- city ----------

test("city-01 build a city costs 3, adds it to cities", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 5 }, { id: "p2" }] });
  const next = ok(applyAction(s, "p1", { type: "city", code: "A1", capital: "cap-a1" }, c0()));
  assert.equal(next.players[0].influence, 2);
  assert.deepEqual(next.cities, ["A1"]);
});

test("city-02 city needs an owned country", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 5 }, { id: "p2", owned: ["B1"] }] });
  assert.equal(err(applyAction(s, "p1", { type: "city", code: "B1", capital: "cap-b1" }, c0())), "notOwned");
  assert.equal(err(applyAction(s, "p1", { type: "city", code: "A6", capital: "cap-a6" }, c0())), "notOwned");
});

test("city-03 only one city per country", () => {
  let s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 10 }, { id: "p2" }] });
  s = ok(applyAction(s, "p1", { type: "city", code: "A1", capital: "cap-a1" }, c0()));
  assert.equal(err(applyAction(s, "p1", { type: "city", code: "A1", capital: "cap-a1" }, c0())), "alreadyCity");
});

test("city-04 up to 4 cities, the fifth is rejected", () => {
  let s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1", "A2", "A3", "A4", "A5"], influence: 20 }, { id: "p2" }] });
  for (const code of ["A1", "A2", "A3", "A4"]) s = ok(applyAction(s, "p1", { type: "city", code, capital: `cap-${code.toLowerCase()}` }, c0()));
  assert.equal(err(applyAction(s, "p1", { type: "city", code: "A5", capital: "cap-a5" }, c0())), "cityLimit");
});

test("city-05 wrong capital costs nothing and changes nothing", () => {
  const s = deepFreeze(buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 5 }, { id: "p2" }], now: 100 }));
  const before = structuredClone(s);
  assert.equal(err(applyAction(s, "p1", { type: "city", code: "A1", capital: "nope" }, ctxAt(miniGeo, 200))), "wrongCapital");
  assert.deepEqual(s, before);
  const next = ok(applyAction(s, "p1", { type: "city", code: "A1", capital: "cap-a1" }, ctxAt(miniGeo, 300)));
  assert.equal(next.players[0].influence, 2);
  assert.equal(next.turn?.startedAt, 100);
});

test("city-06 city with too little influence is rejected before the capital quiz", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 2 }, { id: "p2" }] });
  assert.equal(err(applyAction(s, "p1", { type: "city", code: "A1", capital: "nope" }, c0())), "notEnoughInfluence");
});

test("city-07 a city on a starting capital or foothold is allowed", () => {
  const s = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1", "A2"], influence: 6, capital: "A1", foothold: "A2" }, { id: "p2" }],
  });
  let next = ok(applyAction(s, "p1", { type: "city", code: "A1", capital: "cap-a1" }, c0()));
  next = ok(applyAction(next, "p1", { type: "city", code: "A2", capital: "cap-a2" }, c0()));
  assert.deepEqual(next.cities, ["A1", "A2"]);
});

test("city-08 capital matching is tolerant", () => {
  const s = buildPlayState({ geo: empire2Geo, players: [{ id: "p1", owned: ["FR"], influence: 5 }, { id: "p2" }] });
  assert.deepEqual(ok(applyAction(s, "p1", { type: "city", code: "FR", capital: "paris" }, ctxAt(empire2Geo, 0))).cities, ["FR"]);
  assert.deepEqual(ok(applyAction(s, "p1", { type: "city", code: "FR", capital: "Parrs" }, ctxAt(empire2Geo, 0))).cities, ["FR"]);
  assert.equal(err(applyAction(s, "p1", { type: "city", code: "FR", capital: "lyon" }, ctxAt(empire2Geo, 0))), "wrongCapital");
});

// ---------- annex ----------

/** p1 owns A1, p2 owns A2 (both start with 0 snapshot, so annexing is allowed). */
function annexBase(extra: Partial<Parameters<typeof buildPlayState>[0]> = {}, influence = 10): EmpireState {
  return buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1"], influence }, { id: "p2", owned: ["A2", "A3"] }],
    ...extra,
  });
}

test("ann-01 annex costs 5, takes the country, once a turn", () => {
  const s = annexBase();
  const once = ok(applyAction(s, "p1", { type: "annex", code: "A2", capital: "cap-a2" }, c0()));
  assert.equal(once.players[0].influence, 5);
  assert.equal(once.owners.A2, "p1");
  assert.equal(once.turn?.annexed, true);
  assert.equal(err(applyAction(once, "p1", { type: "annex", code: "A3", capital: "cap-a3" }, c0())), "annexUsed");
});

test("ann-02 annex target must border your empire", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 10 }, { id: "p2", owned: ["B1"] }] });
  assert.equal(err(applyAction(s, "p1", { type: "annex", code: "B1", capital: "cap-b1" }, c0())), "notBordering");
  const island = buildPlayState({ geo: islandGeo, players: [{ id: "p1", owned: ["M1"], influence: 10 }, { id: "p2", owned: ["I1"] }] });
  assert.equal(ok(applyAction(island, "p1", { type: "annex", code: "I1", capital: "cap-i1" }, ctxAt(islandGeo, 0))).owners.I1, "p1");
});

test("ann-03 annex needs a rival-owned country", () => {
  const s = annexBase();
  assert.equal(err(applyAction(s, "p1", { type: "annex", code: "A6", capital: "cap-a6" }, c0())), "notRival");
  assert.equal(err(applyAction(s, "p1", { type: "annex", code: "A1", capital: "cap-a1" }, c0())), "notRival");
});

test("ann-04 target owner must be at or above you in the round-start standings", () => {
  const below = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1"], influence: 10 }, { id: "p2", owned: ["A2", "A3", "A4", "A5", "B1", "B2", "B3", "B4"] }],
    roundStartVp: { p1: 3, p2: 2 },
  });
  assert.equal(err(applyAction(below, "p1", { type: "annex", code: "A2", capital: "cap-a2" }, c0())), "targetBelow");
  const equal = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1"], influence: 10 }, { id: "p2", owned: ["A2"] }],
    roundStartVp: { p1: 3, p2: 3 },
  });
  assert.equal(ok(applyAction(equal, "p1", { type: "annex", code: "A2", capital: "cap-a2" }, c0())).owners.A2, "p1");
});

test("ann-05 cities cannot be annexed", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 10 }, { id: "p2", owned: ["A2"], cities: ["A2"] }] });
  assert.equal(err(applyAction(s, "p1", { type: "annex", code: "A2", capital: "cap-a2" }, c0())), "protectedCity");
});

test("ann-06 starting capitals cannot be annexed", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 10 }, { id: "p2", owned: ["A2"], capital: "A2" }] });
  assert.equal(err(applyAction(s, "p1", { type: "annex", code: "A2", capital: "cap-a2" }, c0())), "protectedStartingCapital");
});

test("ann-07 setup footholds cannot be annexed", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 10 }, { id: "p2", owned: ["A2"], foothold: "A2" }] });
  assert.equal(err(applyAction(s, "p1", { type: "annex", code: "A2", capital: "cap-a2" }, c0())), "protectedFoothold");
});

test("ann-08 countries in a completed region set cannot be annexed", () => {
  const complete = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1"], influence: 10 }, { id: "p2", owned: ["A4", "A5", "A6"] }],
  });
  assert.equal(err(applyAction(complete, "p1", { type: "annex", code: "A4", capital: "cap-a4" }, c0())), "protectedRegionSet");
  const broken = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1"], influence: 10 }, { id: "p2", owned: ["A4", "A5"] }, { id: "p3", owned: ["A6"] }],
  });
  assert.equal(ok(applyAction(broken, "p1", { type: "annex", code: "A4", capital: "cap-a4" }, c0())).owners.A4, "p1");
});

test("ann-09 no annexing during a ceasefire", () => {
  const s = annexBase({ event: "ceasefire" });
  assert.equal(err(applyAction(s, "p1", { type: "annex", code: "A2", capital: "cap-a2" }, c0())), "ceasefire");
});

test("ann-10 no annexing on the second of two turns in a row", () => {
  // round 1, last turn for p2: a normal turn, annex allowed
  const first = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1"], influence: 10 }, { id: "p2", owned: ["A2"], influence: 10 }],
    round: 1,
    indexInRound: 1,
  });
  assert.equal(ok(applyAction(first, "p2", { type: "annex", code: "A1", capital: "cap-a1" }, c0())).owners.A1, "p2");
  // round 2, first turn for p2: the second of two turns, annex refused
  const second = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1"], influence: 10 }, { id: "p2", owned: ["A2"], influence: 10 }],
    round: 2,
    indexInRound: 0,
  });
  assert.equal(err(applyAction(second, "p2", { type: "annex", code: "A1", capital: "cap-a1" }, c0())), "secondTurnNoAnnex");
});

test("ann-11 wrong capital costs nothing, uses no annex, clock unchanged", () => {
  const s = annexBase({ now: 500 });
  const wrong = applyAction(s, "p1", { type: "annex", code: "A2", capital: "nope" }, ctxAt(miniGeo, 600));
  assert.equal(err(wrong), "wrongCapital");
  const again = applyAction(s, "p1", { type: "annex", code: "A2", capital: "nope" }, ctxAt(miniGeo, 700));
  assert.equal(err(again), "wrongCapital");
  const right = ok(applyAction(s, "p1", { type: "annex", code: "A2", capital: "cap-a2" }, ctxAt(miniGeo, 800)));
  assert.equal(right.players[0].influence, 5);
  assert.equal(right.turn?.startedAt, 500);
  assert.equal(s.turn?.annexed, false);
});

test("ann-12 annex with too little influence is rejected before the quiz", () => {
  const s = annexBase({}, 4);
  assert.equal(err(applyAction(s, "p1", { type: "annex", code: "A2", capital: "nope" }, c0())), "notEnoughInfluence");
});

test("ann-13 annex check order", () => {
  const second = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1"], influence: 10 }, { id: "p2", owned: ["A2"], cities: ["A2"] }],
    round: 2,
    indexInRound: 0,
    event: "ceasefire",
  });
  assert.equal(err(applyAction(second, "p2", { type: "annex", code: "ZZ", capital: "x" }, c0())), "secondTurnNoAnnex");
  const ceasefire = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1"], influence: 10 }, { id: "p2", owned: ["A2"], cities: ["A2"] }],
    event: "ceasefire",
    indexInRound: 0,
  });
  assert.equal(err(applyAction(ceasefire, "p1", { type: "annex", code: "A2", capital: "cap-a2" }, c0())), "ceasefire");
  const used = ok(applyAction(annexBase(), "p1", { type: "annex", code: "A2", capital: "cap-a2" }, c0()));
  assert.equal(err(applyAction(used, "p1", { type: "annex", code: "ZZ", capital: "x" }, c0())), "annexUsed");
  const unknown = annexBase();
  assert.equal(err(applyAction(unknown, "p1", { type: "annex", code: "ZZ", capital: "x" }, c0())), "unknownCountry");
  const city = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1"], influence: 10 }, { id: "p2", owned: ["A2"], cities: ["A2"], capital: "A2", foothold: "A2" }],
  });
  assert.equal(err(applyAction(city, "p1", { type: "annex", code: "A2", capital: "cap-a2" }, c0())), "protectedCity");
  const capital = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1"], influence: 10 }, { id: "p2", owned: ["A2"], capital: "A2", foothold: "A2" }],
  });
  assert.equal(err(applyAction(capital, "p1", { type: "annex", code: "A2", capital: "cap-a2" }, c0())), "protectedStartingCapital");
});

test("ann-14 annex never claims a bounty", () => {
  const s = annexBase({ bounties: [{ id: "r1-0", kind: "letter", value: "A" }] });
  const next = ok(applyAction(s, "p1", { type: "annex", code: "A2", capital: "cap-a2" }, c0()));
  assert.equal(next.players[0].influence, 5);
  assert.equal(next.bounties.length, 1);
});

test("ann-15 annexing can break the victim's largest empire and region set, and titles update in the same action", () => {
  // Largest-empire part only. The region-set part of this name cannot happen under section 12.5: every country of a
  // completed region is protected from annexing, so a completed set cannot be broken by an annex (reported to lead).
  const s = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1", "A2", "A3", "A4", "A5"], influence: 5 }, { id: "p2", owned: ["A6"] }],
    titles: { largestEmpire: null, explorer: null },
  });
  const next = ok(applyAction(s, "p1", { type: "annex", code: "A6", capital: "cap-a6" }, c0()));
  assert.equal(next.titles.largestEmpire, "p1");
});

// ---------- end turn, legal moves, errors ----------

test("end-01 endTurn is free and passes play on", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", influence: 4 }, { id: "p2" }] });
  const next = ok(applyAction(s, "p1", { type: "endTurn" }, c0()));
  assert.equal(next.players[0].influence, 4);
  assert.equal(next.turn?.playerId, "p2");
});

test("end-02 wrong player or wrong phase", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1" }, { id: "p2" }] });
  assert.equal(err(applyAction(s, "p2", { type: "endTurn" }, c0())), "notYourTurn");
  const finished = { ...s, phase: "finished" as const, turn: null };
  assert.equal(err(applyAction(finished, "p1", { type: "endTurn" }, c0())), "gameOver");
  const setupLike = { ...s, phase: "setup" as const, turn: null, setup: { step: "capital" as const, order: [0, 1], cursor: 0, offers: [] } };
  assert.equal(err(applyPlayAction(setupLike, "p1", { type: "endTurn" }, c0())), "wrongPhase");
});

test("legal-01 legalMoves lists exactly the accepted actions", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 10, capital: "A1" }, { id: "p2", owned: ["A2"] }] });
  const moves = legalMoves(s, miniGeo);
  assert.deepEqual(moves.expand, ["A3", "A4", "A5", "A6"]);
  assert.deepEqual(moves.colonize, freeCountries(s, miniGeo));
  assert.deepEqual(moves.city, ["A1"]);
  assert.deepEqual(moves.annex, ["A2"]);
  for (const code of moves.expand) assert.ok(applyAction(s, "p1", { type: "expand", code }, c0()).ok);
  for (const code of ["B1", "G1"]) assert.equal(err(applyAction(s, "p1", { type: "expand", code }, c0())), "notOnFrontier");
  for (const code of moves.colonize) assert.ok(applyAction(s, "p1", { type: "colonize", code }, c0()).ok);
  assert.ok(applyAction(s, "p1", { type: "city", code: "A1", capital: "cap-a1" }, c0()).ok);
  assert.equal(err(applyAction(s, "p1", { type: "city", code: "A1", capital: "nope" }, c0())), "wrongCapital");
});

test("legal-01b annex list and affordability", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 5 }, { id: "p2", owned: ["A2"] }] });
  assert.deepEqual(legalMoves(s, miniGeo).annex, ["A2"]);
  assert.ok(applyAction(s, "p1", { type: "annex", code: "A2", capital: "cap-a2" }, c0()).ok);
  const poor = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 4 }, { id: "p2", owned: ["A2"] }] });
  assert.deepEqual(legalMoves(poor, miniGeo).annex, []);
  assert.equal(legalMoves(poor, miniGeo).colonize.length, freeCountries(poor, miniGeo).length);
  const broke = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 3 }, { id: "p2", owned: ["A2"] }] });
  assert.deepEqual(legalMoves(broke, miniGeo).colonize, []);
});

test("legal-02 frontier is free neighbours of the empire", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1", "B1"] }, { id: "p2", owned: ["A2"] }] });
  assert.deepEqual(frontier(s, "p1", miniGeo), ["A3", "A4", "A5", "A6", "B2", "B3", "B4", "B5", "B6"]);
});

test("err-01 garbage input never throws", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 5 }, { id: "p2" }] });
  const garbage: unknown[] = [null, {}, { type: "expand" }, { type: "expand", code: 5 }, { type: "nope" }, "expand", 7];
  for (const g of garbage) {
    const r = applyAction(s, "p1", g as Action, c0());
    assert.equal(r.ok, false);
  }
  assert.equal(err(applyAction(s, "p1", { type: "expand" } as Action, c0())), "unknownCountry");
  assert.equal(err(applyAction(s, "p1", { type: "expand", code: 5 } as unknown as Action, c0())), "unknownCountry");
  assert.equal(err(applyAction(s, "p1", { type: "nope" } as unknown as Action, c0())), "unknownAction");
  assert.equal(err(applyAction(s, "p1", null as unknown as Action, c0())), "unknownAction");
});

test("err-02 every rejection leaves the input state deep-equal to a snapshot", () => {
  type Row = { state: EmpireState; pid: string; action: Action; now: number; code: string; setupLike?: boolean };
  const plain = (extra: Partial<Parameters<typeof buildPlayState>[0]> = {}) =>
    buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 5 }, { id: "p2", owned: ["B1"] }], ...extra });
  const rows: Row[] = [
    { state: plain(), pid: "p2", action: { type: "endTurn" }, now: 0, code: "notYourTurn" },
    { state: plain({ now: 0, turnMs: 30000 }), pid: "p1", action: { type: "expand", code: "A2" }, now: 30000, code: "turnExpired" },
    { state: plain(), pid: "p1", action: { type: "expand", code: "ZZ" }, now: 0, code: "unknownCountry" },
    { state: plain(), pid: "p1", action: { type: "expand", code: "B1" }, now: 0, code: "countryTaken" },
    { state: plain(), pid: "p1", action: { type: "expand", code: "B2" }, now: 0, code: "notOnFrontier" },
    { state: withTurn(plain(), { expands: 3 }), pid: "p1", action: { type: "expand", code: "A2" }, now: 0, code: "expandCap" },
    { state: buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 0 }, { id: "p2" }] }), pid: "p1", action: { type: "colonize", code: "B2" }, now: 0, code: "notEnoughInfluence" },
    { state: plain(), pid: "p1", action: { type: "city", code: "B1", capital: "cap-b1" }, now: 0, code: "notOwned" },
    { state: buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 9, cities: ["A1"] }, { id: "p2" }] }), pid: "p1", action: { type: "city", code: "A1", capital: "cap-a1" }, now: 0, code: "alreadyCity" },
    { state: buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1", "A2", "A3", "A4", "A5"], influence: 20, cities: ["A1", "A2", "A3", "A4"] }, { id: "p2" }] }), pid: "p1", action: { type: "city", code: "A5", capital: "cap-a5" }, now: 0, code: "cityLimit" },
    { state: plain(), pid: "p1", action: { type: "city", code: "A1", capital: "nope" }, now: 0, code: "wrongCapital" },
    { state: plain(), pid: "p1", action: { type: "annex", code: "A1", capital: "cap-a1" }, now: 0, code: "notRival" },
    { state: plain(), pid: "p1", action: { type: "annex", code: "B1", capital: "cap-b1" }, now: 0, code: "notBordering" },
    { state: withTurn(buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 9 }, { id: "p2", owned: ["A2"] }] }), { annexed: true }), pid: "p1", action: { type: "annex", code: "A2", capital: "cap-a2" }, now: 0, code: "annexUsed" },
    { state: buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 9 }, { id: "p2", owned: ["A2"] }], round: 2, indexInRound: 0 }), pid: "p2", action: { type: "annex", code: "A1", capital: "cap-a1" }, now: 0, code: "secondTurnNoAnnex" },
    { state: buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 9 }, { id: "p2", owned: ["A2"] }], event: "ceasefire" }), pid: "p1", action: { type: "annex", code: "A2", capital: "cap-a2" }, now: 0, code: "ceasefire" },
    { state: buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 9 }, { id: "p2", owned: ["A2"], cities: ["A2"] }] }), pid: "p1", action: { type: "annex", code: "A2", capital: "cap-a2" }, now: 0, code: "protectedCity" },
    { state: buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 9 }, { id: "p2", owned: ["A2"], capital: "A2" }] }), pid: "p1", action: { type: "annex", code: "A2", capital: "cap-a2" }, now: 0, code: "protectedStartingCapital" },
    { state: buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 9 }, { id: "p2", owned: ["A2"], foothold: "A2" }] }), pid: "p1", action: { type: "annex", code: "A2", capital: "cap-a2" }, now: 0, code: "protectedFoothold" },
    { state: buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 9 }, { id: "p2", owned: ["A4", "A5", "A6"] }] }), pid: "p1", action: { type: "annex", code: "A4", capital: "cap-a4" }, now: 0, code: "protectedRegionSet" },
    { state: buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 9 }, { id: "p2", owned: ["A2"] }], roundStartVp: { p1: 3, p2: 2 } }), pid: "p1", action: { type: "annex", code: "A2", capital: "cap-a2" }, now: 0, code: "targetBelow" },
    { state: plain(), pid: "p1", action: { type: "nope" } as unknown as Action, now: 0, code: "unknownAction" },
    { state: { ...plain(), phase: "finished", turn: null }, pid: "p1", action: { type: "endTurn" }, now: 0, code: "gameOver" },
    { state: plain(), pid: "p1", action: { type: "pickCapital", code: "A2" }, now: 0, code: "wrongPhase" },
  ];
  for (const row of rows) {
    const s = deepFreeze(row.state);
    const snapshot = structuredClone(s);
    const r = applyAction(s, row.pid, row.action, ctxAt(miniGeo, row.now));
    assert.equal(err(r), row.code, `expected ${row.code} for ${JSON.stringify(row.action)}`);
    assert.deepEqual(s, snapshot, `state changed on ${row.code}`);
  }
});

test("err-03 applyAction never mutates a deep-frozen state", () => {
  let s: EmpireState = deepFreeze(buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 20 }, { id: "p2" }] }));
  s = deepFreeze(ok(applyAction(s, "p1", { type: "expand", code: "A2" }, c0())));
  s = deepFreeze(ok(applyAction(s, "p1", { type: "colonize", code: "B1" }, c0())));
  s = deepFreeze(ok(applyAction(s, "p1", { type: "endTurn" }, ctxAt(miniGeo, 1, mulberry32(3)))));
  assert.equal(s.turn?.playerId, "p2");
});

