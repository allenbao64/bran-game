import assert from "node:assert/strict";
import test from "node:test";
import { applyAction } from "@/lib/empire2/engine";
import { applyPlayAction } from "@/lib/empire2/actions";
import { empire2Geo } from "@/lib/empire2/geo-adapter";
import { autoSetupPick, createGame, legalFootholds } from "@/lib/empire2/setup";
import { setupOrder } from "@/lib/empire2/order";
import { currentPlayerId, ownedBy } from "@/lib/empire2/state";
import { buildPlayState, deepFreeze, err, miniGeo, mulberry32, ctxAt, ok, scriptedRng } from "@/tests/empire2-support";
import type { EmpireState, Rng } from "@/lib/empire2/types";

/** Returns the given values in order, then falls back to `rest`. */
function scriptThen(values: number[], rest: Rng): Rng {
  let i = 0;
  return () => (i < values.length ? values[i++] : rest());
}

const OFFERS2 = [0.9, 0.9, 0, 0, 0, 0.9, 0.9, 0, 0, 0];
const GOLDEN_S = [
  0.9, 0.9, 0, 0, 0, 0.9, 0.9, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0.4,
  0, 0, 0, 0, 0, 0, 0.9, 0.5, 0.0,
];

test("setup-01 createGame validates player count, duplicates and clock", () => {
  const ctx = ctxAt(miniGeo, 0, mulberry32(1));
  assert.equal(err(createGame({ playerIds: ["p1"] }, ctx)), "badPlayerCount");
  assert.equal(err(createGame({ playerIds: ["p1", "p2", "p3", "p4", "p5"] }, ctx)), "badPlayerCount");
  assert.equal(err(createGame({ playerIds: ["a", "a"] }, ctx)), "duplicatePlayer");
  assert.equal(err(createGame({ playerIds: ["p1", "p2"], turnMs: 25000 }, ctx)), "badTurnMs");
  for (const turnMs of [20000, 30000, 45000]) {
    const s = ok(createGame({ playerIds: ["p1", "p2"], turnMs }, ctx));
    assert.equal(s.turnMs, turnMs);
  }
});

test("setup-02 new game: setup phase, 3 influence each, first picker is seat 0", () => {
  const s = ok(createGame({ playerIds: ["p1", "p2", "p3"] }, ctxAt(empire2Geo, 0, mulberry32(3))));
  assert.equal(s.phase, "setup");
  assert.equal(s.round, 0);
  assert.deepEqual(s.players.map((p) => p.influence), [3, 3, 3]);
  assert.equal(s.setup?.step, "capital");
  assert.equal(s.setup?.cursor, 0);
  assert.equal(currentPlayerId(s), "p1");
  assert.equal(s.setup?.offers.length, 3);
});

test("setup-03 setupOrder snakes for 2, 3 and 4 players", () => {
  assert.deepEqual(setupOrder(2), { capital: [0, 1], foothold: [1, 0] });
  assert.deepEqual(setupOrder(3), { capital: [0, 1, 2], foothold: [2, 1, 0] });
  assert.deepEqual(setupOrder(4), { capital: [0, 1, 2, 3], foothold: [3, 2, 1, 0] });
});

test("setup-04 capital offers are 3 distinct continents, each country has >=3 neighbours (real map, 40 seeds)", () => {
  for (let seed = 1; seed <= 40; seed++) {
    for (const n of [2, 3, 4]) {
      const rng = mulberry32(seed);
      const ctx = ctxAt(empire2Geo, 0, rng);
      const ids = Array.from({ length: n }, (_, i) => `p${i + 1}`);
      let s = ok(createGame({ playerIds: ids }, ctx));
      const picked: string[] = [];
      while (s.phase === "setup" && s.setup?.step === "capital") {
        const offers = s.setup.offers;
        assert.equal(offers.length, 3, `seed ${seed} n ${n}`);
        assert.equal(new Set(offers.map((c) => empire2Geo.continentOf(c))).size, 3, `seed ${seed}: offers share a continent`);
        for (const c of offers) {
          assert.ok(empire2Geo.neighbours(c).length >= 3, `${c} has too few neighbours`);
          assert.equal(ownedBy(s, "x").length, 0);
          assert.ok(!picked.includes(c), `${c} already picked`);
          assert.ok(!Object.keys(s.owners).includes(c), `${c} is owned`);
        }
        const pick = offers[0];
        picked.push(pick);
        s = ok(applyAction(s, currentPlayerId(s) as string, { type: "pickCapital", code: pick }, ctx));
      }
      assert.equal(s.setup?.step, "foothold");
    }
  }
});

