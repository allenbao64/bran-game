import assert from "node:assert/strict";
import test from "node:test";
import { applyAction } from "@/lib/empire2/engine";
import { clockDeadline, clockExpired } from "@/lib/empire2/clock";
import { createGame, autoSetupPick } from "@/lib/empire2/setup";
import { advanceTimeouts } from "@/lib/empire2/turns";
import { currentPlayerId, isBoomPickPending } from "@/lib/empire2/state";
import { empire2TurnMs, EMPIRE2_TURN_SPEEDS, isEmpire2TurnSeconds } from "@/lib/empire2-playtest";
import type { EmpireState } from "@/lib/empire2/types";
import { buildPlayState, ctxAt, err, miniGeo, mulberry32, ok } from "@/tests/empire2-support";

const YEAR = 365 * 24 * 3600 * 1000;
const TEN_YEARS = 10 * YEAR;

function untimedPlay(now = 0): EmpireState {
  return buildPlayState({
    geo: miniGeo, turnMs: null, now,
    players: [{ id: "p1", owned: ["A1"], influence: 10 }, { id: "p2", owned: ["A3"], influence: 4 }],
  });
}

test("untimed-01 createGame with turnMs null stores null (no default)", () => {
  const s = ok(createGame({ playerIds: ["p1", "p2"], turnMs: null }, ctxAt(miniGeo, 0, mulberry32(1))));
  assert.equal(s.turnMs, null);
});

test("untimed-02 createGame without turnMs still uses the 30 s default", () => {
  const s = ok(createGame({ playerIds: ["p1", "p2"] }, ctxAt(miniGeo, 0, mulberry32(1))));
  assert.equal(s.turnMs, 30000);
});

test("untimed-03 turnMs 0 is not a clock: badTurnMs", () => {
  assert.equal(err(createGame({ playerIds: ["p1", "p2"], turnMs: 0 }, ctxAt(miniGeo, 0, mulberry32(1)))), "badTurnMs");
});

test("untimed-04 turnMs 25000 is still badTurnMs", () => {
  assert.equal(err(createGame({ playerIds: ["p1", "p2"], turnMs: 25000 }, ctxAt(miniGeo, 0, mulberry32(1)))), "badTurnMs");
});

test("untimed-05 an untimed turn is never expired, even a decade later", () => {
  const s = untimedPlay(0);
  for (const now of [YEAR + 1, TEN_YEARS]) {
    const r = applyAction(s, "p1", { type: "expand", code: "A2" }, ctxAt(miniGeo, now));
    assert.equal(r.ok, true, `expand at ${now} must not expire`);
  }
});

test("untimed-06 untimed boom pick is never expired", () => {
  const ctx = (now: number) => ctxAt(miniGeo, now, mulberry32(7));
  let s = ok(createGame({ playerIds: ["p1", "p2"], turnMs: null, rules: { underdogBoomPick: true } }, ctx(0)));
  for (let guard = 0; s.phase === "setup"; guard++) {
    assert.ok(guard < 100, "setup did not finish");
    const pid = currentPlayerId(s)!;
    s = ok(applyAction(s, pid, autoSetupPick(s, ctx(0))!, ctx(0)));
  }
  assert.equal(s.turnMs, null);
  assert.equal(isBoomPickPending(s), true, "the boom pick is pending at round 1");
  assert.ok(s.boomPick);
  const picked = applyAction(s, s.boomPick.playerId, { type: "pickBoom", region: miniGeo.regionNames()[0] }, ctx(TEN_YEARS));
  assert.equal(picked.ok, true, "pickBoom at ten years is still legal");
  assert.equal(advanceTimeouts(s, ctx(TEN_YEARS)), s, "and no timeout pick happens");
});

test("untimed-07 advanceTimeouts returns the same object and logs no timeout, however often it is called", () => {
  const s = untimedPlay(0);
  let current = s;
  for (let i = 1; i <= 1000; i++) {
    current = advanceTimeouts(current, ctxAt(miniGeo, i * 3 * YEAR / 100));
    assert.equal(current, s, `call ${i} returns the input unchanged`);
  }
  assert.equal(advanceTimeouts(s, ctxAt(miniGeo, TEN_YEARS)), s);
  assert.equal(s.log.filter((e) => e.type === "timeout").length, 0);
});

test("untimed-08 timed turns still expire at startedAt + turnMs", () => {
  const s = buildPlayState({ geo: miniGeo, turnMs: 30000, now: 0, players: [{ id: "p1", owned: ["A1"], influence: 10 }, { id: "p2" }] });
  assert.equal(err(applyAction(s, "p1", { type: "expand", code: "A2" }, ctxAt(miniGeo, 30000))), "turnExpired");
  assert.equal(advanceTimeouts(s, ctxAt(miniGeo, 29999)), s);
  assert.notEqual(advanceTimeouts(s, ctxAt(miniGeo, 30000)), s);
});

test("untimed-09 clockExpired table", () => {
  const start = 1000;
  for (const now of [0, start, start + 1, start + YEAR, Number.MAX_SAFE_INTEGER]) {
    assert.equal(clockExpired(now, start, null), false, `untimed at ${now}`);
  }
  assert.equal(clockExpired(start + 30000 - 1, start, 30000), false);
  assert.equal(clockExpired(start + 30000, start, 30000), true);
});

test("untimed-10 clockDeadline is null when untimed and never NaN", () => {
  assert.equal(clockDeadline(1000, null), null);
  assert.equal(clockDeadline(1000, 30000), 31000);
  for (const d of [clockDeadline(0, null), clockDeadline(5, 20000)]) assert.ok(d === null || Number.isFinite(d));
});

test("untimed-11 the speed list has an untimed option that maps to null, and 0 is a valid host value", () => {
  assert.ok(EMPIRE2_TURN_SPEEDS.some((s) => s.seconds === 0 && s.label === "No time limit"));
  assert.equal(isEmpire2TurnSeconds(0), true);
  assert.equal(isEmpire2TurnSeconds(15), false);
  assert.equal(empire2TurnMs(0), null);
  assert.equal(empire2TurnMs(30), 30000);
});

test("untimed-12 setup never auto-picks when untimed: the clock has no deadline", () => {
  const ctx = (now: number) => ctxAt(miniGeo, now, mulberry32(3));
  const s = ok(createGame({ playerIds: ["p1", "p2"], turnMs: null }, ctx(0)));
  // Nothing changes at any later time: there is no setup clock to expire.
  const later = (now: number) => advanceTimeouts(s, ctx(now));
  assert.equal(later(TEN_YEARS), s);
  assert.equal(s.setup?.step, "capital");
});
