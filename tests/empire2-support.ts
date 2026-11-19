// Shared helpers for the Empire 2.0 tests. Not a test file: the npm test glob (tests/*.test.ts) skips it.
import assert from "node:assert/strict";
import type { CountryTraits, Empire2Geo } from "@/lib/empire2/geo-adapter";
import { resolveRules } from "@/lib/empire2/rules";
import { computeTitles } from "@/lib/empire2/titles";
import { scorePlayer } from "@/lib/empire2/victory";
import { continentsOwned, frontier, largestGroupSize, ownedBy, ownerOf } from "@/lib/empire2/state";
import { isSecondOfTwo, roundOrder } from "@/lib/empire2/order";
import type {
  ActionResult, BountyCard, Ctx, EmpireState, EventKind, PlayerId, Rng, Rules, Titles,
} from "@/lib/empire2/types";
import type { EngineErrorCode } from "@/lib/empire2/types";

/** Small deterministic PRNG (mulberry32), same as tests/empire-geo.test.ts. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Returns the given values in order; throws when asked for more. */
export function scriptedRng(values: number[]): Rng & { consumed(): number; remaining(): number } {
  let i = 0;
  const fn = (() => {
    if (i >= values.length) throw new Error("rng exhausted");
    const v = values[i];
    i += 1;
    return v;
  }) as Rng & { consumed(): number; remaining(): number };
  fn.consumed = () => i;
  fn.remaining = () => values.length - i;
  return fn;
}

/** Recursively freezes arrays and plain objects, so any mutation throws in strict mode. */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

type GeoSpec = {
  continents: Record<string, string[]>;
  regions: Record<string, string[]>;
  edges: [string, string][];
  traits?: Record<string, Partial<CountryTraits>>;
};

/** A tiny map with the same interface as the real adapter. */
export function makeGeo(spec: GeoSpec): Empire2Geo {
  const codes = [...new Set(Object.values(spec.continents).flat())].sort();
  const known = new Set(codes);
  const adj = new Map<string, Set<string>>();
  for (const c of codes) adj.set(c, new Set());
  for (const [a, b] of spec.edges) {
    adj.get(a)?.add(b);
    adj.get(b)?.add(a);
  }
  const regionOfMap = new Map<string, string>();
  for (const [region, members] of Object.entries(spec.regions)) {
    for (const m of members) regionOfMap.set(m, region);
  }
  const continentOfMap = new Map<string, string>();
  for (const [continent, members] of Object.entries(spec.continents)) {
    for (const m of members) continentOfMap.set(m, continent);
  }
  const regionNames = Object.keys(spec.regions).sort();
  const continentNames = Object.keys(spec.continents).filter((k) => spec.continents[k].length > 0).sort();
  const cap = (code: string) => `cap-${code.toLowerCase()}`;

  return {
    codes: () => [...codes],
    neighbours: (code) => (adj.get(code) ? [...(adj.get(code) as Set<string>)].sort() : []),
    regionOf: (code) => regionOfMap.get(code) ?? "",
    regionMembers: (region) => [...(spec.regions[region] ?? [])].sort(),
    regionNames: () => [...regionNames],
    continentOf: (code) => continentOfMap.get(code) ?? "",
    continentNames: () => [...continentNames],
    capitalsOf: (code) => (known.has(code) ? [cap(code)] : []),
    isCapitalOf: (code, answer) => known.has(code) && answer.trim().toLowerCase() === cap(code),
    traits: (code) => {
      if (!known.has(code)) return null;
      return {
        initial: code[0],
        letters: 2,
        landlocked: false,
        island: false,
        ...(spec.traits?.[code] ?? {}),
      };
    },
  };
}

function clique(members: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) out.push([members[i], members[j]]);
  }
  return out;
}

const ALPHA = ["A1", "A2", "A3", "A4", "A5", "A6"];
const BETA = ["B1", "B2", "B3", "B4", "B5", "B6"];
const GAMMA = ["G1", "G2", "G3", "G4", "G5", "G6"];

/** 18 countries in three 6-cliques (continents Alpha, Beta, Gamma), no links between continents. */
export const miniGeo: Empire2Geo = makeGeo({
  continents: { Alpha: ALPHA, Beta: BETA, Gamma: GAMMA },
  regions: {
    "Alpha West": ["A1", "A2", "A3"],
    "Alpha East": ["A4", "A5", "A6"],
    "Beta West": ["B1", "B2", "B3"],
    "Beta East": ["B4", "B5", "B6"],
    "Gamma West": ["G1", "G2", "G3"],
    "Gamma East": ["G4", "G5", "G6"],
  },
  edges: [...clique(ALPHA), ...clique(BETA), ...clique(GAMMA)],
});

