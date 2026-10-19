import assert from "node:assert/strict";
import test from "node:test";
import { scoring } from "@/lib/empire/scoring";
import {
  EMPIRE_RULES,
  setBonus,
  type EmpireGeo,
  type EmpireLogEntry,
  type EmpireState,
  type ScoreBreakdown
} from "@/lib/empire/types";

// Fake geo: 10 countries in one chain (M1..M6, W1, W2, E1, E2) across 3 regions.
// Mid = 6 countries (set +5), West = 2 (set +3), East = 2 (set +3).
const CHAIN = ["M1", "M2", "M3", "M4", "M5", "M6", "W1", "W2", "E1", "E2"];
const REGIONS: Record<string, string[]> = {
  Mid: ["M1", "M2", "M3", "M4", "M5", "M6"],
  West: ["W1", "W2"],
  East: ["E1", "E2"]
};
const geo: Pick<EmpireGeo, "neighbours" | "regionOf" | "regionMembers" | "regionNames"> = {
  neighbours: (code) => {
    const i = CHAIN.indexOf(code);
    const out: string[] = [];
    if (i > 0) out.push(CHAIN[i - 1]);
    if (i >= 0 && i < CHAIN.length - 1) out.push(CHAIN[i + 1]);
    return out;
  },
  regionOf: (code) => Object.keys(REGIONS).find((r) => REGIONS[r].includes(code)) ?? "",
  regionMembers: (region) => REGIONS[region] ?? [],
  regionNames: () => Object.keys(REGIONS)
};

const PLAYERS = ["p1", "p2", "p3"];
type Owned = Record<string, string[]>;

function ownersOf(owned: Owned): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [player, codes] of Object.entries(owned)) {
    for (const code of codes) {
      assert.equal(out[code], undefined, `${code} owned twice`);
      out[code] = player;
    }
  }
  return out;
}

function score(owned: Owned, holder: string | null = null, log: EmpireLogEntry[] = []) {
  const state: Pick<EmpireState, "players" | "owners" | "empireHolder" | "log"> = {
    players: PLAYERS.map((id) => ({ id, capital: "", stealTokens: 0, forts: [] })),
    owners: ownersOf(owned),
    empireHolder: holder,
    log
  };
  return scoring.scoreEmpire(state, geo);
}

function breakdown(total: number, countries: number): ScoreBreakdown {
  return { countries, goldRush: 0, empireSize: 0, empire: 0, sets: [], majorities: [], total };
}

test("country counts follow ownership", () => {
  const { scores } = score({ p1: ["M1", "M2", "M3", "W1"], p2: ["M4", "M5"], p3: ["W2", "E1", "E2"] });
  assert.equal(scores.p1.countries, 4);
  assert.equal(scores.p2.countries, 2);
  assert.equal(scores.p3.countries, 3);
});

test("gold rush counts only claims at more than 1 point that the player still owns", () => {
  const log: EmpireLogEntry[] = [
    { kind: "claim", playerId: "p1", code: "E1", points: 2, round: 1, at: 1 },
    { kind: "claim", playerId: "p1", code: "M1", points: 3, round: 2, at: 2 },
    { kind: "claim", playerId: "p1", code: "W1", points: 2, round: 2, at: 3 },
    { kind: "claim", playerId: "p1", code: "M2", points: 1, round: 2, at: 4 },
    { kind: "steal", playerId: "p1", code: "M2", from: "p2", round: 2, at: 5 },
    { kind: "claim", playerId: "p2", code: "M3", points: 2, round: 3, at: 6 }
  ];
  // W1 was claimed by p1 at gold rush but is now p2's (stolen), so it no longer counts.
  const { scores } = score({ p1: ["M1", "M2", "E1"], p2: ["M3", "W1"] }, null, log);
  assert.equal(scores.p1.goldRush, 1 + 2);
  assert.equal(scores.p2.goldRush, 1);
});

