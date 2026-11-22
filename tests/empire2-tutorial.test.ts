import assert from "node:assert/strict";
import test from "node:test";
import { applyAction } from "@/lib/empire2/engine";
import { playtestRules } from "@/lib/empire2-playtest";
import { createTutorialState, runScriptedStep, stepIsComplete, TUTORIAL_CTX, TUTORIAL_STEPS, ME, RIVAL } from "@/lib/empire2-tutorial";
import type { Action, EmpireState } from "@/lib/empire2/types";
import { deepFreeze } from "@/tests/empire2-support";

const rules = playtestRules(false);
const step = (id: string) => TUTORIAL_STEPS.find((s) => s.id === id)!;
const influence = (s: EmpireState) => s.players.find((p) => p.id === ME)!.influence;

/** Plays every scripted step in order and returns the states after each one. */
function playScript(start = createTutorialState()): EmpireState[] {
  const states: EmpireState[] = [];
  let s = start;
  for (const st of TUTORIAL_STEPS) {
    if (st.script === null) { states.push(s); continue; }
    const r = runScriptedStep(s, st, st.script);
    assert.equal(r.ok, true, `${st.id} script is legal`);
    if (!r.ok) throw new Error("unreachable");
    s = r.state;
    states.push(s);
  }
  return states;
}

test("tutorial-01 the practice position is a legal play state for the practice player", () => {
  const s = createTutorialState();
  assert.equal(s.phase, "play");
  assert.equal(s.turn?.playerId, ME);
  assert.equal(s.turnMs, null, "untimed: nothing in the tutorial can expire");
  assert.deepEqual(Object.entries(s.owners).sort(), [["DE", ME], ["ES", RIVAL], ["FR", ME], ["IT", RIVAL], ["PL", RIVAL]]);
  assert.equal(s.round, 3);
});

test("tutorial-02 each scripted step is legal and completes, in order", () => {
  let s = createTutorialState();
  for (const st of TUTORIAL_STEPS) {
    if (st.script === null) { assert.equal(stepIsComplete(st, s), true, `${st.id} intro`); continue; }
    const r = runScriptedStep(s, st, st.script);
    assert.equal(r.ok, true, `${st.id} is legal`);
    if (!r.ok) throw new Error("unreachable");
    s = r.state;
    assert.equal(stepIsComplete(st, s), true, `${st.id} is complete after its move`);
  }
});

test("tutorial-03 the scripted influence and the final state match the table", () => {
  const states = playScript();
  const influences = states.map(influence);
  assert.deepEqual(influences, [16, 16, 15, 9, 6, 1, 1], "16 -> 16 (free) -> 15 -> 9 -> 6 -> 1");
  const s = states[states.length - 1];
  assert.equal(s.turn?.playerId, RIVAL, "the turn passed to the rival");
  assert.equal(s.turn?.indexInRound, 1);
  assert.equal(s.round, 3, "no round change");
  for (const code of ["FR", "DE", "BE", "LU", "BR", "ES"]) assert.equal(s.owners[code], ME, `${code} is yours`);
  assert.equal(s.owners.IT, RIVAL);
  assert.equal(s.owners.PL, RIVAL);
  assert.deepEqual(s.cities, ["DE"]);
  assert.deepEqual(s.log.map((e) => e.type), ["expand", "expand", "colonize", "city", "annex", "endTurn"]);
});

test("tutorial-04 every cost shown is the real playtest rule value", () => {
  const states = playScript();
  assert.equal(influence(states[0]) - influence(states[1]), 0, "first expand is free");
  assert.equal(influence(states[1]) - influence(states[2]), rules.expandCost);
  assert.equal(influence(states[2]) - influence(states[3]), rules.colonizeCost);
  assert.equal(influence(states[3]) - influence(states[4]), rules.cityCost);
  assert.equal(influence(states[4]) - influence(states[5]), rules.annexCost);
});

