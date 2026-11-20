import assert from "node:assert/strict";
import test from "node:test";
import { applyAction } from "@/lib/empire2/engine";
import { legalMoves } from "@/lib/empire2/actions";
import { bestBoomPick, boomPickerId } from "@/lib/empire2/boom-pick";
import { EMPIRE2_PLAY_RULES, EMPIRE2_RULES } from "@/lib/empire2/rules";
import { drawBooms } from "@/lib/empire2/economy";
import { empire2Geo, type Empire2Geo } from "@/lib/empire2/geo-adapter";
import { autoSetupPick, createGame, legalFootholds } from "@/lib/empire2/setup";
import { startRound, advanceTimeouts } from "@/lib/empire2/turns";
import { currentPlayerId, isBoomPickPending, ownedBy } from "@/lib/empire2/state";
import type { EmpireState, Rules } from "@/lib/empire2/types";
import {
  assertInvariants, buildPlayState, ctxAt, deepFreeze, err, miniGeo, mulberry32, newTrackers, ok, type PlaySpec,
} from "@/tests/empire2-support";

const ON: Partial<Rules> = { underdogBoomPick: true };

/** Plays a fresh game through setup with the engine's own deterministic setup picks. Ends in round 1's start. */
function startGame(rules: Partial<Rules>, ids: string[], seed: number, geo: Empire2Geo = miniGeo): EmpireState {
  const ctx = ctxAt(geo, 0, mulberry32(seed));
  let s = ok(createGame({ playerIds: ids, rules }, ctx));
  for (let guard = 0; s.phase === "setup"; guard++) {
    assert.ok(guard < 100, "setup did not finish");
    const pid = currentPlayerId(s);
    assert.ok(pid !== null, "setup has no picker");
    const action = autoSetupPick(s, ctx);
    assert.ok(action !== null, "no setup pick");
    s = ok(applyAction(s, pid, action, ctx));
  }
  return s;
}

/** Two players, round 1, p0 to act: p0 owns 8 countries (2 VP), p1 owns 2 (0 VP). */
function twoPlayerRound1(extra: Partial<PlaySpec> = {}): EmpireState {
  return buildPlayState({
    geo: miniGeo,
    rules: ON,
    round: 1,
    players: [
      { id: "p0", owned: ["A1", "A2", "A3", "A4", "A5", "A6", "B1", "B2"], influence: 9 },
      { id: "p1", owned: ["G1", "G2"], influence: 9 },
    ],
    ...extra,
  });
}

/** Ends the turns of round 1 in order, so round 2 starts with the boom pick open (p1 is the picker). */
function pendingRound2(seed: number, now = 1000): EmpireState {
  let s = twoPlayerRound1();
  const ctx = () => ctxAt(miniGeo, now, mulberry32(seed));
  s = ok(applyAction(s, "p0", { type: "endTurn" }, ctx()));
  s = ok(applyAction(s, "p1", { type: "endTurn" }, ctx()));
  return s;
}

test("boom pick off: no pick phase, booms drawn as before, the first player acts at once", () => {
  const s = startGame({}, ["p0", "p1"], 11);
  assert.equal(s.phase, "play");
  assert.equal("boomPick" in s, false, "no boomPick field with the rule off");
  assert.ok(s.turn !== null, "the first turn starts immediately");
  assert.equal(isBoomPickPending(s), false);
  assert.equal(s.booms.length, EMPIRE2_RULES.boomRegionCount);
  assert.deepEqual(s.booms, [...s.booms].sort());
  assert.equal(s.log.some((e) => e.type === "boomPick"), false, "no boomPick log entries");

  // Booms are the same draw as today: startRound with a known rng gives drawBooms over the same stream.
  const seeded = buildPlayState({ geo: miniGeo, round: 1, players: [{ id: "p0" }, { id: "p1" }] });
  const next = startRound(seeded, 2, ctxAt(miniGeo, 0, mulberry32(5)));
  assert.deepEqual(next.booms, drawBooms(mulberry32(5), miniGeo, EMPIRE2_RULES.boomRegionCount));
  assert.equal(next.turn !== null, true);
  const first = s.turn;
  assert.ok(first);
  assert.equal(ok(applyAction(s, first.playerId, { type: "endTurn" }, ctxAt(miniGeo, 0))).phase, "play");
});

