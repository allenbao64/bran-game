import assert from "node:assert/strict";
import test from "node:test";
import { applyAction } from "@/lib/empire2/engine";
import { EVENT_KINDS, drawEvent, eventLabel } from "@/lib/empire2/events";
import { actionCosts, computeIncome } from "@/lib/empire2/economy";
import { scorePlayer } from "@/lib/empire2/victory";
import { startRound, endTurn } from "@/lib/empire2/turns";
import { buildPlayState, ctxAt, err, miniGeo, mulberry32, ok, scriptedRng } from "@/tests/empire2-support";
import type { EmpireState, EventKind } from "@/lib/empire2/types";

test("event-01 an event is drawn after rounds 4, 8, 12, 16 and applies to rounds 5, 9, 13, 17 only", () => {
  const base = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"] }, { id: "p2", owned: ["B1"] }] });
  for (let r = 2; r <= 20; r++) {
    const s = startRound(base, r, ctxAt(miniGeo, 0, mulberry32(r)));
    const expected = [5, 9, 13, 17].includes(r);
    assert.equal(s.event !== null, expected, `round ${r}`);
    if (expected) assert.ok(EVENT_KINDS.includes(s.event as EventKind));
  }
});

test("event-02 drawEvent uses one draw and the fixed list order", () => {
  const cases: [number, EventKind][] = [
    [0.0, "tradeWinds"],
    [0.2, "ceasefire"],
    [0.4, "goldenAge"],
    [0.6, "goldRush"],
    [0.8, "closedBorders"],
  ];
  for (const [v, kind] of cases) {
    const rng = scriptedRng([v]);
    assert.equal(drawEvent(rng), kind);
    assert.equal(rng.consumed(), 1);
  }
});

test("event-03 event draw happens before boom and bounty draws", () => {
  // first value 0.2 is the event draw (ceasefire); then 5 boom draws; then 4 bounty draws (golden round-1 values).
  const rng = scriptedRng([0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0.4]);
  const base = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"] }, { id: "p2", owned: ["B1"] }] });
  const s = startRound(base, 5, { geo: miniGeo, rng, now: 0 });
  assert.equal(s.event, "ceasefire");
  assert.deepEqual(s.booms, ["Alpha West", "Beta East", "Beta West"]);
  assert.equal(s.bounties.length, 2);
  assert.equal(rng.remaining(), 0);
});

test("event-04 the event is cleared when the next round starts", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"] }, { id: "p2", owned: ["B1"] }], round: 5, event: "goldRush", indexInRound: 1 });
  const next = endTurn(s, ctxAt(miniGeo, 0, mulberry32(9)), "endTurn", 0);
  assert.equal(next.round, 6);
  assert.equal(next.event, null);
});

test("event-05 trade winds", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 10 }, { id: "p2" }], event: "tradeWinds" });
  const once = ok(applyAction(s, "p1", { type: "colonize", code: "B1" }, ctxAt(miniGeo, 0)));
  assert.equal(once.players[0].influence, 8);
  const twice = ok(applyAction(once, "p1", { type: "colonize", code: "B2" }, ctxAt(miniGeo, 1)));
  assert.equal(twice.players[0].influence, 6);
  const relief = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1", "A2", "A3", "A4", "A5", "A6"], influence: 10 }, { id: "p2" }],
    event: "tradeWinds",
  });
  assert.equal(actionCosts(relief).colonize, 2);
});

test("event-06 ceasefire", () => {
  const s = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1"], influence: 10, capital: "A1" }, { id: "p2", owned: ["A2"] }],
    event: "ceasefire",
  });
  assert.equal(err(applyAction(s, "p1", { type: "annex", code: "A2", capital: "cap-a2" }, ctxAt(miniGeo, 0))), "ceasefire");
  assert.equal(ok(applyAction(s, "p1", { type: "expand", code: "A3" }, ctxAt(miniGeo, 0))).owners.A3, "p1");
  assert.equal(ok(applyAction(s, "p1", { type: "colonize", code: "B1" }, ctxAt(miniGeo, 0))).owners.B1, "p1");
  assert.deepEqual(ok(applyAction(s, "p1", { type: "city", code: "A1", capital: "cap-a1" }, ctxAt(miniGeo, 0))).cities, ["A1"]);
});

test("event-07 golden age", () => {
  const s = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1", "A2"], cities: ["A1", "A2"] }, { id: "p2" }],
    event: "goldenAge",
  });
  assert.equal(computeIncome(s, "p1", miniGeo).cities, 4);
  const plain = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1", "A2"], cities: ["A1", "A2"] }, { id: "p2" }],
  });
  assert.equal(scorePlayer(s, "p1", miniGeo).cities, 2);
  assert.equal(scorePlayer(plain, "p1", miniGeo).cities, 2);
  assert.equal(computeIncome(plain, "p1", miniGeo).cities, 2);
});

test("event-08 gold rush", () => {
  const s = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["B1"], influence: 0 }, { id: "p2" }],
    bounties: [{ id: "r1-0", kind: "letter", value: "B" }],
    event: "goldRush",
  });
  assert.equal(ok(applyAction(s, "p1", { type: "expand", code: "B2" }, ctxAt(miniGeo, 0))).players[0].influence, 4);
});

test("event-09 closed borders", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 1 }, { id: "p2" }], event: "closedBorders" });
  const first = ok(applyAction(s, "p1", { type: "expand", code: "A2" }, ctxAt(miniGeo, 0)));
  assert.equal(first.players[0].influence, 0);
  assert.equal(err(applyAction(first, "p1", { type: "expand", code: "A3" }, ctxAt(miniGeo, 0))), "notEnoughInfluence");
  const rich = buildPlayState({ geo: miniGeo, players: [{ id: "p1", owned: ["A1"], influence: 100 }, { id: "p2" }], event: "closedBorders" });
  let cur = ok(applyAction(rich, "p1", { type: "expand", code: "A2" }, ctxAt(miniGeo, 0)));
  cur = ok(applyAction(cur, "p1", { type: "expand", code: "A3" }, ctxAt(miniGeo, 0)));
  cur = ok(applyAction(cur, "p1", { type: "expand", code: "A4" }, ctxAt(miniGeo, 0)));
  assert.equal(err(applyAction(cur, "p1", { type: "expand", code: "A5" }, ctxAt(miniGeo, 0))), "expandCap");
  assert.equal(ok(applyAction(rich, "p1", { type: "colonize", code: "B1" }, ctxAt(miniGeo, 0))).players[0].influence, 96);
});

test("event-10 eventLabel strings", () => {
  assert.equal(eventLabel("tradeWinds"), "Trade winds: settling costs 2");
  assert.equal(eventLabel("ceasefire"), "Ceasefire: no take-overs");
  assert.equal(eventLabel("goldenAge"), "Golden age: strongholds pay 2");
  assert.equal(eventLabel("goldRush"), "Gold rush: bounties pay 4");
  assert.equal(eventLabel("closedBorders"), "Closed borders: expanding costs 1 more");
});

test("event-11 with default rules no event occurs in round 21", () => {
  const s: EmpireState = buildPlayState({
    geo: miniGeo,
    players: [{ id: "p1", owned: ["A1"] }, { id: "p2", owned: ["B1"] }],
    round: 20,
    indexInRound: 1,
  });
  const done = ok(applyAction(s, "p1", { type: "endTurn" }, ctxAt(miniGeo, 0)));
  assert.equal(done.phase, "finished");
  assert.equal(done.result?.reason, "cap");
  assert.equal(done.round, 20);
  assert.equal(done.event, null);
});

