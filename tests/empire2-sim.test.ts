import assert from "node:assert/strict";
import test from "node:test";
import { empire2Geo, legalMoves, scorePlayer } from "@/lib/empire2";
import { resolveRules } from "@/lib/empire2/rules";
import type { EmpireState, Rng } from "@/lib/empire2/types";
import { decideTurn, makeKnownCapitals, type Strategy } from "@/scripts/empire2-sim/bots";
import { CONFIGS, parseRulesOverrides, type ConfigSpec } from "@/scripts/empire2-sim/config";
import { mulberry32, streamSeed } from "@/scripts/empire2-sim/rng";
import { lineupFor, playGame, runConfig } from "@/scripts/empire2-sim/runner";
import {
  annexStats, lastPlaceAt, leaderChanges, lengthStats, pointSources, strategyRows, topStrategy, turnDiagnostics, winnerPositions,
  worstSeat,
} from "@/scripts/empire2-sim/metrics";
import { computeReport, formatReport } from "@/scripts/empire2-sim/report";
import { emptyStats, type GameRecord, type SeatStats } from "@/scripts/empire2-sim/types";
import { assertInvariants, buildPlayState, miniGeo, newTrackers, type PlaySpec } from "@/tests/empire2-support";

const rng: Rng = mulberry32(12345);

function stateWith(spec: PlaySpec, expands: number): EmpireState {
  const s = buildPlayState(spec);
  return { ...s, turn: { ...s.turn!, expands } };
}

const rules = resolveRules({});

// ---------- 1. Legal decisions (mini map) ----------

test("expander with 2 influence and a frontier expands to a legal country, never city or annex", () => {
  const s = buildPlayState({ geo: miniGeo, players: [{ id: "a", influence: 2, owned: ["A1"] }, { id: "b", influence: 0, owned: ["B1"] }] });
  const act = decideTurn("expander", s, miniGeo, "a", new Set(["A1"]), rng);
  assert.equal(act.type, "expand");
  assert.ok("code" in act && legalMoves(s, miniGeo).expand.includes(act.code));
});

test("expander with an empty frontier and 4 influence colonizes", () => {
  const s = buildPlayState({
    geo: miniGeo,
    players: [{ id: "a", influence: 4, owned: ["A1", "A2", "A3", "A4", "A5", "A6"] }, { id: "b", influence: 0, owned: ["B1"] }],
  });
  const act = decideTurn("expander", s, miniGeo, "a", new Set(), rng);
  assert.equal(act.type, "colonize");
  assert.ok("code" in act && legalMoves(s, miniGeo).colonize.includes(act.code));
});

test("expander with nothing affordable ends the turn", () => {
  const s = stateWith({ geo: miniGeo, players: [{ id: "a", influence: 0, owned: ["A1"] }, { id: "b", influence: 0, owned: ["B1"] }] }, 1);
  assert.deepEqual(decideTurn("expander", s, miniGeo, "a", new Set(["A1"]), rng), { type: "endTurn" });
});

test("expander never returns city or annex, even when affordable", () => {
  const s = buildPlayState({
    geo: miniGeo,
    players: [{ id: "a", influence: 10, owned: ["A1", "A2"] }, { id: "b", influence: 0, owned: ["A3"] }],
  });
  const known = new Set(["A1", "A2", "A3"]);
  for (const expands of [0, 1]) {
    const withExpands = { ...s, turn: { ...s.turn!, expands } };
    const act = decideTurn("expander", withExpands, miniGeo, "a", known, rng);
    assert.ok(act.type === "expand" || act.type === "colonize" || act.type === "endTurn", `got ${act.type}`);
  }
});

test("cityBuilder with 3 influence and a known capital builds a city with the right answer", () => {
  const s = stateWith({ geo: miniGeo, players: [{ id: "a", influence: 3, owned: ["A1", "A2"] }, { id: "b", influence: 0, owned: ["B1"] }] }, 1);
  const act = decideTurn("cityBuilder", s, miniGeo, "a", new Set(["A1"]), rng);
  assert.equal(act.type, "city");
  assert.ok(act.type === "city" && act.code === "A1" && act.capital === "cap-a1");
});