test("boom pick on: the lowest-VP player picks one boom region and only they may act", () => {
  const s = pendingRound2(7);
  assert.equal(s.round, 2);
  assert.equal(s.turn, null, "no turn while the pick is open");
  assert.ok(s.boomPick);
  assert.equal(s.boomPick.region, null);
  assert.equal(s.boomPick.playerId, "p1", "p1 has 0 VP at the round-2 snapshot, p0 has 2");
  assert.equal(currentPlayerId(s), "p1", "the picker is the current player");
  assert.deepEqual(s.booms, [], "no booms before the pick");

  const picked = ok(applyAction(s, "p1", { type: "pickBoom", region: "Gamma East" }, ctxAt(miniGeo, 1000, mulberry32(7))));
  assert.equal(picked.turn?.playerId, "p1", "round 2 starts with the snake's first seat (p1)");
  assert.ok(picked.booms.includes("Gamma East"), "the picked region is one of the booms");
  assert.equal(picked.booms.length, 3, "the total number of booms is boomRegionCount");
  assert.deepEqual(picked.booms, [...picked.booms].sort());
  assert.equal(new Set(picked.booms).size, 3);
  assert.equal(isBoomPickPending(picked), false);
});

test("boom pick on: round 1 waits for the pick right after setup, the tied first player picks", () => {
  const s = startGame(ON, ["p0", "p1"], 3);
  assert.equal(s.phase, "play");
  assert.equal(s.turn, null, "round 1 has no turn until the pick is made");
  assert.ok(s.boomPick);
  assert.equal(s.boomPick.round, 1);
  assert.equal(boomPickerId(s), "p0", "both players are at 0 VP: the first in round 1's order picks");
  assert.equal(s.boomPick.playerId, "p0");
  const after = ok(applyAction(s, "p0", { type: "pickBoom", region: "Beta West" }, ctxAt(miniGeo, 0, mulberry32(4))));
  assert.equal(after.turn?.playerId, "p0");
  assert.equal(after.booms.length, 3);
  assert.ok(after.booms.includes("Beta West"));
});

test("tie for lowest: the tied player first in this round's turn order picks", () => {
  // p0 and p1 are at 0 VP; p2 owns eight countries and an 8-country group, so it is far ahead.
  let s = buildPlayState({
    geo: miniGeo,
    rules: ON,
    round: 1,
    players: [
      { id: "p0", influence: 5 },
      { id: "p1", influence: 5 },
      { id: "p2", owned: ["A1", "A2", "A3", "A4", "A5", "A6", "B1", "B2"], influence: 5 },
    ],
  });
  const ctx = (now: number) => ctxAt(miniGeo, now, mulberry32(21));
  s = ok(applyAction(s, "p0", { type: "endTurn" }, ctx(500)));
  s = ok(applyAction(s, "p1", { type: "endTurn" }, ctx(600)));
  s = ok(applyAction(s, "p2", { type: "endTurn" }, ctx(700)));
  // Round 2 snakes descending: order is p2, p1, p0. Among the tied p0 and p1, p1 comes first.
  assert.equal(s.round, 2);
  assert.equal(s.roundStartVp.p0, s.roundStartVp.p1, "p0 and p1 tie");
  assert.ok((s.roundStartVp.p0 ?? 0) < (s.roundStartVp.p2 ?? 0), "both are below p2");
  assert.equal(boomPickerId(s), "p1");
  assert.equal(s.boomPick?.playerId, "p1");
  assert.equal(err(applyAction(s, "p0", { type: "pickBoom", region: "Gamma East" }, ctx(800))), "notYourPick");
  ok(applyAction(s, "p1", { type: "pickBoom", region: "Gamma East" }, ctx(800)));
});

test("pickBoom rejects an unknown region, a wrong player and a non-pick action, without changing state", () => {
  const s = pendingRound2(9);
  const before = JSON.stringify(s);
  const c = ctxAt(miniGeo, 1000, mulberry32(9));
  assert.equal(err(applyAction(s, "p1", { type: "pickBoom", region: "Atlantis" }, c)), "unknownRegion");
  assert.equal(err(applyAction(s, "p1", { type: "pickBoom", region: 3 as unknown as string }, c)), "unknownRegion");
  assert.equal(err(applyAction(s, "p0", { type: "pickBoom", region: "Gamma East" }, c)), "notYourPick");
  assert.equal(err(applyAction(s, "p0", { type: "endTurn" }, c)), "notYourPick");
  assert.equal(err(applyAction(s, "p1", { type: "endTurn" }, c)), "boomPickFirst");
  assert.equal(err(applyAction(s, "p1", { type: "expand", code: "G3" }, c)), "boomPickFirst");
  assert.equal(JSON.stringify(s), before, "rejections change nothing");
});

