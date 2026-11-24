// Empire 2.0 play rules (plan step 4a): the owner-chosen preset, the explorer title switch, the colonizer's
// explorer behaviour, and the simulator's --base flag. The property test at the end plays seeded bot games under the
// preset with the invariant checker and the back-to-back check.
import assert from "node:assert/strict";
import test from "node:test";
import { EMPIRE2_PLAY_RULES, EMPIRE2_RULES, resolveRules } from "@/lib/empire2";
import { empire2Geo } from "@/lib/empire2/geo-adapter";
import { isBackToBack } from "@/lib/empire2/order";
import { createGame } from "@/lib/empire2/setup";
import { withTitles, computeTitles } from "@/lib/empire2/titles";
import { scorePlayer } from "@/lib/empire2/victory";
import type { EmpireState, Rules } from "@/lib/empire2/types";
import { decideTurn } from "@/scripts/empire2-sim/bots";
import { baseOverrides, CONFIGS, KNOW_P, parseBase, parseRulesOverrides } from "@/scripts/empire2-sim/config";
import { mulberry32 } from "@/scripts/empire2-sim/rng";
import { lineupFor, playGame, runConfig } from "@/scripts/empire2-sim/runner";
import { computeReport, formatReport, type RunMeta } from "@/scripts/empire2-sim/report";
import { assertInvariants, buildPlayState, ctxAt, makeGeo, miniGeo, newTrackers } from "@/tests/empire2-support";

const quiet = () => undefined;

function clique(members: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) out.push([members[i], members[j]]);
  return out;
}

// ---------- 1. The preset ----------

const PRESET_CHANGES: Partial<Rules> = {
  turnOrder: "leaderLast",
  winCheck: "endOfTurn",
  territoryPoints: false,
  maxExpandsPerTurn: 2,
  winPoints: 14,
  explorerTitle: false,
};

test("play preset has the owner-chosen values", () => {
  for (const [key, value] of Object.entries(PRESET_CHANGES)) {
    assert.equal(EMPIRE2_PLAY_RULES[key as keyof Rules], value, `${key}`);
  }
  assert.equal(EMPIRE2_PLAY_RULES.cheapColonize, "everyStuckTurn", "cheapColonize stays every stuck turn");
  for (const key of Object.keys(EMPIRE2_RULES) as (keyof Rules)[]) {
    if (key in PRESET_CHANGES) continue;
    assert.deepEqual(EMPIRE2_PLAY_RULES[key], EMPIRE2_RULES[key], `${key} equals the default`);
  }
  assert.deepEqual(Object.keys(EMPIRE2_PLAY_RULES).sort(), Object.keys(EMPIRE2_RULES).sort());
});

test("the default rules keep the current values, with the explorer title on", () => {
  assert.equal(EMPIRE2_RULES.explorerTitle, true);
  assert.equal(EMPIRE2_RULES.turnOrder, "snake");
  assert.equal(EMPIRE2_RULES.winPoints, 10);
  assert.equal(EMPIRE2_RULES.maxExpandsPerTurn, 3);
  assert.equal(EMPIRE2_RULES.territoryPoints, true);
});

// ---------- 2. The explorer title switch (titles.ts, victory.ts) ----------

// Five continents for p0: Main (a six-country clique, so a largest empire of 6) and four single-country islands.
const MAIN = ["M1", "M2", "M3", "M4", "M5", "M6"];
const FIVE_CONTINENTS = makeGeo({
  continents: { Main: MAIN, Isle1: ["I1"], Isle2: ["J1"], Isle3: ["K1"], Isle4: ["L1"] },
  regions: {},
  edges: clique(MAIN),
});
const FIVE_OWNED = [...MAIN, "I1", "J1", "K1", "L1"];