test("setup-05 offers are deterministic for a seed and use the specified draws", () => {
  const a = ok(createGame({ playerIds: ["p1", "p2"] }, ctxAt(empire2Geo, 0, mulberry32(42))));
  const b = ok(createGame({ playerIds: ["p1", "p2"] }, ctxAt(empire2Geo, 0, mulberry32(42))));
  assert.deepEqual(a.setup?.offers, b.setup?.offers);

  const rng1 = scriptedRng([0.9, 0.9, 0, 0, 0]);
  const s1 = ok(createGame({ playerIds: ["p1", "p2"] }, ctxAt(miniGeo, 0, rng1)));
  assert.deepEqual(s1.setup?.offers, ["A1", "B1", "G1"]);
  assert.equal(rng1.consumed(), 5);

  const rng2 = scriptedRng([0.0, 0.0, 0.4, 0.4, 0.9]);
  const s2 = ok(createGame({ playerIds: ["p1", "p2"] }, ctxAt(miniGeo, 0, rng2)));
  assert.deepEqual(s2.setup?.offers, ["B3", "G3", "A6"]);
});

test("setup-06 pickCapital must be one of the offers and by the right player", () => {
  const rng = scriptedRng(OFFERS2);
  const ctx = ctxAt(miniGeo, 0, rng);
  const s0 = deepFreeze(ok(createGame({ playerIds: ["p1", "p2"] }, ctx)));
  assert.equal(err(applyAction(s0, "p2", { type: "pickCapital", code: "A1" }, ctx)), "notYourTurn");
  assert.equal(err(applyAction(s0, "p1", { type: "pickCapital", code: "A2" }, ctx)), "notOffered");
  assert.equal(err(applyAction(s0, "p1", { type: "pickCapital", code: "ZZ" }, ctx)), "unknownCountry");
  const s1 = ok(applyAction(s0, "p1", { type: "pickCapital", code: "A1" }, ctx));
  assert.equal(s1.owners.A1, "p1");
  assert.equal(s1.players[0].capital, "A1");
});

test("setup-07 after the last capital pick the step becomes foothold in reverse order", () => {
  const rng = mulberry32(9);
  const ctx = ctxAt(miniGeo, 0, rng);
  let s: EmpireState = ok(createGame({ playerIds: ["p1", "p2", "p3"] }, ctx));
  for (let i = 0; i < 3; i++) {
    s = ok(applyAction(s, currentPlayerId(s) as string, { type: "pickCapital", code: s.setup?.offers[0] as string }, ctx));
  }
  assert.equal(s.setup?.step, "foothold");
  assert.deepEqual(s.setup?.order, [2, 1, 0]);
  assert.equal(s.setup?.cursor, 0);
  assert.deepEqual(s.setup?.offers, []);
  assert.equal(currentPlayerId(s), "p3");
});

test("setup-08 foothold must be free and not border a rival", () => {
  const ctx = ctxAt(miniGeo, 0, scriptedRng(OFFERS2));
  let s = ok(createGame({ playerIds: ["p1", "p2"] }, ctx));
  s = ok(applyAction(s, "p1", { type: "pickCapital", code: "A1" }, ctx));
  s = ok(applyAction(s, "p2", { type: "pickCapital", code: "B1" }, ctx));
  assert.equal(s.setup?.step, "foothold");
  s = deepFreeze(s);
  assert.equal(err(applyAction(s, "p2", { type: "pickFoothold", code: "A1" }, ctx)), "countryTaken");
  assert.equal(err(applyAction(s, "p2", { type: "pickFoothold", code: "A3" }, ctx)), "bordersRival");
  const own = ok(applyAction(s, "p2", { type: "pickFoothold", code: "B2" }, ctx));
  assert.equal(own.players[1].foothold, "B2");
});

test("setup-09 legalFootholds excludes owned and rival-bordering countries", () => {
  const ctx = ctxAt(miniGeo, 0, scriptedRng(OFFERS2));
  let s = ok(createGame({ playerIds: ["p1", "p2"] }, ctx));
  s = ok(applyAction(s, "p1", { type: "pickCapital", code: "A1" }, ctx));
  s = ok(applyAction(s, "p2", { type: "pickCapital", code: "B1" }, ctx));
  assert.deepEqual(legalFootholds(s, "p2", miniGeo), ["B2", "B3", "B4", "B5", "B6", "G1", "G2", "G3", "G4", "G5", "G6"]);
});