test("pickBoom is refused outside a pick (rule off, or during a normal turn)", () => {
  const off = startGame({}, ["p0", "p1"], 12);
  const turnOwner = off.turn?.playerId ?? "p0";
  assert.equal(err(applyAction(off, turnOwner, { type: "pickBoom", region: "Gamma East" }, ctxAt(miniGeo, 0))), "wrongPhase");
  const on = startGame(ON, ["p0", "p1"], 13);
  const picked = ok(applyAction(on, "p0", { type: "pickBoom", region: "Gamma East" }, ctxAt(miniGeo, 0, mulberry32(1))));
  assert.equal(err(applyAction(picked, picked.turn?.playerId ?? "p0", { type: "pickBoom", region: "Gamma East" }, ctxAt(miniGeo, 0))), "wrongPhase");
});

test("a timed-out pick uses bestBoomPick, and the round goes on", () => {
  const s = pendingRound2(15, 1000);
  assert.equal(s.boomPick?.startedAt, 1000);
  assert.equal(advanceTimeouts(s, ctxAt(miniGeo, 1000 + s.turnMs - 1)), s, "not expired yet");
  const at = 1000 + s.turnMs;
  const timed = advanceTimeouts(s, ctxAt(miniGeo, at, mulberry32(16)));
  assert.equal(timed.boomPick?.by, "timeout");
  assert.equal(timed.boomPick?.region, "Gamma West", "p1 owns G1 and G2 in Gamma West: the best payout");
  assert.equal(timed.boomPick?.region, bestBoomPick(s, "p1", miniGeo));
  assert.equal(timed.booms.length, 3);
  assert.ok(timed.booms.includes("Gamma West"));
  assert.equal(timed.turn?.playerId, "p1");
  assert.equal(timed.turn?.startedAt, at, "the first turn starts at the pick's deadline");
  const logged = timed.log.find((e) => e.type === "boomPick");
  assert.equal(logged?.auto, true);
  // The round continues: the first turn times out in turn and the second player takes over.
  const next = advanceTimeouts(timed, ctxAt(miniGeo, at + timed.turnMs, mulberry32(17)));
  assert.equal(next.turn?.playerId, "p0");
  assert.equal(next.phase, "play");
});

test("boom region count 0: the pick is recorded and no region booms", () => {
  // createGame rejects boomRegionCount 0, so the state is built directly; the round-2 pick opens at the round end.
  let s = buildPlayState({
    geo: miniGeo,
    rules: { underdogBoomPick: true, boomRegionCount: 0 },
    round: 1,
    players: [
      { id: "p0", owned: ["A1", "A2", "A3", "A4", "A5", "A6", "B1", "B2"], influence: 9 },
      { id: "p1", owned: ["G1", "G2"], influence: 9 },
    ],
  });
  const ctx = (now: number) => ctxAt(miniGeo, now, mulberry32(23));
  s = ok(applyAction(s, "p0", { type: "endTurn" }, ctx(500)));
  s = ok(applyAction(s, "p1", { type: "endTurn" }, ctx(600)));
  assert.equal(s.round, 2);
  assert.equal(s.turn, null, "the pick is open");
  assert.equal(s.boomPick?.playerId, "p1");
  const picked = ok(applyAction(s, "p1", { type: "pickBoom", region: "Gamma East" }, ctx(800)));
  assert.equal(picked.boomPick?.region, "Gamma East", "the pick is recorded");
  assert.equal(picked.boomPick?.by, "player");
  assert.deepEqual(picked.booms, [], "no region booms with boomRegionCount 0");
  assert.equal(picked.log.filter((e) => e.type === "boomPick" && e.note === "Gamma East").length, 1, "the pick is logged");
  assert.equal(picked.turn?.playerId, "p1", "the round's first turn starts");
  assertInvariants(s, picked, miniGeo, newTrackers());
});

test("bestBoomPick prefers the picker's city, then the most countries, then the alphabetical region", () => {
  const withCity = buildPlayState({
    geo: miniGeo,
    round: 2,
    players: [{ id: "p0", owned: ["A1", "A2", "A3", "B4"], cities: ["B4"] }, { id: "p1", owned: ["G1"] }],
  });
  assert.equal(bestBoomPick(withCity, "p0", miniGeo), "Beta East", "a city (2) beats three countries in one region (1)");

  const most = buildPlayState({
    geo: miniGeo,
    round: 2,
    players: [{ id: "p0", owned: ["A1", "A4", "A5"] }, { id: "p1" }],
  });
  assert.equal(bestBoomPick(most, "p0", miniGeo), "Alpha East", "equal payout: two countries beat one");

  const alpha = buildPlayState({
    geo: miniGeo,
    round: 2,
    players: [{ id: "p0", owned: ["A1", "B4"] }, { id: "p1" }],
  });
  assert.equal(bestBoomPick(alpha, "p0", miniGeo), "Alpha West", "equal payout and count: alphabetical");

  const zero = buildPlayState({
    geo: miniGeo,
    round: 2,
    rules: { boomIncome: 0, boomCityIncome: 0 },
    players: [{ id: "p0", owned: ["B4"] }, { id: "p1" }],
  });
  assert.equal(bestBoomPick(zero, "p0", miniGeo), "Beta East", "first region that borders the picker's empire (B4 is in Beta East, next to B5)");

  const none = buildPlayState({ geo: miniGeo, round: 2, rules: { boomIncome: 0, boomCityIncome: 0 }, players: [{ id: "p0" }, { id: "p1" }] });
  assert.equal(bestBoomPick(none, "p0", miniGeo), "Alpha East", "no borders at all: the alphabetically first region");
});