test("cityBuilder with no known capital does not build a city", () => {
  const s = stateWith({ geo: miniGeo, players: [{ id: "a", influence: 3, owned: ["A1", "A2"] }, { id: "b", influence: 0, owned: ["B1"] }] }, 1);
  const act = decideTurn("cityBuilder", s, miniGeo, "a", new Set(), rng);
  assert.notEqual(act.type, "city");
});

test("annexer with 5 influence annexes a known unprotected rival neighbour, not an unknown one", () => {
  const s = stateWith({
    geo: miniGeo,
    round: 1,
    indexInRound: 0,
    players: [{ id: "a", influence: 5, owned: ["A1"] }, { id: "b", influence: 0, owned: ["A2"] }],
  }, 1);
  const known = decideTurn("annexer", s, miniGeo, "a", new Set(["A2"]), rng);
  assert.equal(known.type, "annex");
  assert.ok(known.type === "annex" && known.code === "A2" && known.capital === "cap-a2");
  const unknown = decideTurn("annexer", s, miniGeo, "a", new Set(), rng);
  assert.notEqual(unknown.type, "annex");
});

test("annexer does not annex on a second-of-two turn", () => {
  const s = buildPlayState({
    geo: miniGeo,
    round: 2,
    indexInRound: 0,
    players: [{ id: "a", influence: 0, owned: ["A2"] }, { id: "b", influence: 5, owned: ["A1"] }],
  });
  const second = { ...s, turn: { ...s.turn!, expands: 1 } };
  assert.equal(second.turn!.isSecondOfTwo, true);
  assert.equal(second.turn!.playerId, "b");
  const act = decideTurn("annexer", second, miniGeo, "b", new Set(["A2"]), rng);
  assert.notEqual(act.type, "annex");
});

test("colonizer with land on one continent colonizes a country on another continent", () => {
  const s = stateWith({
    geo: miniGeo,
    players: [{ id: "a", influence: 4, owned: ["A1", "A2"] }, { id: "b", influence: 0, owned: ["B1"] }],
  }, 1);
  const act = decideTurn("colonizer", s, miniGeo, "a", new Set(), rng);
  assert.equal(act.type, "colonize");
  assert.ok(act.type === "colonize" && miniGeo.continentOf(act.code) !== "Alpha");
});

test("mixed plays expander in round 2, cityBuilder in round 5, annexer in round 10", () => {
  const owned = { id: "a", influence: 3, owned: ["A1", "A2"] };
  const rival = { id: "b", influence: 0, owned: ["A3"] };
  const known = new Set(["A1", "A2", "A3"]);
  // Round 2 (even order is 2, 1): seat 0 acts at index 1 and is not a second turn.
  const r2 = stateWith({ geo: miniGeo, round: 2, indexInRound: 1, players: [owned, rival] }, 1);
  assert.notEqual(decideTurn("mixed", r2, miniGeo, "a", known, rng).type, "city");
  // Round 5 (odd order): seat 0 acts at index 0. A city is allowed on a second turn.
  const r5 = stateWith({ geo: miniGeo, round: 5, indexInRound: 0, players: [owned, rival] }, 1);
  assert.equal(decideTurn("mixed", r5, miniGeo, "a", known, rng).type, "city");
  // Round 10 (even order): seat 0 acts at index 1. Five influence and a rival neighbour: annex.
  const r10 = stateWith({ geo: miniGeo, round: 10, indexInRound: 1, players: [{ ...owned, influence: 5 }, rival] }, 1);
  assert.equal(decideTurn("mixed", r10, miniGeo, "a", known, rng).type, "annex");
});

test("every pure strategy plays full mini games with every step valid and invariants holding", () => {
  const strategies: Strategy[] = ["expander", "cityBuilder", "colonizer", "annexer", "mixed"];
  for (const s of strategies) {
    for (let g = 0; g < 3; g++) {
      const trackers = newTrackers();
      const rec = playGame({
        geo: miniGeo,
        lineup: [s, s, s],
        seed: 500 + g,
        knowP: 0.6,
        slowP: g === 2 ? 0.1 : 0,
        onStep: (before, after) => assertInvariants(before, after, miniGeo, trackers),
      });
      assert.ok(rec.rounds >= 1 && rec.winners.length >= 1, `${s} game ${g} did not finish`);
    }
  }
});