const WRONG: [string, string, Action, string, string][] = [
  // [step, label, wrong action, expected engine code, expected hint]
  ["expand", "expand JP (not next to you)", { type: "expand", code: "JP" }, "notOnFrontier", "Expand only works next to your empire. Tap an outlined country."],
  ["expand", "expand IT (taken)", { type: "expand", code: "IT" }, "countryTaken", "That one is already taken. Look for an outlined country."],
  ["second", "expand JP after the first expand", { type: "expand", code: "JP" }, "notOnFrontier", "Expand only works next to your empire. Tap an outlined country."],
  ["settle", "settle FR (owned)", { type: "colonize", code: "FR" }, "countryTaken", "Settle takes a free country, one nobody owns."],
  ["stronghold", "stronghold DE with capital Paris", { type: "city", code: "DE", capital: "Paris" }, "wrongCapital", "That's not the capital city of Germany. Try again."],
  ["stronghold", "stronghold ES (rival)", { type: "city", code: "ES", capital: "Madrid" }, "notOwned", "You can only build strongholds in countries you own."],
  ["takeover", "take over IT (home country)", { type: "annex", code: "IT", capital: "Rome" }, "protectedStartingCapital", "Home countries can't be taken over. Pick another rival country."],
  ["takeover", "take over PL (outpost)", { type: "annex", code: "PL", capital: "Warsaw" }, "protectedFoothold", "Outposts can't be taken over. Pick another rival country."],
  ["takeover", "take over PT (free)", { type: "annex", code: "PT", capital: "Lisbon" }, "notRival", "Pick a country a rival owns."],
  ["takeover", "take over ES with capital Lisbon", { type: "annex", code: "ES", capital: "Lisbon" }, "wrongCapital", "That's not the capital city of Spain. Try again."],
];

/** The state a wrong move is tried on: the state at the start of the named step. */
function stateBefore(id: string): EmpireState {
  const states = playScript();
  const index = TUTORIAL_STEPS.findIndex((s) => s.id === id);
  return index === 0 ? createTutorialState() : states[index - 1];
}

for (const [id, label, action, code, expected] of WRONG) {
  test(`tutorial-05 wrong click (${label}) keeps the step open with one hint`, () => {
    const st = step(id);
    const before = stateBefore(id);
    const r = runScriptedStep(before, st, action);
    assert.equal(r.ok, false, "the wrong move is refused");
    if (r.ok) throw new Error("unreachable");
    assert.equal(r.code, code, "the engine code");
    assert.equal(r.hint, expected);
    assert.ok(r.hint.length > 0 && !r.hint.includes("\n"), "one non-empty line");
  });
}

test("tutorial-06 an unmapped engine error falls back to a generic hint, never empty", () => {
  const r = runScriptedStep(createTutorialState(), step("expand"), { type: "expand", code: "FR" });
  assert.equal(r.ok, false);
  if (r.ok) throw new Error("unreachable");
  assert.ok(r.hint.length > 0);
});

test("tutorial-07 hints never reveal the capital city answers", () => {
  const answers = ["Berlin", "Madrid", "Paris"];
  for (const st of TUTORIAL_STEPS) {
    for (const value of Object.values(st.hints)) {
      const text = typeof value === "function" ? value("XX") : value ?? "";
      for (const answer of answers) assert.ok(!text.includes(answer), `${st.id} hint does not name ${answer}`);
    }
  }
  for (const [, , , , expected] of WRONG) for (const answer of answers) assert.ok(!expected.includes(answer));
});

test("tutorial-08 the scripted run is pure: the frozen start state is never mutated and nothing is drawn", () => {
  const start = deepFreeze(createTutorialState());
  // TUTORIAL_CTX.rng throws, so completing the run proves no random draw happens.
  assert.equal(TUTORIAL_CTX.now, 0);
  const states = playScript(start);
  assert.equal(states.length, TUTORIAL_STEPS.length);
  assert.equal(influence(start), 16, "the start state is unchanged");
});

test("tutorial-09 Show me plays the same action as the player: identical states", () => {
  for (const st of TUTORIAL_STEPS) {
    if (!st.script) continue;
    const before = stateBefore(st.id);
    const viaShowMe = runScriptedStep(before, st, st.script);
    const viaPlayer = runScriptedStep(before, st, { ...st.script } as Action);
    assert.deepEqual(viaShowMe, viaPlayer, `${st.id}: same state from the same move`);
  }
});

test("tutorial-10 the step table has seven steps, each text at most two sentences", () => {
  assert.equal(TUTORIAL_STEPS.length, 7);
  for (const st of TUTORIAL_STEPS) {
    const sentences = st.text.split(/(?<=[.!?])\s+/).filter(Boolean);
    assert.ok(sentences.length <= 2, `${st.id} has ${sentences.length} sentences`);
    assert.ok(st.heading.split(/\s+/).length <= 4, `${st.id} heading is short`);
  }
});

test("tutorial-11 the step text takes its numbers from the rules, not typed values", () => {
  assert.ok(step("settle").text.includes(`${rules.colonizeCost} influence`));
  assert.ok(step("stronghold").text.includes(`${rules.cityCost} influence`));
  assert.ok(step("takeover").text.includes(`${rules.annexCost}`));
  assert.ok(step("empire").text.includes(`${rules.winPoints} points`));
});