test("largest empire below empireMin gives nobody the bonus", () => {
  const { scores, empireHolder } = score({ p1: ["M1", "M2", "M3", "M4"], p2: ["E1", "E2"] });
  assert.equal(scores.p1.empireSize, 4);
  assert.equal(scores.p1.empire, 0);
  assert.equal(empireHolder, null);
});

test("a unique largest empire at or above empireMin takes the bonus", () => {
  const { scores, empireHolder } = score({ p1: ["M1", "M2", "M3", "M4", "M5"], p2: ["W1", "W2", "E1", "E2"] });
  assert.equal(EMPIRE_RULES.empireMin, 5);
  assert.equal(empireHolder, "p1");
  assert.equal(scores.p1.empireSize, 5);
  assert.equal(scores.p1.empire, EMPIRE_RULES.empireBonus);
  assert.equal(scores.p2.empireSize, 4);
  assert.equal(scores.p2.empire, 0);
  // 5 countries + 3 empire + 1 majority (Mid: 5 vs 0), no sets (M6 unowned)
  assert.equal(scores.p1.total, 5 + 0 + 3 + 0 + 1);
});

test("a tie for biggest keeps the bonus with the previous holder when they are among the tied", () => {
  const owned = { p1: ["M1", "M2", "M3", "M4", "M5"], p2: ["M6", "W1", "W2", "E1", "E2"] };
  const { scores, empireHolder } = score(owned, "p2");
  assert.equal(scores.p1.empireSize, 5);
  assert.equal(scores.p2.empireSize, 5);
  assert.equal(empireHolder, "p2");
  assert.equal(scores.p2.empire, EMPIRE_RULES.empireBonus);
  assert.equal(scores.p1.empire, 0);
});

test("a tie for biggest with no previous holder gives nobody the bonus", () => {
  const owned = { p1: ["M1", "M2", "M3", "M4", "M5"], p2: ["M6", "W1", "W2", "E1", "E2"] };
  const { scores, empireHolder } = score(owned, null);
  assert.equal(empireHolder, null);
  assert.equal(scores.p1.empire, 0);
  assert.equal(scores.p2.empire, 0);
});

test("a tie does not keep the bonus for a previous holder who is not among the tied", () => {
  const owned = { p1: ["M1", "M2", "M3", "M4", "M5"], p2: ["M6", "W1", "W2", "E1", "E2"] };
  const { empireHolder } = score(owned, "p3");
  assert.equal(empireHolder, null);
});

test("a holder who drops below empireMin loses the bonus", () => {
  // p2 was holder but is down to 2 countries; nobody else qualifies.
  const none = score({ p1: ["M1", "M2", "M3", "M4"], p2: ["E1", "E2"] }, "p2");
  assert.equal(none.empireHolder, null);
  assert.equal(none.scores.p2.empire, 0);

  // p2 was holder but a unique qualifier (p1, 5) now exists.
  const replaced = score({ p1: ["M1", "M2", "M3", "M4", "M5"], p2: ["E1", "E2"] }, "p2");
  assert.equal(replaced.empireHolder, "p1");
  assert.equal(replaced.scores.p2.empire, 0);
  assert.equal(replaced.scores.p1.empire, EMPIRE_RULES.empireBonus);
});

test("set bonus: 2-4 countries +3, 5-9 +5, 10+ +8 (setBonus directly)", () => {
  assert.equal(setBonus(2), 3);
  assert.equal(setBonus(4), 3);
  assert.equal(setBonus(5), 5);
  assert.equal(setBonus(9), 5);
  assert.equal(setBonus(10), 8);
  assert.equal(setBonus(12), 8);
});

test("completed region sets are scored with the matching bonus; partial sets are not", () => {
  const full = score({ p1: ["M1", "M2", "M3", "M4", "M5", "M6"], p2: ["W1", "W2"], p3: ["E1", "E2"] });
  assert.deepEqual(full.scores.p1.sets, [{ region: "Mid", points: 5 }]);
  assert.deepEqual(full.scores.p2.sets, [{ region: "West", points: 3 }]);
  assert.deepEqual(full.scores.p3.sets, [{ region: "East", points: 3 }]);

  const partial = score({ p1: ["M1", "M2", "M3", "M4", "M5"], p2: ["M6"] });
  assert.deepEqual(partial.scores.p1.sets, []);
});