// ---------- 2. Capital knowledge ----------

test("known capitals are deterministic, bounded by p, and differ by seat and seed", () => {
  const a = makeKnownCapitals(7, 0, empire2Geo, 0.6);
  const b = makeKnownCapitals(7, 0, empire2Geo, 0.6);
  assert.deepEqual([...a].sort(), [...b].sort());
  assert.equal(makeKnownCapitals(7, 0, miniGeo, 0).size, 0);
  assert.equal(makeKnownCapitals(7, 0, miniGeo, 1).size, miniGeo.codes().length);
  assert.equal(makeKnownCapitals(7, 0, empire2Geo, 1).size, empire2Geo.codes().length);
  const size = makeKnownCapitals(7, 0, empire2Geo, 0.6).size;
  const total = empire2Geo.codes().length;
  assert.ok(size >= 0.5 * total && size <= 0.7 * total, `size ${size} of ${total}`);
  const pairs: [number, number, number, number][] = [[7, 0, 7, 1], [1, 0, 2, 0], [1, 1, 1, 2], [3, 0, 4, 0], [5, 2, 5, 3]];
  const differs = pairs.some(([s1, k1, s2, k2]) => {
    const x = [...makeKnownCapitals(s1, k1, miniGeo, 0.5)].sort().join();
    const y = [...makeKnownCapitals(s2, k2, miniGeo, 0.5)].sort().join();
    return x !== y;
  });
  assert.ok(differs, "no pair of seeds or seats gave different known sets");
});

test("streamSeed is deterministic and separates streams", () => {
  assert.equal(streamSeed(1, 1), streamSeed(1, 1));
  assert.notEqual(streamSeed(1, 1), streamSeed(1, 2));
  assert.ok(Number.isInteger(streamSeed(99, 7)) && streamSeed(99, 7) >= 0);
});

// ---------- 3. Field and rotation ----------

function configNamed(id: string): ConfigSpec {
  const c = CONFIGS.find((x) => x.id === id);
  if (!c) throw new Error(`no config ${id}`);
  return c;
}

for (const id of ["real-3p-pure", "real-4p-pure"]) {
  test(`pure field rotates each lineup through every seat once per block (${id})`, () => {
    const n = configNamed(id).n;
    const lineups = Array.from({ length: 12 }, (_, i) => lineupFor(i, n, "pure"));
    for (const lu of lineups) assert.equal(new Set(lu).size, n, "lineup has repeated strategies");
    for (let b = 0; b * n < 12; b++) {
      for (let seat = 0; seat < n; seat++) {
        const seen = new Set(lineups.slice(b * n, b * n + n).map((lu) => lu[seat]));
        assert.equal(seen.size, n, `block ${b} seat ${seat} does not hold every strategy once`);
      }
    }
    const again = Array.from({ length: 12 }, (_, i) => lineupFor(i, n, "pure"));
    assert.deepEqual(again, lineups);
  });
}

test("mixed field gives every seat the mixed strategy", () => {
  assert.deepEqual(lineupFor(5, 3, "mixed"), ["mixed", "mixed", "mixed"]);
});

// ---------- 4. Determinism ----------

test("runConfig is deterministic for the same seeds and differs for another seed base", () => {
  const spec = { ...configNamed("mini-3p-pure"), games: 6 };
  const quiet = () => undefined;
  const a = runConfig(spec, { seedBase: 0, log: quiet });
  const b = runConfig(spec, { seedBase: 0, log: quiet });
  assert.deepStrictEqual(a, b);
  const c = runConfig(spec, { seedBase: 1000, log: quiet });
  assert.notDeepStrictEqual(a, c);
});

// ---------- 5. Rules file validation ----------