export type PlaySpec = {
  geo: Empire2Geo;
  players: {
    id: string;
    influence?: number;
    owned?: string[];
    cities?: string[];
    capital?: string;
    foothold?: string;
  }[];
  round?: number;
  indexInRound?: number;
  now?: number;
  turnMs?: number;
  booms?: string[];
  bounties?: BountyCard[];
  event?: EventKind | null;
  roundStartVp?: Record<string, number>;
  titles?: Titles;
  waitingWin?: string[];
  rules?: Partial<Rules>;
};

/** Builds a valid play-phase state directly, without running setup. */
export function buildPlayState(spec: PlaySpec): EmpireState {
  const rules = resolveRules(spec.rules);
  const n = spec.players.length;
  const round = spec.round ?? 1;
  const indexInRound = spec.indexInRound ?? 0;
  const seat = roundOrder(round, n)[indexInRound];
  const owners: Record<string, PlayerId> = {};
  const cities: string[] = [];
  spec.players.forEach((p) => {
    for (const code of [...(p.owned ?? []), ...(p.capital ? [p.capital] : []), ...(p.foothold ? [p.foothold] : [])]) {
      owners[code] = p.id;
    }
    for (const c of p.cities ?? []) {
      owners[c] = p.id;
      cities.push(c);
    }
  });
  const players = spec.players.map((p, i) => ({
    id: p.id,
    seat: i,
    influence: p.influence ?? 0,
    capital: p.capital ?? null,
    foothold: p.foothold ?? null,
  }));
  const roundStartVp: Record<string, number> = {};
  for (const p of spec.players) roundStartVp[p.id] = spec.roundStartVp?.[p.id] ?? 0;
  const base: EmpireState = {
    version: 1,
    phase: "play",
    rules,
    turnMs: spec.turnMs ?? 30000,
    players,
    owners,
    cities: cities.sort(),
    setup: null,
    round,
    turn: null,
    roundStartVp,
    booms: spec.booms ?? [],
    bounties: spec.bounties ?? [],
    event: spec.event ?? null,
    titles: spec.titles ?? { largestEmpire: null, explorer: null },
    waitingWin: spec.waitingWin ?? [],
    lastIncome: null,
    log: [],
    result: null,
  };
  const withTitlesFrom = spec.titles ? base : { ...base, titles: computeTitles(base, spec.geo) };
  const playerId = players[seat].id;
  const turn = {
    playerId,
    seat,
    indexInRound,
    isSecondOfTwo: isSecondOfTwo(round, indexInRound),
    startedAt: spec.now ?? 0,
    noFrontierAtStart: frontier(withTitlesFrom, playerId, spec.geo).length === 0,
    expands: 0,
    colonizes: 0,
    annexed: false,
    actions: [],
  };
  return { ...withTitlesFrom, turn };
}

const throwingRng: Rng = () => {
  throw new Error("unexpected rng draw");
};

export const ctxAt = (geo: Empire2Geo, now = 0, rng: Rng = throwingRng): Ctx => ({ geo, rng, now });

export function ok(r: ActionResult): EmpireState {
  assert.equal(r.ok, true, r.ok ? "" : `expected ok, got ${r.error.code}: ${r.error.message}`);
  if (!r.ok) throw new Error("unreachable");
  return r.state;
}

export function err(r: ActionResult): EngineErrorCode {
  assert.equal(r.ok, false, "expected a rejection");
  if (r.ok) throw new Error("unreachable");
  return r.error.code;
}

/** Shorthand for an owner lookup in tests. */
export const ownerName = (s: EmpireState, code: string): string | undefined => ownerOf(s, code);
export { type Rules };

// ---------- Invariant checker for the property tests (section 14.10) ----------

export type Trackers = {
  cityOwner: Map<string, string>;       // owner when each city was first seen
  protectedOwner: Map<string, string>;  // owner of each starting capital / foothold when first seen
};

export function newTrackers(): Trackers {
  return { cityOwner: new Map(), protectedOwner: new Map() };
}

/** Records the owners of starting capitals, footholds and cities the first time they are seen. */
function recordProtected(state: EmpireState, trackers: Trackers): void {
  for (const p of state.players) {
    for (const code of [p.capital, p.foothold]) {
      if (code !== null && !trackers.protectedOwner.has(code)) {
        const owner = ownerOf(state, code);
        if (owner !== undefined) trackers.protectedOwner.set(code, owner);
      }
    }
  }
  for (const c of state.cities) {
    if (!trackers.cityOwner.has(c)) {
      const owner = ownerOf(state, c);
      if (owner !== undefined) trackers.cityOwner.set(c, owner);
    }
  }
}

/**
 * Checks every invariant of section 14.10 after one successful action.
 * Call once per state (before and after) so trackers see every protected country.
 */
