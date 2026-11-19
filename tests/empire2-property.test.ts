import assert from "node:assert/strict";
import test from "node:test";
import { applyAction } from "@/lib/empire2/engine";
import { legalMoves } from "@/lib/empire2/actions";
import { empire2Geo } from "@/lib/empire2/geo-adapter";
import { createGame, legalFootholds } from "@/lib/empire2/setup";
import { advanceTimeouts } from "@/lib/empire2/turns";
import { currentPlayerId, ownedBy } from "@/lib/empire2/state";
import { assertInvariants, ctxAt, deepFreeze, err, mulberry32, newTrackers } from "@/tests/empire2-support";
import type { Action, EmpireState } from "@/lib/empire2/types";

type Result = { state: EmpireState; log: EmpireState["log"]; invalidTries: number; wrongCapitals: number };

/** Plays one whole game with a seeded bot on the real map, checking every invariant after every step. */
function playGame(seed: number, playerCount: number): Result {
  const geo = empire2Geo;
  const engineRng = mulberry32(seed);
  const botRng = mulberry32(seed * 7919 + 13);
  const pick = (n: number) => Math.floor(botRng() * n);
  const ids = Array.from({ length: playerCount }, (_, i) => `p${i + 1}`);
  let now = 0;
  const ctx = () => ctxAt(geo, now, engineRng);

  const created = createGame({ playerIds: ids }, ctx());
  assert.equal(created.ok, true, "createGame failed");
  if (!created.ok) throw new Error("unreachable");
  let state: EmpireState = created.state;
  const trackers = newTrackers();
  assertInvariants(state, state, geo, trackers);
  let invalidTries = 0;
  let wrongCapitals = 0;
  let actions = 0;

  while (state.phase !== "finished" && actions < 20000) {
    actions += 1;
    now += 1000 * (1 + pick(25));
    deepFreeze(state);
    const prev = state;

    // Lazy clock catch-up, as the server does before any action. Every 12th action jumps past the deadline.
    if (actions % 12 === 0 && state.phase === "play" && state.turn !== null) {
      now = Math.max(now, state.turn.startedAt + state.turnMs);
    }
    const caught = advanceTimeouts(state, ctx());
    if (caught !== state) {
      assertInvariants(prev, caught, geo, trackers);
      state = caught;
      continue;
    }

    const who = currentPlayerId(state);
    assert.ok(who !== null, "no current player");

    if (state.phase === "setup" && state.setup !== null) {
      if (state.setup.step === "capital") {
        const offers = state.setup.offers;
        assert.ok(offers.length > 0, "no capital offers");
        const code = offers[pick(offers.length)];
        const r = applyAction(state, who, { type: "pickCapital", code }, ctx());
        assert.equal(r.ok, true, `setup capital pick failed: ${r.ok ? "" : r.error.code}`);
        if (!r.ok) throw new Error("unreachable");
        assertInvariants(prev, r.state, geo, trackers);
        state = r.state;
      } else {
        const legal = legalFootholds(state, who, geo);
        assert.ok(legal.length > 0, "setup stalls: no legal foothold");
        const code = legal[pick(legal.length)];
        const r = applyAction(state, who, { type: "pickFoothold", code }, ctx());
        assert.equal(r.ok, true, `setup foothold pick failed: ${r.ok ? "" : r.error.code}`);
        if (!r.ok) throw new Error("unreachable");
        assertInvariants(prev, r.state, geo, trackers);
        state = r.state;
      }
      continue;
    }

    // Deliberately invalid action (20 percent): must be rejected and change nothing.
    if (botRng() < 0.2) {
      const owned = ownedBy(state, who);
      const otherId = ids.find((id) => id !== who) ?? who;
      const tries: [string, Action][] = [
        [who, { type: "expand", code: "ZZ" }],
        [who, { type: "colonize", code: owned[0] ?? "FR" }],
        [otherId, { type: "endTurn" }],
      ];
      const [actor, bad] = tries[pick(tries.length)];
      const snapshot = structuredClone(state);
      const r = applyAction(state, actor, bad, ctx());
      assert.equal(r.ok, false, `invalid action was accepted: ${JSON.stringify(bad)}`);
      assert.deepEqual(state, snapshot, "rejected action changed the state");
      invalidTries += 1;
      continue;
    }

    // Legal bot move, weighted: expand 50, colonize 15, city 15, annex 10, endTurn 10.
    const moves = legalMoves(state, geo);
    const options: { weight: number; list: Action[] }[] = [
      { weight: 50, list: moves.expand.map((code) => ({ type: "expand", code }) as Action) },
      { weight: 15, list: moves.colonize.map((code) => ({ type: "colonize", code }) as Action) },
      { weight: 15, list: moves.city.map((code) => ({ type: "city", code, capital: geo.capitalsOf(code)[0] }) as Action) },
      { weight: 10, list: moves.annex.map((code) => ({ type: "annex", code, capital: geo.capitalsOf(code)[0] }) as Action) },
      { weight: 10, list: [{ type: "endTurn" }] },
    ];
    const usable = options.filter((o) => o.list.length > 0);
    let roll = botRng() * usable.reduce((sum, o) => sum + o.weight, 0);
    let chosen = usable[usable.length - 1];
    for (const o of usable) {
      if (roll < o.weight) {
        chosen = o;
        break;
      }
      roll -= o.weight;
    }
    let action = chosen.list[pick(chosen.list.length)];

    // Occasionally name the wrong capital: rejected, nothing changes.
    if ((action.type === "city" || action.type === "annex") && botRng() < 0.1) {
      action = { ...action, capital: "not a capital" } as Action;
      const snapshot = structuredClone(state);
      const r = applyAction(state, who, action, ctx());
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.error.code, "wrongCapital");
      assert.deepEqual(state, snapshot);
      wrongCapitals += 1;
      continue;
    }

    const r = applyAction(state, who, action, ctx());
    assert.equal(r.ok, true, `bot move ${JSON.stringify(action)} rejected: ${r.ok ? "" : err(r)}`);
    if (!r.ok) throw new Error("unreachable");
    assertInvariants(prev, r.state, geo, trackers);
    state = r.state;
  }
  assert.equal(state.phase, "finished", "game did not finish");
  return { state, log: state.log, invalidTries, wrongCapitals };
}