test("explorer title off: never awarded and scores zero, largest empire still awarded", () => {
  const s = buildPlayState({
    geo: FIVE_CONTINENTS,
    players: [{ id: "p0", owned: FIVE_OWNED }, { id: "p1" }],
    round: 1,
    rules: { explorerTitle: false },
  });
  assert.equal(computeTitles(s, FIVE_CONTINENTS).explorer, null);
  assert.equal(s.titles.explorer, null);
  const vp = scorePlayer(s, "p0", FIVE_CONTINENTS);
  assert.equal(vp.explorer, 0);
  assert.equal(s.titles.largestEmpire, "p0", "largest empire is unaffected");
  assert.equal(vp.largestEmpire, 2);
  assert.equal(scorePlayer(s, "p1", FIVE_CONTINENTS).explorer, 0);

  // No title change and no log entry for the explorer, even when the titles are recomputed from nothing.
  const fresh = buildPlayState({
    geo: FIVE_CONTINENTS,
    players: [{ id: "p0", owned: FIVE_OWNED }, { id: "p1" }],
    round: 1,
    rules: { explorerTitle: false },
    titles: { largestEmpire: null, explorer: null },
  });
  const after = withTitles(fresh, FIVE_CONTINENTS);
  const titleNotes = after.log.filter((e) => e.type === "title").map((e) => e.note);
  assert.deepEqual(titleNotes, ["largestEmpire"]);
  assert.equal(after.titles.explorer, null);
});

test("explorer title on: five continents still award the explorer title and 2 points", () => {
  const s = buildPlayState({
    geo: FIVE_CONTINENTS,
    players: [{ id: "p0", owned: FIVE_OWNED }, { id: "p1" }],
    round: 1,
  });
  assert.equal(computeTitles(s, FIVE_CONTINENTS).explorer, "p0");
  assert.equal(scorePlayer(s, "p0", FIVE_CONTINENTS).explorer, 2);
  assert.equal(scorePlayer(s, "p0", FIVE_CONTINENTS).largestEmpire, 2);
});

// ---------- 3. Validation (setup.ts) ----------

test("createGame rejects a non-boolean explorerTitle and accepts booleans", () => {
  const ctx = ctxAt(empire2Geo, 0, mulberry32(1));
  for (const value of ["no", 0, null, 1]) {
    const r = createGame({ playerIds: ["p0", "p1"], rules: { explorerTitle: value } as unknown as Partial<Rules> }, ctx);
    assert.equal(r.ok, false, `explorerTitle = ${String(value)} should be rejected`);
    if (!r.ok) {
      assert.equal(r.error.code, "badRules");
      assert.ok(r.error.message.includes("explorerTitle"), "the message names explorerTitle");
    }
  }
  for (const value of [true, false]) {
    assert.equal(createGame({ playerIds: ["p0", "p1"], rules: { explorerTitle: value } }, ctx).ok, true);
  }
});

test("rules file accepts explorerTitle as a boolean only", () => {
  const good = parseRulesOverrides({ explorerTitle: false });
  assert.ok(good.ok && good.overrides.explorerTitle === false);
  const bad = parseRulesOverrides({ explorerTitle: "off" });
  assert.ok(!bad.ok && bad.errors.some((e) => e.includes("explorerTitle")));
});

// ---------- 4. The colonizer and the explorer title (bots.ts) ----------

// Alpha is fully owned by a, so no expand is possible into a new continent, and each region of Beta and Gamma has
// free countries, so no region can be completed. A has 4 influence, 1 expand already spent this turn, and one free
// country on the frontier (A6). With the title on, the colonizer colonizes onto another continent for it. With the
// title off, it expands into the frontier (A6) instead.
function colonizerSituation(rules: Partial<Rules>) {
  const s = buildPlayState({
    geo: miniGeo,
    players: [
      { id: "a", influence: 4, owned: ["A1", "A2", "A3", "A4", "A5"] },
      { id: "b", influence: 0, owned: ["B1"] },
    ],
    round: 1,
    rules,
  });
  return { ...s, turn: { ...s.turn!, expands: 1 } };
}

test("the colonizer chases a new continent for the explorer title only when the title is on", () => {
  const on = colonizerSituation({});
  const onAct = decideTurn("colonizer", on, miniGeo, "a", new Set(), mulberry32(3));
  assert.equal(onAct.type, "colonize", "title on: colonize for the explorer title");
  assert.ok(onAct.type === "colonize" && miniGeo.continentOf(onAct.code) !== "Alpha");

  const off = colonizerSituation({ explorerTitle: false });
  const offAct = decideTurn("colonizer", off, miniGeo, "a", new Set(), mulberry32(3));
  assert.deepEqual(offAct, { type: "expand", code: "A6" }, "title off: no continent chase, the expand into the frontier");
});

// ---------- 5. The simulator's base flag (config.ts, run.ts, report.ts) ----------

test("simulator base flag: parseBase accepts play and default only", () => {
  assert.equal(parseBase("play"), "play");
  assert.equal(parseBase("default"), "default");
  assert.equal(parseBase("Play"), null);
  assert.equal(parseBase("x"), null);
  assert.equal(parseBase(undefined), null);
});

