import assert from "node:assert/strict";
import test from "node:test";
import { applyAction } from "@/lib/empire2/engine";
import { miniGeo, ctxAt, deepFreeze, err, ok, scriptedRng } from "@/tests/empire2-support";
import { createGame } from "@/lib/empire2/setup";
import { scoreAll, scorePlayer } from "@/lib/empire2/victory";
import type { EmpireState, Rng } from "@/lib/empire2/types";

// Hand-computed script (section 14.9). The expected values were computed by hand and are NOT edited to pass.
const S = [
  0.9, 0.9, 0, 0, 0,        // 5: offers for p1
  0.9, 0.9, 0, 0, 0,        // 5: offers for p2
  0, 0, 0, 0, 0,            // 5: round 1 booms
  0, 0, 0, 0.4,             // 4: round 1 bounties
  0, 0, 0, 0, 0,            // 5: round 2 booms
  0, 0.9, 0.5, 0.0,         // 4: round 2 bounties
];

const cfg = { playerIds: ["p1", "p2"], turnMs: 30000, rules: { winPoints: 5 } };

/** Runs the full script; returns the final state and the checkpoint trail. */
function runGolden(): { final: EmpireState; rng: Rng & { remaining(): number } } {
  const rng = scriptedRng(S);
  const at = (now: number) => ctxAt(miniGeo, now, rng);

  // 1. createGame at now 0
  let s: EmpireState = ok(createGame(cfg, at(0)));
  assert.equal(s.phase, "setup");
  assert.equal(s.setup?.step, "capital");
  assert.equal(s.setup?.cursor, 0);
  assert.deepEqual(s.setup?.offers, ["A1", "B1", "G1"]);
  assert.deepEqual(s.players.map((p) => p.influence), [3, 3]);
  assert.equal(rng.consumed?.() ?? 0, 5);

  // 2. p1 picks A1 at 1000
  s = deepFreeze(s);
  s = ok(applyAction(s, "p1", { type: "pickCapital", code: "A1" }, at(1000)));
  assert.equal(s.setup?.cursor, 1);
  assert.deepEqual(s.setup?.offers, ["A2", "B1", "G1"]);

  // 3. rejections leave state unchanged
  s = deepFreeze(s);
  assert.equal(err(applyAction(s, "p1", { type: "pickCapital", code: "B1" }, at(1100))), "notYourTurn");
  assert.equal(err(applyAction(s, "p2", { type: "pickCapital", code: "B2" }, at(1200))), "notOffered");

  // 4. p2 picks B1 at 2000
  s = ok(applyAction(s, "p2", { type: "pickCapital", code: "B1" }, at(2000)));
  assert.equal(s.setup?.step, "foothold");
  assert.deepEqual(s.setup?.order, [1, 0]);
  assert.equal(s.setup?.cursor, 0);
  assert.deepEqual(s.setup?.offers, []);

  // 5. foothold rejections
  s = deepFreeze(s);
  assert.equal(err(applyAction(s, "p1", { type: "pickFoothold", code: "A2" }, at(2100))), "notYourTurn");
  assert.equal(err(applyAction(s, "p2", { type: "pickFoothold", code: "A3" }, at(2200))), "bordersRival");
  assert.equal(err(applyAction(s, "p2", { type: "pickFoothold", code: "B1" }, at(2300))), "countryTaken");

  // 6. p2 picks foothold G1 at 3000
  s = ok(applyAction(s, "p2", { type: "pickFoothold", code: "G1" }, at(3000)));
  assert.equal(s.setup?.cursor, 1);

  // 7. p1 picks foothold A2 at 4000: round 1 starts
  s = deepFreeze(s);
  s = ok(applyAction(s, "p1", { type: "pickFoothold", code: "A2" }, at(4000)));
  assert.equal(s.phase, "play");
  assert.equal(s.round, 1);
  assert.deepEqual(s.turn && {
    playerId: s.turn.playerId, seat: s.turn.seat, indexInRound: s.turn.indexInRound,
    isSecondOfTwo: s.turn.isSecondOfTwo, startedAt: s.turn.startedAt,
    noFrontierAtStart: s.turn.noFrontierAtStart, expands: s.turn.expands,
    colonizes: s.turn.colonizes, annexed: s.turn.annexed,
  }, {
    playerId: "p1", seat: 0, indexInRound: 0, isSecondOfTwo: false, startedAt: 4000,
    noFrontierAtStart: false, expands: 0, colonizes: 0, annexed: false,
  });
  assert.deepEqual(s.roundStartVp, { p1: 0, p2: 0 });
  assert.deepEqual(s.booms, ["Alpha West", "Beta East", "Beta West"]);
  assert.deepEqual(s.bounties, [
    { id: "r1-0", kind: "letter", value: "A" },
    { id: "r1-1", kind: "letter", value: "B" },
  ]);
  assert.equal(s.event, null);
  assert.deepEqual(s.lastIncome?.p1, { base: 2, territory: 0, cities: 0, boom: 1, underdog: 0, total: 3 });
  assert.deepEqual(s.lastIncome?.p2, { base: 2, territory: 0, cities: 0, boom: 1, underdog: 0, total: 3 });
  assert.deepEqual(s.players.map((p) => p.influence), [6, 6]);
  assert.equal(rng.remaining(), 28 - 19);

  // 8. p1 expands A3 at 5000: free, pays bounty r1-0
  s = deepFreeze(s);
  s = ok(applyAction(s, "p1", { type: "expand", code: "A3" }, at(5000)));
  assert.equal(s.players[0].influence, 8);
  assert.deepEqual(s.bounties.map((b) => b.id), ["r1-1"]);
  assert.equal(s.turn?.expands, 1);

  // 9. p1 expands A4 at 6000: costs 1
  s = deepFreeze(s);
  s = ok(applyAction(s, "p1", { type: "expand", code: "A4" }, at(6000)));
  assert.equal(s.players[0].influence, 7);
  assert.equal(s.turn?.expands, 2);

  // 10. annex B1 at 6500 is not bordering
  s = deepFreeze(s);
  assert.equal(err(applyAction(s, "p1", { type: "annex", code: "B1", capital: "cap-b1" }, at(6500))), "notBordering");

  // 11. p1 ends turn at 7000
  s = deepFreeze(s);
  s = ok(applyAction(s, "p1", { type: "endTurn" }, at(7000)));
  const vp1 = scorePlayer(s, "p1", miniGeo);
  assert.equal(vp1.territory, 1);
  assert.equal(vp1.cities, 0);
  assert.deepEqual(vp1.regionSets, [{ region: "Alpha West", points: 2 }]);
  assert.equal(vp1.total, 3);
  assert.deepEqual(s.turn && { playerId: s.turn.playerId, seat: s.turn.seat, indexInRound: s.turn.indexInRound, isSecondOfTwo: s.turn.isSecondOfTwo, startedAt: s.turn.startedAt },
    { playerId: "p2", seat: 1, indexInRound: 1, isSecondOfTwo: false, startedAt: 7000 });
  assert.deepEqual(s.waitingWin, []);

  // 12. p2 expands B2 at 8000: free, pays bounty r1-1
  s = deepFreeze(s);
  s = ok(applyAction(s, "p2", { type: "expand", code: "B2" }, at(8000)));
  assert.equal(s.players[1].influence, 8);
  assert.deepEqual(s.bounties, []);

  // 13. p2 expands B3 at 9000 and B4 at 10000
  s = deepFreeze(s);
  s = ok(applyAction(s, "p2", { type: "expand", code: "B3" }, at(9000)));
  assert.equal(s.players[1].influence, 7);
  s = deepFreeze(s);
  s = ok(applyAction(s, "p2", { type: "expand", code: "B4" }, at(10000)));
  assert.equal(s.players[1].influence, 6);
  assert.equal(s.turn?.expands, 3);

  // 14. fourth expand at 10500 is capped
  s = deepFreeze(s);
  assert.equal(err(applyAction(s, "p2", { type: "expand", code: "B5" }, at(10500))), "expandCap");

  // 15. city: wrong capital first, then right one
  s = deepFreeze(s);
  assert.equal(err(applyAction(s, "p2", { type: "city", code: "B1", capital: "nope" }, at(11000))), "wrongCapital");
  assert.equal(s.players[1].influence, 6);
  assert.deepEqual(s.cities, []);
  s = deepFreeze(s);
  s = ok(applyAction(s, "p2", { type: "city", code: "B1", capital: "cap-b1" }, at(11500)));
  assert.equal(s.players[1].influence, 3);
  assert.deepEqual(s.cities, ["B1"]);

  // 16. p2 ends turn at 12000: round 2 starts
  s = deepFreeze(s);
  s = ok(applyAction(s, "p2", { type: "endTurn" }, at(12000)));
  const vp2 = scorePlayer(s, "p2", miniGeo);
  assert.equal(s.round, 2);
  assert.deepEqual(s.roundStartVp, { p1: 3, p2: 4 });
  assert.deepEqual(s.booms, ["Alpha West", "Beta East", "Beta West"]);
  assert.equal(s.event, null);
  assert.deepEqual(s.bounties, [
    { id: "r2-0", kind: "letter", value: "G" },
    { id: "r2-1", kind: "short", value: 5 },
  ]);
  assert.deepEqual(s.lastIncome?.p1, { base: 2, territory: 1, cities: 0, boom: 1, underdog: 0, total: 4 });
  assert.deepEqual(s.lastIncome?.p2, { base: 2, territory: 1, cities: 1, boom: 3, underdog: 0, total: 7 });
  assert.deepEqual(s.players.map((p) => p.influence), [11, 10]);
  assert.deepEqual(s.turn && { playerId: s.turn.playerId, seat: s.turn.seat, indexInRound: s.turn.indexInRound, isSecondOfTwo: s.turn.isSecondOfTwo, startedAt: s.turn.startedAt, noFrontierAtStart: s.turn.noFrontierAtStart },
    { playerId: "p2", seat: 1, indexInRound: 0, isSecondOfTwo: true, startedAt: 12000, noFrontierAtStart: false });
  assert.equal(rng.remaining(), 0);
  assert.equal(vp2.total, 4);

  // 17. annex on the second of two turns is refused
  s = deepFreeze(s);
  assert.equal(err(applyAction(s, "p2", { type: "annex", code: "A1", capital: "cap-a1" }, at(12500))), "secondTurnNoAnnex");

  // 18. p2 expands B5 (pays r2-1) and B6 (costs 1); titles change
  s = deepFreeze(s);
  s = ok(applyAction(s, "p2", { type: "expand", code: "B5" }, at(14000)));
  assert.equal(s.players[1].influence, 12);
  assert.deepEqual(s.bounties.map((b) => b.id), ["r2-0"]);
  s = deepFreeze(s);
  s = ok(applyAction(s, "p2", { type: "expand", code: "B6" }, at(15000)));
  assert.equal(s.players[1].influence, 11);
  assert.equal(s.titles.largestEmpire, "p2");
  assert.equal(s.titles.explorer, null);
  const titleEntries = s.log.filter((e) => e.type === "title");
  assert.equal(titleEntries.length, 1);
  assert.equal(titleEntries[0].note, "largestEmpire");

  // 19. p2 ends their second turn at 8 points: no win, waits
  s = deepFreeze(s);
  s = ok(applyAction(s, "p2", { type: "endTurn" }, at(16000)));
  assert.equal(s.phase, "play");
  assert.deepEqual(scorePlayer(s, "p2", miniGeo), {
    territory: 1,
    cities: 1,
    regionSets: [{ region: "Beta East", points: 2 }, { region: "Beta West", points: 2 }],
    largestEmpire: 2,
    explorer: 0,
    total: 8,
  });
  assert.deepEqual(s.waitingWin, ["p2"]);
  assert.deepEqual(s.turn && { playerId: s.turn.playerId, seat: s.turn.seat, indexInRound: s.turn.indexInRound, isSecondOfTwo: s.turn.isSecondOfTwo, startedAt: s.turn.startedAt },
    { playerId: "p1", seat: 0, indexInRound: 1, isSecondOfTwo: false, startedAt: 16000 });

  // 20. p1 expands A5 (free) and A6 (costs 1); holder keeps largest empire on the tie
  s = deepFreeze(s);
  s = ok(applyAction(s, "p1", { type: "expand", code: "A5" }, at(17000)));
  assert.equal(s.players[0].influence, 11);
  s = deepFreeze(s);
  s = ok(applyAction(s, "p1", { type: "expand", code: "A6" }, at(18000)));
  assert.equal(s.players[0].influence, 10);
  assert.equal(s.titles.largestEmpire, "p2");

  // 21. p1 ends a normal turn with 5 points: wins
  s = deepFreeze(s);
  s = ok(applyAction(s, "p1", { type: "endTurn" }, at(19000)));
  assert.equal(s.phase, "finished");
  assert.equal(s.turn, null);
  assert.deepEqual(s.result, {
    winners: ["p1"],
    reason: "points",
    round: 2,
    vp: { p1: 5, p2: 8 },
    influence: { p1: 10, p2: 11 },
  });
  assert.deepEqual(s.waitingWin, ["p2"]);

  // 22. final state and game over
  assert.deepEqual(
    Object.fromEntries(Object.entries(s.owners).filter(([, v]) => v === "p1").map(([k]) => [k, "p1"])),
    { A1: "p1", A2: "p1", A3: "p1", A4: "p1", A5: "p1", A6: "p1" },
  );
  assert.deepEqual(
    Object.keys(s.owners).filter((k) => s.owners[k] === "p2").sort(),
    ["B1", "B2", "B3", "B4", "B5", "B6", "G1"],
  );
  assert.deepEqual(s.cities, ["B1"]);
  assert.deepEqual(s.titles, { largestEmpire: "p2", explorer: null });
  assert.deepEqual(s.bounties, [{ id: "r2-0", kind: "letter", value: "G" }]);
  assert.equal(err(applyAction(deepFreeze(s), "p1", { type: "endTurn" }, at(20000))), "gameOver");
  assert.deepEqual(scoreAll(s, miniGeo).p2.total, 8);

  return { final: s, rng };
}

test("golden-01 two-player scripted game ends in round 2 with the first player winning while the second waits at 8 points", () => {
  runGolden();
});

test("golden-02 the same script run twice gives deep-equal final states", () => {
  const a = runGolden().final;
  const b = runGolden().final;
  assert.deepEqual(a, b);
});