test("rules file accepts tunable values and names the key when it rejects one", () => {
  assert.equal(parseRulesOverrides({}).ok, true);
  const good = parseRulesOverrides({ winPoints: 12, cityCost: 4 });
  assert.ok(good.ok && good.overrides.winPoints === 12);
  const unknown = parseRulesOverrides({ fooBar: 1 });
  assert.ok(!unknown.ok && unknown.errors.some((e) => e.includes("fooBar")));
  const pinned = parseRulesOverrides({ maxExpandsPerTurn: 2 });
  assert.ok(!pinned.ok && pinned.errors.some((e) => e.includes("maxExpandsPerTurn")));
  const fraction = parseRulesOverrides({ winPoints: 10.5 });
  assert.ok(!fraction.ok && fraction.errors.some((e) => e.includes("winPoints")));
  const range = parseRulesOverrides({ winPoints: 17 });
  assert.ok(!range.ok && range.errors.some((e) => e.includes("winPoints")));
  const boom = parseRulesOverrides({ boomIncome: 2, boomCityIncome: 1 });
  assert.ok(!boom.ok && boom.errors.some((e) => e.includes("boomCityIncome")));
});

// ---------- 6. Metric fixtures (hand-written records, n = 3) ----------

function st(o: { turns?: number; three?: number; second?: number; nf?: number; nfc?: number; annex?: number; spent?: number[] }): SeatStats {
  const s = emptyStats();
  s.turns = o.turns ?? 0;
  s.threeExpandTurns = o.three ?? 0;
  s.secondTurns = o.second ?? 0;
  s.noFrontierTurns = o.nf ?? 0;
  s.noFrontierColonized = o.nfc ?? 0;
  s.count.annex = o.annex ?? 0;
  const sp = o.spent ?? [0, 0, 0, 0];
  s.spent = { expand: sp[0], colonize: sp[1], city: sp[2], annex: sp[3] };
  return s;
}

type Vp = { territory: number; cities: number; regionSets: number; largestEmpire: number; explorer: number };
const NO_VP: Vp = { territory: 0, cities: 0, regionSets: 0, largestEmpire: 0, explorer: 0 };

function makeRecord(f: {
  seed: number; lineup: Strategy[]; winners: number[]; reason?: "points" | "cap"; rounds: number;
  startVp: number[][]; finalVp: number[]; stats?: SeatStats[]; vp?: Vp[]; waiting?: GameRecord["waiting"];
}): GameRecord {
  return {
    seed: f.seed,
    n: f.lineup.length,
    lineup: f.lineup,
    winners: f.winners,
    reason: f.reason ?? "points",
    rounds: f.rounds,
    startVp: f.startVp,
    finalVp: f.finalVp,
    seats: f.lineup.map((strategy, seat) => ({
      seat,
      strategy,
      finalVp: f.finalVp[seat],
      vp: f.vp?.[seat] ?? NO_VP,
      finalInfluence: 0,
      countries: 0,
      cityCount: 0,
      stats: f.stats?.[seat] ?? emptyStats(),
    })),
    perRound: [],
    bountiesClaimed: {},
    waiting: f.waiting ?? [],
  };
}

