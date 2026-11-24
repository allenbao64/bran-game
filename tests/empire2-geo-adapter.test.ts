import assert from "node:assert/strict";
import test from "node:test";
import { empire2Geo, engineContinentOf } from "@/lib/empire2/geo-adapter";
import { regionSetPoints } from "@/lib/empire2/rules";

const codes = empire2Geo.codes();

test("geo-01 codes are the 197 uppercase game codes, sorted", () => {
  assert.equal(codes.length, 197);
  for (const c of codes) assert.match(c, /^[A-Z]{2}$/);
  assert.deepEqual(codes, [...codes].sort());
  for (const c of ["FR", "JP", "XK"]) assert.ok(codes.includes(c), `missing ${c}`);
});

test("geo-02 continents are the six engine continents", () => {
  assert.deepEqual(empire2Geo.continentNames(), ["Africa", "Asia", "Europe", "North America", "Oceania", "South America"]);
  assert.equal(empire2Geo.continentOf("BR"), "South America");
  for (const c of ["US", "MX", "CU"]) assert.equal(empire2Geo.continentOf(c), "North America");
  assert.equal(empire2Geo.continentOf("FR"), "Europe");
  assert.equal(empire2Geo.continentOf("AU"), "Oceania");
  assert.equal(engineContinentOf("br"), "South America");
});

test("geo-03 neighbours include sea routes and are symmetric", () => {
  assert.ok(empire2Geo.neighbours("JP").includes("KP"));
  assert.ok(empire2Geo.neighbours("JP").includes("KR"));
  for (let i = 0; i < codes.length; i += 10) {
    const c = codes[i];
    for (const n of empire2Geo.neighbours(c)) {
      assert.ok(empire2Geo.neighbours(n).includes(c), `${c}-${n} not mirrored`);
    }
  }
});

test("geo-04 regions partition the map", () => {
  const all: string[] = [];
  for (const r of empire2Geo.regionNames()) all.push(...empire2Geo.regionMembers(r));
  assert.deepEqual([...all].sort(), codes);
  assert.equal(new Set(all).size, all.length);
  assert.equal(empire2Geo.regionNames().length, 24);
  assert.deepEqual(empire2Geo.regionMembers("Australia and New Zealand"), ["AU", "NZ"]);
});

test("geo-05 capitals and tolerant matching", () => {
  assert.equal(empire2Geo.isCapitalOf("FR", "paris"), true);
  assert.equal(empire2Geo.isCapitalOf("FR", "lyon"), false);
  assert.equal(empire2Geo.isCapitalOf("ZA", "Cape Town"), true);
  assert.equal(empire2Geo.isCapitalOf("ZA", "Pretoria"), true);
});

test("geo-06 traits for bounties", () => {
  assert.equal(empire2Geo.traits("CH")?.landlocked, true);
  assert.equal(empire2Geo.traits("JP")?.island, true);
  assert.equal(empire2Geo.traits("FR")?.island, false);
  assert.equal(empire2Geo.traits("BR")?.initial, "B");
  assert.equal(empire2Geo.traits("XX"), null);
});

test("geo-07 regionSetPoints tiers", () => {
  for (const n of [2, 3, 5]) assert.equal(regionSetPoints(n), 2);
  for (const n of [6, 10]) assert.equal(regionSetPoints(n), 3);
  for (const n of [11, 17]) assert.equal(regionSetPoints(n), 4);
});