test("the pick is recorded in the state and in the log", () => {
  const s = pendingRound2(19, 1000);
  const picked = ok(applyAction(s, "p1", { type: "pickBoom", region: "Gamma East" }, ctxAt(miniGeo, 1200, mulberry32(19))));
  assert.deepEqual(picked.boomPick, {
    round: 2,
    playerId: "p1",
    region: "Gamma East",
    by: "player",
    startedAt: 1000,
    secondOfTwo: true,
  });
  const boomEntries = picked.log.filter((e) => e.type === "boomPick");
  assert.deepEqual(boomEntries, [{ type: "boomPick", round: 2, playerId: "p1", note: "Gamma East", auto: false }]);
  const roundStarts = picked.log.filter((e) => e.type === "roundStart");
  assert.equal(roundStarts[roundStarts.length - 1]?.round, 2);
});

test("createGame rejects a non-boolean underdogBoomPick and accepts booleans", () => {
  const ctx = ctxAt(miniGeo, 0, mulberry32(1));
  for (const value of ["yes", 1, null, "true", undefined]) {
    const r = createGame({ playerIds: ["p0", "p1"], rules: { underdogBoomPick: value } as unknown as Partial<Rules> }, ctx);
    assert.equal(r.ok, false, `underdogBoomPick = ${String(value)} is not a boolean`);
    if (!r.ok) {
      assert.equal(r.error.code, "badRules");
      assert.ok(r.error.message.includes("underdogBoomPick"), "the message names the key");
    }
  }
  assert.equal(createGame({ playerIds: ["p0", "p1"], rules: { underdogBoomPick: true } }, ctx).ok, true);
  assert.equal(createGame({ playerIds: ["p0", "p1"], rules: { underdogBoomPick: false } }, ctx).ok, true);
  assert.equal(EMPIRE2_PLAY_RULES.underdogBoomPick, false);
  assert.equal(EMPIRE2_RULES.underdogBoomPick, false);
});

// ---------- Property: whole games with the rule on, every invariant checked after every step ----------