const A = makeRecord({
  seed: 10, lineup: ["expander", "cityBuilder", "annexer"], winners: [1], rounds: 7,
  startVp: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [2, 1, 1], [2, 2, 1], [3, 4, 2], [4, 6, 3]], finalVp: [5, 10, 4],
  stats: [
    st({ turns: 7, three: 3, second: 3, nf: 1, nfc: 1, spent: [14, 4, 0, 0] }),
    st({ turns: 7, three: 1, annex: 1, spent: [8, 0, 9, 5] }),
    st({ turns: 7, second: 3, nf: 2, nfc: 1, annex: 1, spent: [5, 2, 0, 5] }),
  ],
  vp: [NO_VP, { territory: 3, cities: 3, regionSets: 2, largestEmpire: 2, explorer: 0 }, NO_VP],
  waiting: [{ seat: 1, outcome: "won" }],
});
const B = makeRecord({
  seed: 11, lineup: ["colonizer", "annexer", "expander"], winners: [2], rounds: 6,
  startVp: [[0, 0, 0], [0, 1, 0], [1, 1, 1], [1, 2, 1], [2, 3, 1], [4, 5, 2]], finalVp: [6, 7, 10],
  stats: [
    st({ turns: 6, three: 2, second: 2, spent: [9, 8, 0, 0] }),
    st({ turns: 6, three: 1, nf: 1, nfc: 1, annex: 2, spent: [6, 0, 3, 10] }),
    st({ turns: 6, three: 3, second: 3, spent: [15, 0, 0, 0] }),
  ],
  vp: [NO_VP, NO_VP, { territory: 4, cities: 0, regionSets: 2, largestEmpire: 2, explorer: 2 }],
  waiting: [{ seat: 0, outcome: "dropped" }, { seat: 1, outcome: "preempted" }],
});
const C = makeRecord({
  seed: 12, lineup: ["annexer", "colonizer", "cityBuilder"], winners: [0, 1], reason: "cap", rounds: 8,
  startVp: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [2, 1, 0], [2, 2, 1], [3, 2, 1], [3, 3, 2], [4, 4, 2]], finalVp: [5, 5, 3],
});
const D = makeRecord({
  seed: 13, lineup: ["expander", "annexer", "colonizer"], winners: [2], rounds: 5,
  startVp: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [2, 1, 1], [3, 2, 2]], finalVp: [4, 3, 10],
});
const ALL_FOUR = [A, B, C, D];
const FIXTURE: ConfigSpec = {
  id: "fixture", map: "mini", n: 3, field: "pure", games: 4, role: "GATE",
  checks: ["C1", "C2", "C3", "C4", "C5"], reportOnly: [], knowP: 0.6, slowP: 0,
};
const META = { seedBase: 10, overrides: {}, startedAt: "2026-01-01T00:00:00.000Z", wallSeconds: 1, node: "v22", commit: "abc" };
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test("fixture: C1 to C5 values", () => {
  near(lengthStats(ALL_FOUR, 3).mean, 6.5);
  const rows = strategyRows(ALL_FOUR);
  const rate = (s: string) => rows.find((r) => r.strategy === s)!.winRate;
  near(rate("expander"), 1 / 3);
  near(rate("cityBuilder"), 1 / 2);
  near(rate("colonizer"), 0.5);
  near(rate("annexer"), 0.125);
  assert.equal(topStrategy(rows)!.strategy, "cityBuilder");
  const w = worstSeat(ALL_FOUR, 3);
  near(w.devPts, 100 * (1 / 3 - 0.125));
  assert.equal(w.seat, 0);
  const lp = lastPlaceAt(ALL_FOUR, 6);
  near(lp.value, 1 / 3);
  assert.equal(lp.games, 3);
  const lc = leaderChanges(ALL_FOUR);
  assert.equal(lc.changes, 2);
  assert.equal(lc.games, 4);
  assert.deepEqual(lc.failingSeeds, [12, 13]);
});

test("fixture: turn diagnostics, point sources, influence and annexes", () => {
  const t = turnDiagnostics(ALL_FOUR);
  near(t.threeExpandRate, 10 / 39);
  near(t.noFrontierRate, 4 / 39);
  near(t.unstuckRate, 3 / 4);
  assert.equal(t.secondTurns, 11);
  assert.equal(t.reachedTarget, 3);
  near(t.reachedTarget / t.secondTurns, 3 / 11);
  near(t.waitingOutcomes.won / 3, 1 / 3);
  near(t.waitingOutcomes.dropped / 3, 1 / 3);
  near(t.waitingOutcomes.preempted / 3, 1 / 3);
  near(t.waitingPerGame, 3 / 4);
  near(t.capShare, 0.25);

  const ps = pointSources([A, B]);
  near(ps.winners.territory, 0.35);
  near(ps.winners.cities, 0.15);
  near(ps.winners.regionSets, 0.2);
  near(ps.winners.largestEmpire, 0.2);
  near(ps.winners.explorer, 0.1);

  const annex = annexStats(ALL_FOUR);
  near(annex.mean, 1);
  assert.deepEqual(annex.dist, [2, 0, 2, 0]);

  const seats = [A, B, C, D].flatMap((g) => g.seats);
  const total = (k: "expand" | "colonize" | "city" | "annex") => seats.reduce((a, s) => a + s.stats.spent[k], 0);
  assert.deepEqual([total("expand"), total("colonize"), total("city"), total("annex")], [57, 14, 12, 20]);
  const annexer = strategyRows(ALL_FOUR).find((r) => r.strategy === "annexer")!;
  assert.equal(annexer.appearances, 4);
  near(annexer.influence.spent.expand, 2.75);
  near(annexer.influence.spent.colonize, 0.5);
  near(annexer.influence.spent.city, 0.75);
  near(annexer.influence.spent.annex, 3.75);
});

