import assert from "node:assert/strict";
import { test } from "node:test";
import { allCountryFacts, continentCounts } from "@/lib/countries";

test("continent counts add up to every game country when nothing is claimed", () => {
  const counts = continentCounts({});
  assert.deepEqual(counts.map((c) => c.name), ["Africa", "Asia", "Europe", "North America", "South America", "Oceania"]);
  assert.equal(counts.reduce((sum, c) => sum + c.total, 0), allCountryFacts().length);
  for (const c of counts) assert.equal(c.left, c.total);
  assert.equal(counts.find((c) => c.name === "South America")!.total, 12);
});

test("claiming a country lowers only its continent", () => {
  const before = continentCounts({});
  const after = continentCounts({ FR: "a", BR: "b", MX: "a" });
  const left = (list: typeof before, name: string) => list.find((c) => c.name === name)!.left;
  assert.equal(left(after, "Europe"), left(before, "Europe") - 1);
  assert.equal(left(after, "South America"), left(before, "South America") - 1);
  assert.equal(left(after, "North America"), left(before, "North America") - 1);
  assert.equal(left(after, "Africa"), left(before, "Africa"));
});

test("a continent reaches zero once all its countries are claimed, ignoring unknown codes", () => {
  const claims: Record<string, string> = { ZZ: "a" };
  for (const facts of allCountryFacts()) if (facts.region === "Oceania") claims[facts.code] = "a";
  const oceania = continentCounts(claims).find((c) => c.name === "Oceania")!;
  assert.equal(oceania.left, 0);
  assert.ok(oceania.total > 10);
  assert.ok(continentCounts(claims).filter((c) => c.left === 0).length === 1);
});
