import countries from "world-countries";
import { allCountryFacts, countryFacts, normalizeCountryName } from "@/lib/countries";
import { EMPIRE_RULES, type EmpireGeo, type Rng } from "@/lib/empire/types";

// ---------- Static data ----------
const worldByCode = new Map(countries.map((c) => [c.cca2, c]));
const gameCodes = allCountryFacts().map((f) => f.code).sort();
const gameSet = new Set(gameCodes);

const EARTH_RADIUS_KM = 6371;
/** Great-circle (haversine) distance between two [lat, lng] points, in km. */
function greatCircleKm(a: number[], b: number[]) {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ---------- Graph: land borders (symmetric) plus sea routes ----------
const adjacency = new Map<string, Set<string>>();
const seaPairs = new Map<string, [string, string]>();
for (const code of gameCodes) adjacency.set(code, new Set());

function link(a: string, b: string) {
  if (a === b) return;
  adjacency.get(a)?.add(b);
  adjacency.get(b)?.add(a);
}

const hasLandBorder = new Set<string>();
for (const fact of allCountryFacts()) {
  for (const other of fact.borders) {
    if (other === fact.code || !gameSet.has(other)) continue;
    hasLandBorder.add(fact.code);
    hasLandBorder.add(other);
    link(fact.code, other);
  }
}

for (const code of gameCodes) {
  if (hasLandBorder.has(code)) continue;
  const from = worldByCode.get(code)?.latlng ?? [0, 0];
  const nearest = gameCodes
    .filter((other) => other !== code)
    .map((other) => ({ other, km: greatCircleKm(from, worldByCode.get(other)?.latlng ?? [0, 0]) }))
    .sort((x, y) => x.km - y.km || (x.other < y.other ? -1 : 1))
    .slice(0, EMPIRE_RULES.seaRoutesPerIsland);
  for (const { other } of nearest) {
    link(code, other);
    const pair: [string, string] = code < other ? [code, other] : [other, code];
    seaPairs.set(pair.join("|"), pair);
  }
}

// ---------- Helpers ----------
/** Optimal-string-alignment distance: insert, delete, substitute, or swap adjacent letters. */
function editDistance(a: string, b: string) {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

const letterCount = (normalized: string) => normalized.replace(/[^a-z]/g, "").length;

const regionOfCode = (code: string) => {
  const fact = countryFacts(code);
  return fact ? fact.subregion || fact.region : "";
};

// ---------- Public API ----------
const neighbours = (code: string) => [...(adjacency.get(code.toUpperCase()) ?? [])].sort();

const seaRoutes = () =>
  [...seaPairs.values()].sort((x, y) => (x[0] === y[0] ? (x[1] < y[1] ? -1 : 1) : x[0] < y[0] ? -1 : 1));

const regionMembersByName = new Map<string, string[]>();
for (const code of gameCodes) {
  const region = regionOfCode(code);
  regionMembersByName.set(region, [...(regionMembersByName.get(region) ?? []), code]);
}

const regionOf = (code: string) => regionOfCode(code.toUpperCase());

const regionMembers = (region: string) => [...(regionMembersByName.get(region) ?? [])];

const regionNames = () => [...regionMembersByName.keys()].sort();

const continentOf = (code: string) => countryFacts(code.toUpperCase())?.region ?? "";

const capitalsOf = (code: string) => [...(worldByCode.get(code.toUpperCase())?.capital ?? [])];

const isCapitalOf = (code: string, answer: string) => {
  const guess = normalizeCountryName(answer);
  if (!guess) return false;
  return capitalsOf(code).some((capital) => {
    const name = normalizeCountryName(capital);
    if (name === guess) return true;
    return letterCount(name) >= 5 && editDistance(name, guess) <= 1;
  });
};

const eligibleByContinent = () => {
  const byContinent = new Map<string, string[]>();
  for (const code of gameCodes) {
    if (neighbours(code).length < EMPIRE_RULES.capitalMinNeighbours) continue;
    const continent = continentOf(code);
    byContinent.set(continent, [...(byContinent.get(continent) ?? []), code]);
  }
  return byContinent;
};

const startingCapitals = (playerCount: number, rng: Rng) => {
  if (!Number.isInteger(playerCount) || playerCount < 1) {
    throw new RangeError(`playerCount must be at least 1, got ${playerCount}`);
  }
  const byContinent = eligibleByContinent();
  const continents = [...byContinent.keys()].sort();
  if (playerCount > continents.length) {
    throw new RangeError(`playerCount ${playerCount} exceeds the ${continents.length} eligible continents`);
  }
  // Fisher-Yates shuffle of the continents, driven only by the provided rng.
  for (let i = continents.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [continents[i], continents[j]] = [continents[j], continents[i]];
  }
  return continents.slice(0, playerCount).map((continent) => {
    const options = byContinent.get(continent) ?? [];
    return options[Math.min(options.length - 1, Math.floor(rng() * options.length))];
  });
};

export const geo: EmpireGeo = {
  neighbours,
  seaRoutes,
  regionOf,
  regionMembers,
  regionNames,
  continentOf,
  capitalsOf,
  isCapitalOf,
  startingCapitals
};