test("fixture: the report formatter prints the exact CHECKS block and the gate line", () => {
  const data = computeReport(ALL_FOUR, FIXTURE, rules, META);
  const text = formatReport(data);
  const lines = text.split("\n");
  const start = lines.indexOf("CHECKS");
  const expected = [
    "ID  Check                             Value       Threshold         Result Note",
    "-".repeat(90),
    "C1  Average game length (rounds)      6.50        12.00 to 16.00    FAIL",
    "C2  Top strategy win rate             50.0%       <= 40.0%          FAIL   cityBuilder",
    "C3  Worst seat deviation              20.8 pts    <= 5.0 pts        FAIL   seat 1",
    "C4  Last place at round 6 wins        33.3%       >= 15.0%          PASS   3 games",
    "C5  Leader change after round 5       50.0%       >= 95.0%          FAIL   2 of 4 games",
    "GATE: FAIL (C1 C2 C3 C5)",
  ];
  assert.deepEqual(lines.slice(start + 1, start + 1 + expected.length), expected);
  assert.equal(text.endsWith("\n"), true);
  assert.equal(lines.some((l) => l !== l.trimEnd()), false, "trailing spaces");
  const titles = ["CHECKS", "STRATEGIES", "SEATS", "GAME LENGTH", "POINT SOURCES", "INFLUENCE", "TURN DIAGNOSTICS", "ANNEXES AND COMEBACKS", "EVENTS AND BOUNTIES", "FLAGS"];
  const positions = titles.map((t) => lines.indexOf(t));
  assert.ok(positions.every((p) => p >= 0), `missing a section: ${positions}`);
  assert.deepEqual([...positions].sort((x, y) => x - y), positions);
  assert.equal(lines.includes("C5 games without a leader change: 2; seeds (up to 20): 12, 13"), true);
});

test("fixture: the report is total on empty input and JSON round-trips", () => {
  const empty = formatReport(computeReport([], FIXTURE, rules, META));
  assert.ok(empty.includes("no games"));
  const data = computeReport(ALL_FOUR, FIXTURE, rules, META);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(data)), data);
});

test("winner turn position in the final round follows the snake order", () => {
  const rec = (n: number, rounds: number, winners: number[]): GameRecord =>
    makeRecord({
      seed: 1, lineup: Array.from({ length: n }, () => "expander" as Strategy), winners, rounds,
      startVp: [], finalVp: Array.from({ length: n }, () => 0),
    });
  const W1 = rec(3, 7, [1]);   // odd round: order 0,1,2 -> position index 1
  const W2 = rec(3, 6, [2]);   // even round: order 2,1,0 -> position index 0
  const W3 = rec(3, 6, [1]);   // even round: order 2,1,0 -> position index 1
  const W4 = rec(2, 5, [1]);   // odd round: order 0,1 -> position index 1
  const all = winnerPositions([W1, W2, W3, W4]);
  assert.deepEqual(all.byPosition, [1, 3, 0]);
  assert.equal(all.games, 4);
  assert.deepEqual(winnerPositions([W1]).byPosition, [0, 1, 0]);
  assert.deepEqual(winnerPositions([W2]).byPosition, [1, 0, 0]);
  assert.deepEqual(winnerPositions([W3]).byPosition, [0, 1, 0]);
  assert.deepEqual(winnerPositions([W4]).byPosition, [0, 1]);
});

// ---------- 7. Real-map and engine-observer tests (at most 10 real games each) ----------

test("real map: a two-player game is recorded consistently", () => {
  const lineup: Strategy[] = ["expander", "cityBuilder"];
  const rec = playGame({ geo: empire2Geo, lineup, seed: 3, knowP: 0.6, slowP: 0 });
  assert.deepEqual(rec.seats.map((s) => s.seat), [0, 1]);
  rec.seats.forEach((s, k) => assert.equal(s.strategy, lineup[k]));
  assert.ok(rec.reason === "points" || rec.reason === "cap", `reason ${rec.reason}`);
  if (rec.reason === "points") {
    for (const w of rec.winners) assert.ok(rec.finalVp[w] >= rules.winPoints, `winner ${w} has ${rec.finalVp[w]} VP`);
  }
});