test("setup-10 setup completes into round 1 with turn for seat 0", () => {
  const rng = scriptedRng(GOLDEN_S);
  const at = (now: number) => ctxAt(miniGeo, now, rng);
  let s = ok(createGame({ playerIds: ["p1", "p2"], turnMs: 30000, rules: { winPoints: 5 } }, at(0)));
  s = ok(applyAction(s, "p1", { type: "pickCapital", code: "A1" }, at(1)));
  s = ok(applyAction(s, "p2", { type: "pickCapital", code: "B1" }, at(2)));
  s = ok(applyAction(s, "p2", { type: "pickFoothold", code: "G1" }, at(3)));
  s = ok(applyAction(s, "p1", { type: "pickFoothold", code: "A2" }, at(4)));
  assert.equal(s.phase, "play");
  assert.equal(s.round, 1);
  assert.equal(s.setup, null);
  assert.equal(s.turn?.playerId, "p1");
  assert.equal(s.turn?.seat, 0);
  assert.equal(s.turn?.isSecondOfTwo, false);
  assert.deepEqual(Object.keys(s.roundStartVp).sort(), ["p1", "p2"]);
});

test("setup-11 setup picks never claim bounties or pay income beyond round-1 income", () => {
  const rng = scriptedRng(GOLDEN_S);
  const at = (now: number) => ctxAt(miniGeo, now, rng);
  let s = ok(createGame({ playerIds: ["p1", "p2"], turnMs: 30000, rules: { winPoints: 5 } }, at(0)));
  assert.deepEqual(s.players.map((p) => p.influence), [3, 3]);
  s = ok(applyAction(s, "p1", { type: "pickCapital", code: "A1" }, at(1)));
  s = ok(applyAction(s, "p2", { type: "pickCapital", code: "B1" }, at(2)));
  assert.deepEqual(s.players.map((p) => p.influence), [3, 3]);
  s = ok(applyAction(s, "p2", { type: "pickFoothold", code: "G1" }, at(3)));
  s = ok(applyAction(s, "p1", { type: "pickFoothold", code: "A2" }, at(4)));
  assert.deepEqual(s.players.map((p) => p.influence), [6, 6]);
  assert.equal(s.bounties.length, 2);
});

test("setup-12 setup is untimed and rejects play actions", () => {
  const rng = scriptedRng(OFFERS2);
  let s = ok(createGame({ playerIds: ["p1", "p2"] }, ctxAt(miniGeo, 0, rng)));
  s = deepFreeze(s);
  assert.equal(err(applyAction(s, "p1", { type: "expand", code: "A3" }, ctxAt(miniGeo, 0, rng))), "unknownAction");
  const late = ok(applyAction(s, "p1", { type: "pickCapital", code: "A1" }, ctxAt(miniGeo, 1e12, rng)));
  assert.equal(late.players[0].capital, "A1");
  // play-phase handler called on a setup state
  assert.equal(err(applyPlayAction(s, "p1", { type: "endTurn" }, ctxAt(miniGeo, 0, rng))), "wrongPhase");
});

test("setup-13 autoSetupPick returns the first offer then the first legal foothold", () => {
  const ctx = ctxAt(miniGeo, 0, scriptedRng(OFFERS2));
  let s = ok(createGame({ playerIds: ["p1", "p2"] }, ctx));
  assert.deepEqual(autoSetupPick(s, ctx), { type: "pickCapital", code: "A1" });
  assert.deepEqual(autoSetupPick(s, ctx), { type: "pickCapital", code: "A1" });
  s = ok(applyAction(s, "p1", { type: "pickCapital", code: "A1" }, ctx));
  s = ok(applyAction(s, "p2", { type: "pickCapital", code: "B1" }, ctx));
  assert.deepEqual(autoSetupPick(s, ctx), { type: "pickFoothold", code: "B2" });
  const rng = scriptedRng(GOLDEN_S);
  const at = (now: number) => ctxAt(miniGeo, now, rng);
  let done = ok(createGame({ playerIds: ["p1", "p2"], rules: { winPoints: 5 } }, at(0)));
  done = ok(applyAction(done, "p1", { type: "pickCapital", code: "A1" }, at(1)));
  done = ok(applyAction(done, "p2", { type: "pickCapital", code: "B1" }, at(2)));
  done = ok(applyAction(done, "p2", { type: "pickFoothold", code: "G1" }, at(3)));
  done = ok(applyAction(done, "p1", { type: "pickFoothold", code: "A2" }, at(4)));
  assert.equal(autoSetupPick(done, at(5)), null);
});