test("simulator base flag: each base resolves to its rules, and the rules file applies on top", () => {
  assert.deepEqual(resolveRules(baseOverrides("play")), EMPIRE2_PLAY_RULES);
  assert.deepEqual(resolveRules(baseOverrides("default")), EMPIRE2_RULES);
  const file = parseRulesOverrides({ colonizeCost: 5 });
  assert.ok(file.ok);
  if (!file.ok) throw new Error("unreachable");
  const combined = resolveRules({ ...baseOverrides("play"), ...file.overrides });
  assert.equal(combined.colonizeCost, 5, "the rules file wins over the base");
  assert.equal(combined.explorerTitle, false, "the rest of the base stays");
});

test("simulator base flag: the report header names the base and explorer points print n/a when the title is off", () => {
  const meta = (base: "play" | "default"): RunMeta => ({
    seedBase: 0, base, overrides: {}, startedAt: "", wallSeconds: 0, node: "", commit: "",
  });
  const config = { ...CONFIGS.find((c) => c.id === "mini-3p-pure")!, games: 2 };
  const playRules = resolveRules(baseOverrides("play"));
  const playText = formatReport(computeReport(runConfig(config, { seedBase: 0, rules: baseOverrides("play"), log: quiet }), config, playRules, meta("play")));
  assert.ok(playText.includes("base: play (EMPIRE2_PLAY_RULES)"));
  assert.ok(/^explorer +n\/a \(title off\)$/m.test(playText), "explorer row is n/a");

  const defText = formatReport(computeReport(runConfig(config, { seedBase: 0, rules: {}, log: quiet }), config, resolveRules(), meta("default")));
  assert.ok(defText.includes("base: default (EMPIRE2_RULES)"));
  assert.ok(!/^explorer +n\/a/m.test(defText), "explorer row is a measurement with the title on");
});

// ---------- 6. Property test under the preset ----------

/** The back-to-back check from tests/empire2-options-property.test.ts, one game at a time. */
function backToBackCheck() {
  let lastKey: string | null = null;
  let lastSeat: number | null = null;
  return (after: EmpireState): void => {
    if (after.phase !== "play" || after.turn === null) return;
    const key = `${after.round}:${after.turn.indexInRound}`;
    if (key === lastKey) return;
    const seat = after.turn.seat;
    const expected = isBackToBack(lastSeat, seat);
    assert.equal(
      after.turn.isSecondOfTwo,
      expected,
      `back-to-back flag at round ${after.round}, turn ${after.turn.indexInRound} (previous seat ${lastSeat}, seat ${seat})`,
    );
    lastKey = key;
    lastSeat = seat;
  };
}

test("random play under EMPIRE2_PLAY_RULES: every invariant and the back-to-back flag hold (mini map, 2 to 4 players)", () => {
  for (const n of [2, 3, 4]) {
    for (let i = 0; i < 3; i++) {
      const trackers = newTrackers();
      const checkBackToBack = backToBackCheck();
      const record = playGame({
        geo: miniGeo,
        lineup: lineupFor(i, n, "pure"),
        seed: 5000 + 10 * n + i,
        knowP: KNOW_P,
        slowP: 0.1,
        rules: EMPIRE2_PLAY_RULES,
        onStep: (before, after) => {
          assertInvariants(before, after, miniGeo, trackers);
          checkBackToBack(after);
        },
      });
      assert.ok(record.rounds >= 1 && record.rounds <= 20, `rounds ${record.rounds} out of range`);
      assert.ok(record.winners.length >= 1, "a game ends with a winner");
    }
  }
});

test("random play under EMPIRE2_PLAY_RULES, real map: invariants and the back-to-back flag hold (2 games)", () => {
  for (let i = 0; i < 2; i++) {
    const trackers = newTrackers();
    const checkBackToBack = backToBackCheck();
    const record = playGame({
      geo: empire2Geo,
      lineup: lineupFor(i, 3, "mixed"),
      seed: 8000 + i,
      knowP: KNOW_P,
      slowP: 0,
      rules: EMPIRE2_PLAY_RULES,
      onStep: (before, after) => {
        assertInvariants(before, after, empire2Geo, trackers);
        checkBackToBack(after);
      },
    });
    assert.ok(record.winners.length >= 1);
    assert.ok(record.seats.every((seat) => seat.vp.explorer === 0), "no explorer points under the preset");
  }
});
