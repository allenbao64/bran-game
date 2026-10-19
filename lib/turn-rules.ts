/** Version 2 (simple turns) rules for Country Sprint: criteria cards, points, bonuses and awards. */
import { allCountryFacts, countryFacts } from "@/lib/countries";

export const V2_ROUNDS = 12;
export const DOUBLE_POINT_ROUNDS = 3;
export const MIN_FITTING_COUNTRIES = 3;
export const SMALL_REGION_MAX = 6;
export const BONUS_POINTS = 2;
export const MIN_TERRITORY = 3;

export type Card =
  | { kind: "letter"; letter: string }
  | { kind: "max"; n: number }
  | { kind: "min"; n: number }
  | { kind: "continent"; region: string }
  | { kind: "landlocked" }
  | { kind: "border"; country: string }
  | { kind: "wild" };

export type Claim = { code: string; playerId: string; points: number; round: number; turn: number; at: number };
export type Bonus = { kind: "region" | "territory"; label: string; points: number };
export type Score = { points: number; bonuses: Bonus[]; bonusTotal: number; total: number; territory: number };

export const CONTINENTS = ["Africa", "Americas", "Asia", "Europe", "Oceania"];

export function cardFits(card: Card, code: string): boolean {
  const country = countryFacts(code);
  if (!country) return false;
  switch (card.kind) {
    case "letter": return country.initial === card.letter.toUpperCase();
    case "max": return country.letters <= card.n;
    case "min": return country.letters >= card.n;
    case "continent": return country.region === card.region;
    case "landlocked": return country.landlocked;
    case "border": return country.borders.includes(card.country);
    case "wild": return true;
  }
}

export function cardLabel(card: Card): string {
  switch (card.kind) {
    case "letter": return `Starts with "${card.letter.toUpperCase()}"`;
    case "max": return `Name has ${card.n} letters or fewer`;
    case "min": return `Name has ${card.n} letters or more`;
    case "continent": return `In ${card.region === "Americas" ? "the Americas" : card.region}`;
    case "landlocked": return "Landlocked country";
    case "border": return `Borders ${countryFacts(card.country)?.name ?? card.country}`;
    case "wild": return "Wild card: any country";
  }
}

/** The unclaimed country codes that would satisfy a card. */
export function fittingCodes(card: Card, unclaimed: string[]) {
  return unclaimed.filter((code) => cardFits(card, code));
}