test("setup-14 a picker with no legal foothold is granted one, so setup always completes", () => {
  // Owner decision (deadlock fallback): the engine never leaves a picker stuck with no legal foothold.
  // This runs a full 3-player game; every picker that reaches the front of the foothold order has a legal
  // foothold (or was granted one first), so the state advances to play with every player holding a foothold.
  const rng = mulberry32(11);
  const ctx = ctxAt(miniGeo, 0, rng);
  let s: EmpireState = ok(createGame({ playerIds: ["p1", "p2", "p3"] }, ctx));
  const capitalPickers: string[] = [];
  const footholdPickers: string[] = [];
  for (let i = 0; i < 3; i++) {
    const who = currentPlayerId(s) as string;
    capitalPickers.push(who);
    s = ok(applyAction(s, who, { type: "pickCapital", code: s.setup?.offers[0] as string }, ctx));
  }
  while (s.phase === "setup") {
    const who = currentPlayerId(s) as string;
    footholdPickers.push(who);
    const code = legalFootholds(s, who, miniGeo)[0];
    assert.notEqual(code, undefined, `${who} has no legal foothold: the engine should have granted one`);
    s = ok(applyAction(s, who, { type: "pickFoothold", code }, ctx));
  }
  assert.deepEqual(capitalPickers, ["p1", "p2", "p3"]);
  // p3 picks their capital (last of the capital order) and their foothold first (first of the foothold order)
  assert.deepEqual(footholdPickers.slice(0, 1), ["p3"]);
  assert.equal(s.phase, "play");
  assert.equal(s.round, 1);
  assert.ok(s.players.every((p) => p.foothold !== null), "every player holds a foothold");
});

test("setup-15 forced deadlock on miniGeo: the stuck picker is granted a random free country from the rng", () => {
  // p1 holds A1, p2 holds A2 and p3 holds B1 (all capitals). Foothold order is p3, p2, p1. p3 picks G1 (legal).
  //  - p2 is stuck: every free country borders a rival of p2 (A3..A6 border A1, B2..B6 border B1, G2..G6 border G1).
  //    The fallback draws from ALL 14 free countries, ascending: floor(0.5 * 14) = 7 gives B5.
  //  - p1 is then stuck too: A3..A6 border A2 (p2), B2..B4 and B6 border B1 (p3), G2..G6 border G1 (p3).
  //    The fallback draws from the 13 remaining free countries: floor(0 * 13) = 0 gives A3.
  //  Both fallback picks ignore the bordering rule (owner decision); setup then completes into round 1.
  const base = buildPlayState({
    geo: miniGeo,
    players: [
      { id: "p1", owned: ["A1"], capital: "A1" },
      { id: "p2", owned: ["A2"], capital: "A2" },
      { id: "p3", owned: ["B1"], capital: "B1" },
    ],
  });
  const s0: EmpireState = deepFreeze({
    ...base,
    phase: "setup",
    round: 0,
    turn: null,
    roundStartVp: {},
    setup: { step: "foothold", order: [2, 1, 0], cursor: 0, offers: [] },
  });
  const ctx = ctxAt(miniGeo, 0, scriptThen([0.5, 0], mulberry32(5)));
  const s1 = ok(applyAction(s0, "p3", { type: "pickFoothold", code: "G1" }, ctx));
  assert.equal(s1.players[2].foothold, "G1");
  assert.equal(s1.players[1].foothold, "B5");
  assert.equal(s1.players[0].foothold, "A3");
  assert.equal(s1.owners.B5, "p2");
  assert.equal(s1.phase, "play");
});

test("setup-16 deadlock with no free country left: the foothold is skipped and only the capital remains", () => {
  // Every country except B1 is owned. p2 picks B1 as its capital, which ends the capital step. The first foothold
  // picker has no legal foothold and no free country exists, so the foothold is skipped; the second is skipped too.
  const base = buildPlayState({
    geo: miniGeo,
    players: [
      { id: "p1", owned: ["A1", "A2", "A3", "A4", "A5", "A6"], capital: "A1" },
      { id: "p2", owned: ["B2", "B3", "B4", "B5", "B6", "G1", "G2", "G3", "G4", "G5", "G6"], capital: "G1" },
    ],
  });
  const s0: EmpireState = deepFreeze({
    ...base,
    phase: "setup",
    round: 0,
    turn: null,
    roundStartVp: {},
    setup: { step: "capital", order: [0, 1], cursor: 1, offers: ["B1"] },
  });
  const ctx = ctxAt(miniGeo, 0, mulberry32(9));
  const s1 = ok(applyAction(s0, "p2", { type: "pickCapital", code: "B1" }, ctx));
  assert.equal(s1.phase, "play");
  assert.equal(s1.round, 1);
  assert.equal(s1.players[0].foothold, null);
  assert.equal(s1.players[1].foothold, null);
  assert.equal(s1.players[1].capital, "B1");
  assert.equal(s1.owners.B1, "p2");
});