export function assertInvariants(before: EmpireState, after: EmpireState, geo: Empire2Geo, trackers: Trackers): void {
  const rules = after.rules;
  const ids = new Set(after.players.map((p) => p.id));

  // 1. one owner per country, owners are real players
  for (const [code, owner] of Object.entries(after.owners)) {
    assert.ok(ids.has(owner), `country ${code} has unknown owner ${owner}`);
  }
  const seen = new Set<string>();
  for (const p of after.players) {
    for (const c of ownedBy(after, p.id)) {
      assert.ok(!seen.has(c), `country ${c} is owned twice`);
      seen.add(c);
    }
  }

  // 2. integer influence >= 0
  for (const p of after.players) {
    assert.ok(Number.isInteger(p.influence) && p.influence >= 0, `bad influence ${p.influence} for ${p.id}`);
  }

  // 3. cities: unique, sorted, owned, owner never changes, cap per player
  assert.deepEqual(after.cities, [...new Set(after.cities)], "duplicate city");
  assert.deepEqual(after.cities, [...after.cities].sort(), "cities not sorted");
  recordProtected(after, trackers);
  for (const c of after.cities) {
    assert.ok(ownerOf(after, c) !== undefined, `city ${c} is not owned`);
    assert.equal(ownerOf(after, c), trackers.cityOwner.get(c), `city ${c} changed owner`);
  }
  for (const p of after.players) {
    const count = after.cities.filter((c) => after.owners[c] === p.id).length;
    assert.ok(count <= rules.maxCities, `${p.id} has ${count} cities`);
  }

  // 4. per turn: expands <= 3, annexed is a flag, no annex logged on a second turn
  if (after.phase === "play" && after.turn) {
    assert.ok(after.turn.expands <= rules.maxExpandsPerTurn, "too many expands");
    assert.equal(typeof after.turn.annexed, "boolean");
  }
  for (const entry of after.log.slice(before.log.length)) {
    if (entry.type === "annex") assert.notEqual(entry.second, true, "annex on a second turn was logged");
  }

  // 5. protected countries keep their original owner
  for (const [code, owner] of trackers.protectedOwner) {
    assert.equal(ownerOf(after, code), owner, `protected country ${code} changed hands`);
  }

  // 6. titles are the formula's result; holders meet their minimum
  const titles = computeTitles(after, geo);
  assert.deepEqual(after.titles, titles, "titles are stale");
  if (titles.largestEmpire !== null) {
    const set = new Set(ownedBy(after, titles.largestEmpire));
    assert.ok(largestGroupSize(set, geo) >= rules.largestEmpireMin, "largest empire holder below minimum");
  }
  if (titles.explorer !== null) {
    const set = new Set(ownedBy(after, titles.explorer));
    assert.ok(continentsOwned(set, geo) >= rules.explorerMinContinents, "explorer holder below minimum");
  }

  // 7. round-start snapshot: unchanged within a round, equal to scores when a round starts
  if (after.phase === "play" && before.phase === "play") {
    if (after.round === before.round) {
      assert.deepEqual(after.roundStartVp, before.roundStartVp, "snapshot changed within a round");
    } else {
      for (const p of after.players) {
        assert.equal(after.roundStartVp[p.id], scorePlayer(after, p.id, geo).total, "snapshot is not round-start score");
      }
    }
  }

  // 8/9. rounds only increase, within the cap; seats follow roundOrder
  assert.ok(after.round >= before.round, "round went backwards");
  if (after.phase === "play") {
    assert.ok(after.round >= 1 && after.round <= rules.roundCap, `round ${after.round} out of range`);
    assert.ok(after.turn !== null, "play without a turn");
    if (after.turn) {
      const expectedSeat = roundOrder(after.round, after.players.length)[after.turn.indexInRound];
      assert.equal(after.turn.seat, expectedSeat, "seat does not follow roundOrder");
      assert.equal(after.turn.playerId, after.players[expectedSeat].id, "turn player does not match seat");
    }
  }

  // 10. finish rules
  if (before.phase !== "finished" && after.phase === "finished") {
    assert.ok(after.result !== null, "finished without a result");
    if (after.result && after.result.reason === "points") {
      const winner = after.result.winners[0];
      assert.equal(after.result.winners.length, 1, "points win with several winners");
      assert.ok(scorePlayer(after, winner, geo).total >= rules.winPoints, "winner below winPoints");
      assert.ok(!(before.turn && before.turn.isSecondOfTwo), "won on a second turn");
    } else if (after.result) {
      assert.equal(after.round, rules.roundCap, "cap finish before the cap round");
    }
  }

  // 11. waiting players were at winPoints when added
  for (const id of after.waitingWin) {
    if (!before.waitingWin.includes(id)) {
      assert.ok(scorePlayer(after, id, geo).total >= rules.winPoints, `${id} waits below winPoints`);
    }
  }
}