function playPickGame(geo: Empire2Geo, rules: Partial<Rules>, seed: number, playerCount: number, maxActions: number) {
  const engineRng = mulberry32(seed);
  const botRng = mulberry32(seed * 7919 + 17);
  const pick = (n: number) => Math.floor(botRng() * n);
  const ids = Array.from({ length: playerCount }, (_, i) => `p${i}`);
  let now = 0;
  const ctx = () => ctxAt(geo, now, engineRng);
  let s: EmpireState = ok(createGame({ playerIds: ids, rules }, ctx()));
  const trackers = newTrackers();
  assertInvariants(s, s, geo, trackers);
  let picks = 0;
  let timeoutPicks = 0;
  let refused = 0;

  for (let n = 0; s.phase !== "finished" && n < maxActions; n++) {
    now += 1000 * (1 + pick(25));
    deepFreeze(s);
    const prev = s;

    const caught = advanceTimeouts(s, ctx());
    if (caught !== s) {
      assertInvariants(prev, caught, geo, trackers);
      timeoutPicks += caught.log.slice(prev.log.length).filter((e) => e.type === "boomPick" && e.auto === true).length;
      s = caught;
      continue;
    }

    const who = currentPlayerId(s);
    assert.ok(who !== null, "no current player");

    if (s.phase === "setup" && s.setup !== null) {
      const legal = s.setup.step === "capital" ? s.setup.offers : legalFootholds(s, who, geo);
      assert.ok(legal.length > 0, "setup stalls");
      const action = s.setup.step === "capital"
        ? { type: "pickCapital" as const, code: legal[pick(legal.length)] }
        : { type: "pickFoothold" as const, code: legal[pick(legal.length)] };
      const r = applyAction(s, who, action, ctx());
      assert.equal(r.ok, true, `setup pick failed: ${r.ok ? "" : r.error.code}`);
      if (!r.ok) throw new Error("unreachable");
      assertInvariants(prev, r.state, geo, trackers);
      s = r.state;
      continue;
    }

    if (isBoomPickPending(s) && s.boomPick !== undefined) {
      const picker = s.boomPick.playerId;
      assert.equal(who, picker, "the picker is the current player");
      if (botRng() < 0.2) {
        // Wrong player, and a non-pick action from the picker: both refused, nothing changes.
        const other = ids.find((id) => id !== picker) ?? picker;
        const wrongPlayer = applyAction(s, other, { type: "pickBoom", region: geo.regionNames()[0] }, ctx());
        const wrongAction = applyAction(s, picker, { type: "endTurn" }, ctx());
        assert.equal(wrongPlayer.ok, false);
        assert.equal(wrongAction.ok, false);
        refused += 2;
      }
      const regions = geo.regionNames();
      const region = botRng() < 0.5 ? bestBoomPick(s, picker, geo) : regions[pick(regions.length)];
      const r = applyAction(s, picker, { type: "pickBoom", region }, ctx());
      assert.equal(r.ok, true, `pickBoom ${region} failed: ${r.ok ? "" : r.error.code}`);
      if (!r.ok) throw new Error("unreachable");
      assertInvariants(prev, r.state, geo, trackers);
      s = r.state;
      picks += 1;
      continue;
    }

    const turn = s.turn;
    assert.ok(turn !== null, "play without a turn or a pick");
    if (botRng() < 0.15) {
      // A pick outside the pick phase is refused, and the other player's turn action is refused.
      const other = ids.find((id) => id !== turn.playerId) ?? turn.playerId;
      const r1 = applyAction(s, turn.playerId, { type: "pickBoom", region: geo.regionNames()[0] }, ctx());
      const r2 = applyAction(s, other, { type: "endTurn" }, ctx());
      assert.equal(r1.ok, false);
      assert.equal(r2.ok, false);
      refused += 2;
    }
    const moves = legalMoves(s, geo);
    const options: Array<{ type: "expand" | "colonize" | "city" | "annex"; code: string }> = [
      ...moves.expand.map((code) => ({ type: "expand" as const, code })),
      ...moves.colonize.map((code) => ({ type: "colonize" as const, code })),
      ...moves.city.map((code) => ({ type: "city" as const, code })),
      ...moves.annex.map((code) => ({ type: "annex" as const, code })),
    ];
    let action: Parameters<typeof applyAction>[2];
    if (options.length === 0 || botRng() < 0.3) {
      action = { type: "endTurn" };
    } else {
      const choice = options[pick(options.length)];
      const capital = geo.capitalsOf(choice.code)[0];
      action = choice.type === "expand" || choice.type === "colonize"
        ? { type: choice.type, code: choice.code }
        : { type: choice.type, code: choice.code, capital: capital ?? "" };
    }
    const r = applyAction(s, turn.playerId, action, ctx());
    if (!r.ok) {
      // A bot action the engine refuses must still change nothing; a refused end turn is a bug.
      assert.notEqual(action.type, "endTurn", `endTurn refused: ${err(r)}`);
      continue;
    }
    assertInvariants(prev, r.state, geo, trackers);
    s = r.state;
  }
  return { state: s, picks, timeoutPicks, refused };
}

test("property: whole games with underdogBoomPick on (mini and real maps) keep every invariant", () => {
  const runs = [
    { geo: miniGeo, rules: { ...EMPIRE2_RULES, underdogBoomPick: true }, seed: 101, n: 2, max: 3000 },
    { geo: miniGeo, rules: { ...EMPIRE2_RULES, underdogBoomPick: true }, seed: 102, n: 3, max: 3000 },
    { geo: miniGeo, rules: { ...EMPIRE2_PLAY_RULES, underdogBoomPick: true }, seed: 103, n: 4, max: 3000 },
    { geo: empire2Geo, rules: { ...EMPIRE2_PLAY_RULES, underdogBoomPick: true }, seed: 104, n: 3, max: 1500 },
  ];
  for (const run of runs) {
    const out = playPickGame(run.geo, run.rules, run.seed, run.n, run.max);
    const resolved = out.picks + out.timeoutPicks;
    // Every round that started has had its pick resolved, except possibly the one still open.
    assert.ok(resolved >= out.state.round - 1, `seed ${run.seed}: ${resolved} picks for ${out.state.round} rounds`);
    assert.ok(out.state.round >= 2, `seed ${run.seed}: game too short to test picks`);
    assert.ok(out.refused > 0, `seed ${run.seed}: refusals were not exercised`);
  }
});