test("seat attribution: record seat k is the k-th player and plays lineup[k]", () => {
  const lineup: Strategy[] = ["expander", "cityBuilder", "colonizer"];
  for (let seed = 0; seed < 5; seed++) {
    let firstTurn: { seat: number; playerId: string } | null = null;
    const rec = playGame({
      geo: empire2Geo, lineup, seed, knowP: 0.6, slowP: 0,
      onStep: (before, after) => {
        if (firstTurn === null && before.phase === "setup" && after.phase === "play" && after.turn !== null) {
          firstTurn = { seat: after.turn.seat, playerId: after.turn.playerId };
          after.players.forEach((p, k) => {
            assert.equal(p.seat, k, `seed ${seed}: player ${p.id} is not seat ${k}`);
            assert.equal(p.id, `p${k}`);
          });
        }
      },
    });
    assert.equal(rec.n, 3);
    rec.seats.forEach((s, k) => {
      assert.equal(s.seat, k, `seed ${seed}`);
      assert.equal(s.strategy, lineup[k], `seed ${seed} seat ${k}`);
      assert.equal(rec.finalVp.length, 3);
      assert.equal(s.finalVp, rec.finalVp[k], `seed ${seed} seat ${k} VP`);
    });
    // Round 1 is odd, so the order is ascending: seat 0 (player p0) acts first.
    assert.deepEqual(firstTurn, { seat: 0, playerId: "p0" }, `seed ${seed}`);
  }
});

test("waiting events equal second-of-two turns that ended at or above the win target", () => {
  const target = rules.winPoints;
  for (let g = 0; g < 3; g++) {
    let gained = 0;
    const rec = playGame({
      geo: miniGeo, lineup: ["expander", "cityBuilder", "annexer"], seed: 700 + g, knowP: 0.6, slowP: 0,
      onStep: (before, after) => {
        const t = before.turn;
        if (t === null || !t.isSecondOfTwo) return;
        if (!after.waitingWin.includes(t.playerId) || before.waitingWin.includes(t.playerId)) return;
        gained += 1;
        assert.ok(scorePlayer(before, t.playerId, miniGeo).total >= target, `game ${g}: waiting player below target`);
      },
    });
    assert.equal(gained, rec.waiting.length, `game ${g}`);
  }
});

test("no player wins on a second-of-two turn", () => {
  for (let g = 0; g < 10; g++) {
    const lineup: Strategy[] = g % 2 === 0 ? ["expander", "annexer"] : ["annexer", "expander"];
    playGame({
      geo: empire2Geo, lineup, seed: 1100 + g, knowP: 0.6, slowP: 0,
      onStep: (before, after) => {
        if (after.phase !== "finished" || after.result === null || before.turn === null) return;
        if (after.result.reason === "points") {
          assert.equal(before.turn.isSecondOfTwo, false, `game ${g}: points win on a second-of-two turn`);
        }
      },
    });
  }
});

test("real map timeout path: timed-out turns finish the game and are counted as skipped", () => {
  let skipped = 0;
  for (let g = 0; g < 3; g++) {
    const rec = playGame({
      geo: empire2Geo, lineup: ["expander", "cityBuilder", "annexer"], seed: 800 + g, knowP: 0.6, slowP: 0.1,
    });
    assert.ok(rec.rounds >= 1 && rec.winners.length >= 1, `game ${g} did not finish`);
    skipped += rec.seats.reduce((a, s) => a + s.stats.skippedTurns, 0);
  }
  assert.ok(skipped > 0, "no skipped turns");
});

test("documented rule: with two players every win is at turn position 1", () => {
  // Documents the current back-to-back rule (finding R1): a second-of-two turn cannot win, so with two
  // players the final-round winner is the seat that acts second. This test is expected to change if the rule changes.
  const records: GameRecord[] = [];
  for (let g = 0; g < 10; g++) {
    records.push(playGame({ geo: empire2Geo, lineup: ["mixed", "mixed"], seed: 900 + g, knowP: 0.6, slowP: 0 }));
  }
  assert.equal(winnerPositions(records).byPosition[0], 0);
});
