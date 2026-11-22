import assert from "node:assert/strict";
import test from "node:test";
import { applyAction } from "@/lib/empire2/engine";
import { empire2Geo } from "@/lib/empire2/geo-adapter";
import { bountyFits, bountyLabel, drawBounties } from "@/lib/empire2/bounties";
import { resolveRules } from "@/lib/empire2/rules";
import { freeCountries } from "@/lib/empire2/state";
import { startRound, endTurn } from "@/lib/empire2/turns";
import { createGame } from "@/lib/empire2/setup";
import { buildPlayState, ctxAt, makeGeo, miniGeo, mulberry32, ok, scriptedRng } from "@/tests/empire2-support";
import type { BountyCard, EmpireState } from "@/lib/empire2/types";

const fakeGeo = makeGeo({
  continents: { Alpha: ["X1", "X2"], Beta: ["Y1"] },
  regions: { R1: ["X1", "X2"], R2: ["Y1"] },
  edges: [],
  traits: {
    X1: { initial: "B", letters: 4, landlocked: true },
    X2: { initial: "C", letters: 6, island: true },
    Y1: { initial: "B", letters: 10 },
  },
});

test("bounty-01 bountyFits for every kind", () => {
  const card = (kind: BountyCard["kind"], value: BountyCard["value"] = null): BountyCard => ({ id: "r1-0", kind, value });
  const table: [BountyCard, string, boolean][] = [
    [card("letter", "B"), "X1", true],
    [card("letter", "B"), "X2", false],
    [card("letter", "B"), "Y1", true],
    [card("landlocked"), "X1", true],
    [card("landlocked"), "X2", false],
    [card("island"), "X2", true],
    [card("island"), "X1", false],
    [card("short", 5), "X1", true],
    [card("short", 5), "X2", false],
    [card("long", 9), "Y1", true],
    [card("long", 9), "X2", false],
    [card("continent", "Alpha"), "X1", true],
    [card("continent", "Alpha"), "Y1", false],
    [card("region", "R2"), "Y1", true],
    [card("region", "R2"), "X1", false],
    [card("letter", "B"), "ZZ", false],
  ];
  for (const [c, code, expected] of table) {
    assert.equal(bountyFits(c, code, fakeGeo), expected, `${c.kind} ${c.value} ${code}`);
  }
});

test("bounty-02 two cards revealed each round with distinct kind/value, each fitting at least 3 free countries", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const s = startRound(
      buildPlayState({ geo: empire2Geo, players: [{ id: "p1", owned: ["FR"] }, { id: "p2", owned: ["JP"] }] }),
      2,
      ctxAt(empire2Geo, 0, mulberry32(seed)),
    );
    assert.equal(s.bounties.length, 2, `seed ${seed}`);
    const [a, b] = s.bounties;
    assert.ok(!(a.kind === b.kind && a.value === b.value), `seed ${seed}: duplicate card`);
    const free = freeCountries(s, empire2Geo);
    for (const c of s.bounties) {
      const fits = free.filter((code) => bountyFits(c, code, empire2Geo)).length;
      assert.ok(fits >= 3, `seed ${seed}: ${c.kind} fits ${fits}`);
    }
  }
});

test("bounty-03 draw order is kind then value and is deterministic", () => {
  const rules = resolveRules();
  const all = miniGeo.codes();
  const rng1 = scriptedRng([0, 0, 0, 0.4]);
  const cards1 = drawBounties(rng1, miniGeo, all, 1, rules);
  assert.deepEqual(cards1, [
    { id: "r1-0", kind: "letter", value: "A" },
    { id: "r1-1", kind: "letter", value: "B" },
  ]);
  assert.equal(rng1.consumed(), 4);
  const cards2 = drawBounties(scriptedRng([0, 0.9, 0.5, 0.0]), miniGeo, all, 1, rules);
  assert.deepEqual(cards2, [
    { id: "r1-0", kind: "letter", value: "G" },
    { id: "r1-1", kind: "short", value: 5 },
  ]);
});

test("bounty-04 a card that fits too few free countries is rejected and redrawn", () => {
  const rules = resolveRules();
  const free = ["A5", "A6", "B2", "B3", "B4"];
  // slot 0: kind 0 (letter), value 0 -> A (fits 2, rejected); kind 0.5 -> short (index 3), value 0 -> 5
  // slot 1: kind 0 (letter), value 0.4 -> B (fits 3)
  const rng = scriptedRng([0, 0, 0.5, 0, 0, 0.4]);
  const cards = drawBounties(rng, miniGeo, free, 1, rules);
  assert.deepEqual(cards, [
    { id: "r1-0", kind: "short", value: 5 },
    { id: "r1-1", kind: "letter", value: "B" },
  ]);
  assert.equal(rng.consumed(), 6);
});

test("bounty-05 fallback after 40 failed attempts uses no extra rng", () => {
  // Z is the last region and has one country, so every region attempt fails. 40 attempts x 2 draws per slot.
  const geo = makeGeo({
    continents: { C: ["X1", "X2", "X3", "X4", "X5"] },
    regions: { R1: ["X1", "X2", "X3", "X4"], Z: ["X5"] },
    edges: [],
    traits: {
      X1: { initial: "A" }, X2: { initial: "A" },
      X3: { initial: "B" }, X4: { initial: "B" }, X5: { initial: "B" },
    },
  });
  let draws = 0;
  const rng = () => {
    draws += 1;
    return 0.99;
  };
  const cards = drawBounties(rng, geo, geo.codes(), 1, resolveRules());
  assert.equal(draws, 2 * 40 * 2);
  assert.deepEqual(cards, [
    { id: "r1-0", kind: "letter", value: "B" },
    { id: "r1-1", kind: "short", value: 5 },
  ]);
});