test("majority needs a strict lead and at least majorityMin countries", () => {
  const lead = score({ p1: ["M1", "M2", "M3", "M4"], p2: ["M5", "M6"] });
  assert.deepEqual(lead.scores.p1.majorities, ["Mid"]);
  assert.deepEqual(lead.scores.p2.majorities, []);

  const tie = score({ p1: ["M1", "M2", "M3"], p2: ["M4", "M5", "M6"] });
  assert.deepEqual(tie.scores.p1.majorities, []);
  assert.deepEqual(tie.scores.p2.majorities, []);

  // A full 2-country region is a set but can never be a majority (min 3).
  const small = score({ p1: ["W1", "W2"] });
  assert.deepEqual(small.scores.p1.majorities, []);
  assert.deepEqual(small.scores.p1.sets, [{ region: "West", points: 3 }]);
});

test("total = countries + goldRush + empire + sets + majorities", () => {
  const log: EmpireLogEntry[] = [{ kind: "claim", playerId: "p1", code: "E1", points: 2, round: 1, at: 1 }];
  const { scores, empireHolder } = score(
    { p1: ["M1", "M2", "M3", "M4", "E1", "E2"], p2: ["M5", "M6", "W1", "W2"], p3: [] },
    null,
    log
  );
  assert.equal(empireHolder, null);
  assert.deepEqual(scores.p1, {
    countries: 6,
    goldRush: 1,
    empireSize: 4,
    empire: 0,
    sets: [{ region: "East", points: 3 }],
    majorities: ["Mid"],
    total: 6 + 1 + 0 + 3 + 1
  });
  assert.equal(scores.p2.total, 4 + 0 + 0 + 3 + 0);
  assert.equal(scores.p3.total, 0);
});

test("protectedCodes includes capitals, forts and only completed sets", () => {
  const state = {
    players: [
      { id: "p1", capital: "M1", stealTokens: 0, forts: ["M3"] },
      { id: "p2", capital: "M5", stealTokens: 0, forts: [] },
      { id: "p3", capital: "W2", stealTokens: 0, forts: [] }
    ],
    // West is split between p2 and p3, so it is not a completed set.
    owners: ownersOf({ p1: ["M1", "M2", "M3", "M4"], p2: ["M5", "M6", "W1"], p3: ["W2", "E1", "E2"] })
  };
  const protectedSet = scoring.protectedCodes(state, geo);
  assert.deepEqual([...protectedSet].sort(), ["E1", "E2", "M1", "M3", "M5", "W2"]);
  for (const code of ["M2", "M4", "M6", "W1"]) assert.equal(protectedSet.has(code), false, code);
});

test("winners: highest total wins", () => {
  assert.deepEqual(scoring.winners({ a: breakdown(9, 9), b: breakdown(10, 2) }, "points"), ["b"]);
});

test("winners: ties break by more countries", () => {
  assert.deepEqual(scoring.winners({ a: breakdown(10, 5), b: breakdown(10, 7) }, "points"), ["b"]);
});

test("winners: still tied after countries is a shared win for all of them", () => {
  const scores = { a: breakdown(10, 6), b: breakdown(10, 6), c: breakdown(10, 5), d: breakdown(9, 9) };
  assert.deepEqual(scoring.winners(scores, "cap").sort(), ["a", "b"]);
});

test("winners: empty scores give no winners and reason does not change the rule", () => {
  assert.deepEqual(scoring.winners({}, "points"), []);
  const scores = { a: breakdown(10, 6), b: breakdown(10, 6), c: breakdown(7, 8) };
  assert.deepEqual(scoring.winners(scores, "points"), scoring.winners(scores, "cap"));
});