function pick<T>(items: T[], rng: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

const CARD_KINDS = ["letter", "max", "min", "continent", "landlocked", "border"] as const;

function candidateCard(unclaimed: string[], rng: () => number): Card {
  if (rng() < 0.1) return { kind: "wild" };
  const kind = pick([...CARD_KINDS], rng);
  switch (kind) {
    case "letter": return { kind, letter: pick(unclaimed.map((code) => countryFacts(code)!.initial), rng) };
    case "max": return { kind, n: 5 + Math.floor(rng() * 3) };
    case "min": return { kind, n: 9 + Math.floor(rng() * 3) };
    case "continent": return { kind, region: pick(CONTINENTS, rng) };
    case "landlocked": return { kind };
    case "border": {
      const neighbours = [...new Set(unclaimed.flatMap((code) => countryFacts(code)!.borders))];
      return neighbours.length ? { kind, country: pick(neighbours, rng) } : { kind: "wild" };
    }
  }
}

/**
 * Deals one card. A non-wild card is only dealt if at least 3 unclaimed countries
 * fit it; otherwise we draw again, and finally fall back to wild.
 */
export function dealCard(unclaimed: string[], rng: () => number = Math.random): Card {
  if (unclaimed.length === 0) return { kind: "wild" };
  for (let attempt = 0; attempt < 40; attempt++) {
    const card = candidateCard(unclaimed, rng);
    if (fittingCodes(card, unclaimed).length >= MIN_FITTING_COUNTRIES) return card;
  }
  return { kind: "wild" };
}

export function allCodes() {
  return allCountryFacts().map((country) => country.code);
}
export function unclaimedCodes(claims: Pick<Claim, "code">[]) {
  const taken = new Set(claims.map((claim) => claim.code));
  return allCodes().filter((code) => !taken.has(code));
}

/** 1 point per claim, 2 during the last three rounds. */
export function pointsForRound(round: number, totalRounds = V2_ROUNDS) {
  return round > totalRounds - DOUBLE_POINT_ROUNDS ? 2 : 1;
}
export const isDoubleRound = (round: number, totalRounds = V2_ROUNDS) => pointsForRound(round, totalRounds) === 2;

/** Subregions with six or fewer countries in the game list. */
export function smallRegions(): { name: string; codes: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const country of allCountryFacts()) groups.set(country.subregion, [...(groups.get(country.subregion) ?? []), country.code]);
  return [...groups.entries()].filter(([, codes]) => codes.length <= SMALL_REGION_MAX)
    .map(([name, codes]) => ({ name, codes })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Size of the biggest group of one owner's countries connected by land borders. */
export function largestConnectedGroup(codes: string[]): number {
  const owned = new Set(codes);
  const seen = new Set<string>();
  let best = 0;
  for (const start of owned) {
    if (seen.has(start)) continue;
    let size = 0;
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const code = stack.pop()!;
      size++;
      for (const next of countryFacts(code)?.borders ?? []) {
        if (owned.has(next) && !seen.has(next)) { seen.add(next); stack.push(next); }
      }
    }
    best = Math.max(best, size);
  }
  return best;
}

/** Bonuses for owning every country of a small region. */
export function regionBonuses(claims: Pick<Claim, "code" | "playerId">[]): Record<string, Bonus[]> {
  const owner = new Map(claims.map((claim) => [claim.code, claim.playerId]));
  const result: Record<string, Bonus[]> = {};
  for (const region of smallRegions()) {
    const owners = new Set(region.codes.map((code) => owner.get(code)));
    const only = owners.size === 1 ? [...owners][0] : undefined;
    if (only) (result[only] ??= []).push({ kind: "region", label: `Owns all of ${region.name}`, points: BONUS_POINTS });
  }
  return result;
}

/** The sole owner of the biggest connected group (min 3, strictly bigger than everyone else). */
export function territoryLeader(playerIds: string[], claims: Pick<Claim, "code" | "playerId">[]) {
  const sizes = Object.fromEntries(playerIds.map((id) => [id, largestConnectedGroup(claims.filter((c) => c.playerId === id).map((c) => c.code))]));
  const ranked = Object.entries(sizes).sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  const leader = top && top[1] >= MIN_TERRITORY && (!second || top[1] > second[1]) ? top[0] : null;
  return { sizes, leader, size: top?.[1] ?? 0 };
}

export function computeScores(playerIds: string[], claims: Claim[]): Record<string, Score> {
  const regions = regionBonuses(claims);
  const territory = territoryLeader(playerIds, claims);
  const scores: Record<string, Score> = {};
  for (const id of playerIds) {
    const points = claims.filter((claim) => claim.playerId === id).reduce((sum, claim) => sum + claim.points, 0);
    const bonuses = [...(regions[id] ?? [])];
    if (territory.leader === id) bonuses.push({ kind: "territory", label: `Largest territory (${territory.sizes[id]} linked)`, points: BONUS_POINTS });
    const bonusTotal = bonuses.reduce((sum, bonus) => sum + bonus.points, 0);
    scores[id] = { points, bonuses, bonusTotal, total: points + bonusTotal, territory: territory.sizes[id] };
  }
  return scores;
}

export type Award = { id: "first" | "territory" | "comeback"; title: string; playerId: string; detail: string };

export function computeAwards(playerIds: string[], claims: Claim[], totalRounds = V2_ROUNDS): Award[] {
  const awards: Award[] = [];
  if (claims.length) {
    const first = claims[0];
    awards.push({ id: "first", title: "First claim", playerId: first.playerId, detail: `Opened the board with ${countryFacts(first.code)?.name ?? first.code}` });
  }
  const territory = territoryLeader(playerIds, claims);
  if (territory.leader) awards.push({ id: "territory", title: "Biggest territory", playerId: territory.leader, detail: `${territory.size} connected countries` });
  const half = Math.floor(totalRounds / 2);
  if (playerIds.length >= 2 && claims.some((claim) => claim.round > half)) {
    const mid = computeScores(playerIds, claims.filter((claim) => claim.round <= half));
    const final = computeScores(playerIds, claims);
    const unique = (scores: Record<string, Score>, dir: 1 | -1) => {
      const ranked = playerIds.map((id) => [id, scores[id].total] as const).sort((a, b) => dir * (a[1] - b[1]));
      return ranked[1] && ranked[0][1] === ranked[1][1] ? null : ranked[0][0];
    };
    const last = unique(mid, 1);
    if (last && last === unique(final, -1)) awards.push({ id: "comeback", title: "Comeback", playerId: last, detail: "Last at the halfway point, first at the end" });
  }
  return awards;
}