test("bounty-06 first player to expand into a fitting country collects 2 and the card is gone", () => {
  const ctx = ctxAt(miniGeo, 0);
  let s: EmpireState = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["B1"], influence: 0 }, { id: "p2", owned: ["B6"], influence: 0 }],
    bounties: [{ id: "r1-0", kind: "letter", value: "B" }],
  });
  s = ok(applyAction(s, "p1", { type: "expand", code: "B2" }, ctx));
  assert.equal(s.players[0].influence, 2);
  assert.deepEqual(s.bounties, []);
  s = ok(applyAction(s, "p1", { type: "endTurn" }, ctx));
  s = ok(applyAction(s, "p2", { type: "expand", code: "B5" }, ctxAt(miniGeo, 1)));
  assert.equal(s.players[1].influence, 0);
  assert.equal(s.turn?.actions[0].bounty, 0);
});

test("bounty-07 colonizing a fitting country also claims a bounty", () => {
  const s = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["B1"], influence: 10 }, { id: "p2" }],
    bounties: [{ id: "r1-0", kind: "letter", value: "B" }],
  });
  const next = ok(applyAction(s, "p1", { type: "colonize", code: "B2" }, ctxAt(miniGeo, 0)));
  assert.equal(next.players[0].influence, 10 - 4 + 2);
  assert.deepEqual(next.bounties, []);
  assert.equal(next.turn?.actions[0].bounty, 2);
});

test("bounty-08 annex and setup picks never claim a bounty", () => {
  // annex
  const s = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1"], influence: 5 }, { id: "p2", owned: ["A2"] }],
    bounties: [{ id: "r1-0", kind: "letter", value: "A" }],
  });
  const annexed = ok(applyAction(s, "p1", { type: "annex", code: "A2", capital: "cap-a2" }, ctxAt(miniGeo, 0)));
  assert.equal(annexed.players[0].influence, 0);
  assert.equal(annexed.bounties.length, 1);
  // setup picks: no bounty cards exist yet and no income is paid
  const setup = ok(createGame({ playerIds: ["p1", "p2"] }, ctxAt(miniGeo, 0, scriptedRng([0.9, 0.9, 0, 0, 0, 0.9, 0.9, 0, 0, 0]))));
  assert.deepEqual(setup.bounties, []);
  const afterPick = ok(applyAction(setup, "p1", { type: "pickCapital", code: "A1" }, ctxAt(miniGeo, 0, scriptedRng([0.9, 0.9, 0, 0, 0]))));
  assert.equal(afterPick.players[0].influence, 3);
});

test("bounty-09 one claim collects at most one card", () => {
  const s = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["B1"], influence: 0 }, { id: "p2" }],
    bounties: [
      { id: "r1-0", kind: "letter", value: "B" },
      { id: "r1-1", kind: "short", value: 5 },
    ],
  });
  const next = ok(applyAction(s, "p1", { type: "expand", code: "B2" }, ctxAt(miniGeo, 0)));
  assert.equal(next.players[0].influence, 2);
  assert.deepEqual(next.bounties.map((c) => c.id), ["r1-1"]);
});

test("bounty-10 gold rush pays 4", () => {
  const s = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["B1"], influence: 0 }, { id: "p2" }],
    bounties: [{ id: "r1-0", kind: "letter", value: "B" }],
    event: "goldRush",
  });
  const next = ok(applyAction(s, "p1", { type: "expand", code: "B2" }, ctxAt(miniGeo, 0)));
  assert.equal(next.players[0].influence, 4);
  assert.equal(next.turn?.actions[0].bounty, 4);
});

test("bounty-11 unclaimed cards are replaced at the next round start", () => {
  const s = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1"] }, { id: "p2", owned: ["B1"] }],
    round: 1,
    bounties: [
      { id: "r1-0", kind: "letter", value: "A" },
      { id: "r1-1", kind: "letter", value: "B" },
    ],
  });
  const next = endTurn(endTurn(s, ctxAt(miniGeo, 0, mulberry32(12)), "endTurn", 0), ctxAt(miniGeo, 0, mulberry32(12)), "endTurn", 0);
  assert.equal(next.round, 2);
  assert.ok(next.bounties.length > 0);
  assert.ok(next.bounties.every((c) => c.id.startsWith("r2-")));
  assert.ok(!next.bounties.some((c) => c.id.startsWith("r1-")));
});

test("bounty-12 bountyLabel strings", () => {
  assert.equal(bountyLabel({ id: "x", kind: "letter", value: "B" }), "Starts with B");
  assert.equal(bountyLabel({ id: "x", kind: "landlocked", value: null }), "Landlocked");
  assert.equal(bountyLabel({ id: "x", kind: "island", value: null }), "Island nation");
  assert.equal(bountyLabel({ id: "x", kind: "short", value: 5 }), "5 letters or fewer");
  assert.equal(bountyLabel({ id: "x", kind: "long", value: 9 }), "9 letters or more");
  assert.equal(bountyLabel({ id: "x", kind: "continent", value: "Africa" }), "On the continent: Africa");
  assert.equal(bountyLabel({ id: "x", kind: "region", value: "Western Europe" }), "In region: Western Europe");
});

