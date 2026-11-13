import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorldMap } from "@/app/world-map";
import { allCountryFacts, countryCodeFromNumericId } from "@/lib/countries";
import { featureCode, mapDots, mapFeatures, mapPath, MAP_HEIGHT, MAP_WIDTH, MIN_VISIBLE_AREA } from "@/lib/world-geometry";

const dotCodes = new Set(mapDots.map((dot) => dot.code));

test("every game country is visible on the map as a shape or a dot", () => {
  const area = new Map<string, number>();
  for (const country of mapFeatures.features) {
    const code = countryCodeFromNumericId(country.id);
    if (code) area.set(code, (area.get(code) ?? 0) + mapPath.area(country));
  }
  for (const { code, name } of allCountryFacts()) {
    assert.ok((area.get(code) ?? 0) >= MIN_VISIBLE_AREA || dotCodes.has(code), `${name} is not visible`);
  }
});

test("small and missing countries get one dot each, inside the map", () => {
  for (const code of ["MC", "VA", "TV", "XK", "SG", "MT", "NR", "LI", "GD"]) assert.ok(dotCodes.has(code), code);
  for (const code of ["FR", "BR", "RU", "US"]) assert.equal(dotCodes.has(code), false, code);
  assert.equal(dotCodes.size, mapDots.length, "no duplicate dots");
  for (const dot of mapDots) {
    assert.ok(dot.x >= 0 && dot.x <= MAP_WIDTH && dot.y >= 0 && dot.y <= MAP_HEIGHT, `${dot.code} is off the map`);
  }
});

test("a claimed small country's dot takes its owner's colour", () => {
  const players = [{ id: "a", name: "Ana" }, { id: "b", name: "Ben" }];
  const html = renderToStaticMarkup(React.createElement(WorldMap, { claims: { MC: "a" }, players, youId: "b" }));
  const monaco = html.match(/<circle[^>]*data-code="MC"[^>]*>/)?.[0] ?? "";
  assert.match(monaco, /map-dot claimed/);
  assert.match(monaco, /fill:#d4553a/i);
  assert.match(html, /Claimed by Ana/);
  const vatican = html.match(/<circle[^>]*data-code="VA"[^>]*>/)?.[0] ?? "";
  assert.ok(vatican && !vatican.includes("claimed"), "unclaimed dots stay neutral");
});

test("Somaliland is fused into Somalia, so it is one shape that colours as Somalia", () => {
  assert.equal(mapFeatures.features.some((f) => f.properties?.name === "Somaliland"), false, "no separate Somaliland shape");
  const somalia = mapFeatures.features.filter((f) => featureCode(f) === "SO");
  assert.equal(somalia.length, 1);
  const html = renderToStaticMarkup(React.createElement(WorldMap, { claims: { SO: "a" }, players: [{ id: "a", name: "Ana" }], youId: "a" }));
  assert.equal((html.match(/Claimed by Ana/g) ?? []).length >= 1, true);
  assert.equal(html.includes("Somaliland"), false);
});

test("land outside the game list is hatched, labelled and never claimable", () => {
  const players = [{ id: "a", name: "Ana" }];
  const html = renderToStaticMarkup(React.createElement(WorldMap, { claims: {}, players, youId: "a" }));
  const hatched = [...html.matchAll(/class="map-country not-in-game"[^>]*><title>([^<]*)<\/title>/g)].map((m) => m[1]).sort();
  assert.deepEqual(hatched, ["Antarctica: not in the game", "Falkland Is.: not in the game", "Fr. S. Antarctic Lands: not in the game", "Greenland: not in the game", "N. Cyprus: not in the game", "New Caledonia: not in the game", "Puerto Rico: not in the game", "W. Sahara: not in the game"]);
  assert.match(html, /<pattern id="not-in-game"/);
  const kosovo = mapFeatures.features.find((f) => f.properties?.name === "Kosovo")!;
  assert.equal(featureCode(kosovo), "XK", "Kosovo is a game country, not hatched");
});

test("a starting country gets a home marker in its player's colour", () => {
  const players = [{ id: "a", name: "Ana" }, { id: "b", name: "Ben" }];
  const html = renderToStaticMarkup(React.createElement(WorldMap, { claims: {}, players, youId: "b", homes: { a: "FR", b: "MC" } }));
  assert.equal((html.match(/class="map-home"/g) ?? []).length, 2);
  assert.match(html, /Ana started here/);
  assert.match(html, /Ben \(you\) started here/);
});
