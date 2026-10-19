import assert from "node:assert/strict";
import test from "node:test";
import { allCountryFacts } from "@/lib/countries";
import { geo } from "@/lib/empire/geo";
import { EMPIRE_RULES, type Rng } from "@/lib/empire/types";

const codes = allCountryFacts().map((f) => f.code);

/** Small deterministic PRNG (mulberry32) for repeatable tests. */
function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("neighbour links are symmetric, unique and never self-links", () => {
  for (const code of codes) {
    const list = geo.neighbours(code);
    assert.equal(new Set(list).size, list.length, `${code} has duplicate neighbours`);
    assert.ok(!list.includes(code), `${code} lists itself`);
    for (const other of list) {
      assert.ok(geo.neighbours(other).includes(code), `${code} -> ${other} is not mirrored`);
    }
  }
});

test("every game country has at least one neighbour", () => {
  for (const code of codes) {
    assert.ok(geo.neighbours(code).length >= 1, `${code} has no neighbours`);
  }
});

test("island countries get sea routes", () => {
  const japan = geo.neighbours("JP");
  assert.ok(japan.length > 0, "Japan has no neighbours");
  assert.ok(geo.seaRoutes().some(([a, b]) => a === "JP" || b === "JP"), "Japan appears in no sea route");
});

test("France borders Spain", () => {
  assert.ok(geo.neighbours("FR").includes("ES"));
  assert.ok(geo.neighbours("ES").includes("FR"));
});

test("seaRoutes() pairs are unique, ordered a < b, and sorted", () => {
  const routes = geo.seaRoutes();
  const keys = routes.map(([a, b]) => `${a}|${b}`);
  assert.equal(new Set(keys).size, keys.length, "duplicate sea route pair");
  for (const [a, b] of routes) {
    assert.ok(a < b, `${a}|${b} is not ordered`);
    assert.ok(geo.neighbours(a).includes(b), `${a}|${b} missing from neighbours`);
  }
  const sorted = [...routes].sort((x, y) => (x[0] === y[0] ? (x[1] < y[1] ? -1 : 1) : x[0] < y[0] ? -1 : 1));
  assert.deepEqual(routes, sorted);
});

test("regions and continents resolve", () => {
  assert.equal(geo.continentOf("FR"), "Europe");
  assert.equal(geo.regionOf("FR"), "Western Europe");
  assert.ok(geo.regionMembers(geo.regionOf("FR")).includes("FR"));
  const names = geo.regionNames();
  assert.deepEqual(names, [...names].sort());
  assert.equal(new Set(names).size, names.length);
});

test("capitals come from world-countries, including multiple capitals", () => {
  assert.deepEqual(geo.capitalsOf("FR"), ["Paris"]);
  assert.equal(geo.capitalsOf("ZA").length, 3);
});

test("isCapitalOf accepts exact and one-typo answers only", () => {
  assert.equal(geo.isCapitalOf("AU", "Canberra"), true);
  assert.equal(geo.isCapitalOf("AU", "canbera"), true, "one deletion in a 5+ letter capital");
  assert.equal(geo.isCapitalOf("FR", "lyon"), false);
  assert.equal(geo.isCapitalOf("FR", ""), false);
  assert.equal(geo.isCapitalOf("AU", "   "), false);
});

test("startingCapitals returns distinct eligible continents, deterministically", () => {
  const picks = geo.startingCapitals(4, mulberry32(42));
  assert.equal(picks.length, 4);
  const continents = picks.map((code) => geo.continentOf(code));
  assert.equal(new Set(continents).size, 4, "two players share a continent");
  for (const code of picks) {
    assert.ok(geo.neighbours(code).length >= EMPIRE_RULES.capitalMinNeighbours, `${code} has too few neighbours`);
  }
  assert.deepEqual(geo.startingCapitals(4, mulberry32(42)), picks, "same seed gave a different result");
});

test("startingCapitals throws for 0 or too many players", () => {
  assert.throws(() => geo.startingCapitals(0, mulberry32(1)), RangeError);
  assert.throws(() => geo.startingCapitals(9, mulberry32(1)), RangeError);
});