test("prop-01 random play keeps every invariant after every action (30 seeds, 3 players)", () => {
  let invalid = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const r = playGame(seed, 3);
    assert.ok(r.state.round <= 20, `seed ${seed}: round ${r.state.round}`);
    invalid += r.invalidTries;
  }
  assert.ok(invalid > 0);
});

test("prop-02 same seed replays to an identical game", () => {
  const a = playGame(7, 3);
  const b = playGame(7, 3);
  assert.deepEqual(a.state, b.state);
  assert.deepEqual(a.log, b.log);
});

test("prop-03 random play at 2 and 4 players also holds the invariants (10 seeds each)", () => {
  for (let seed = 1; seed <= 10; seed++) {
    assert.equal(playGame(seed, 2).state.phase, "finished");
    assert.equal(playGame(seed, 4).state.phase, "finished");
  }
});

test("prop-04 every game reaches a finished state within the round cap", () => {
  for (let seed = 31; seed <= 40; seed++) {
    const r = playGame(seed, 3);
    assert.equal(r.state.phase, "finished");
    assert.ok(r.state.round <= 20, `round ${r.state.round}`);
  }
});

test("prop-05 owners stay within the real game list and the first picker is seat 0", () => {
  const r = playGame(3, 3);
  for (const code of Object.keys(r.state.owners)) assert.ok(empire2Geo.codes().includes(code));
  assert.equal(r.state.players[0].seat, 0);
});
