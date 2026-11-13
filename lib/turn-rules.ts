/** Version 2 (simple turns) rules for Country Sprint: criteria cards, points, bonuses and awards. */
import { allCountryFacts, countryFacts } from "@/lib/countries";
import { countryStat, FLAG_COLOURS, type FlagColour } from "@/lib/country-stats";

/** Host-selectable round counts. Rooms saved before the choice existed ran 12 rounds, so they keep that. */
export const TURN_ROUND_OPTIONS = [15, 20, 30] as const;
export const DEFAULT_TURN_ROUNDS = 20;
export const LEGACY_TURN_ROUNDS = 12;
export const isTurnRounds = (value: unknown): value is number => TURN_ROUND_OPTIONS.some((rounds) => rounds === value);
export const DOUBLE_POINT_ROUNDS = 3;
export const MIN_FITTING_COUNTRIES = 3;
export const SMALL_REGION_MAX = 6;
export const BONUS_POINTS = 2;
export const MAX_REGION_BONUS = 4;
/** Region bonus scales with size: 2 countries +1, 3 +2, 4 +3, 5 or 6 +4. */
export const regionBonusPoints = (size: number) => Math.max(0, Math.min(size - 1, MAX_REGION_BONUS));
export const MIN_TERRITORY = 3;
/** Host-selectable turn lengths in seconds (Blitz, Standard, Relaxed). */
export const TURN_SPEEDS = [
  { id: "blitz", label: "Blitz", seconds: 10 },
  { id: "standard", label: "Standard", seconds: 15 },
  { id: "relaxed", label: "Relaxed", seconds: 25 }
] as const;
export const DEFAULT_TURN_SECONDS = 15;
export const isTurnSeconds = (value: unknown): value is number => TURN_SPEEDS.some((speed) => speed.seconds === value);

type Direction = "over" | "under";
export type NumericKind = "area" | "population" | "gdp" | "gdpPerCapita";
export type Card =
  | { kind: "letter"; letter: string }
  | { kind: "max"; n: number }
  | { kind: "min"; n: number }
  | { kind: "continent"; region: string }
  | { kind: "landlocked" }
  /** Legacy single-country border card: still readable in saved rooms, no longer dealt. */
  | { kind: "border"; country: string }
  | { kind: "wild" }
  | { kind: "borders"; countries: string[] }
  /** n land neighbours or more; n = 0 means none at all. */
  | { kind: "neighbours"; n: number }
  | { kind: NumericKind; dir: Direction; n: number }
  | { kind: "language"; language: string }
  | { kind: "flag"; colour: FlagColour; has: boolean }
  | { kind: "timezones"; multiple: boolean };

export type Claim = { code: string; playerId: string; points: number; round: number; turn: number; at: number };
export type Bonus = { kind: "region" | "territory"; label: string; points: number };
export type Score = { points: number; bonuses: Bonus[]; bonusTotal: number; total: number; territory: number };

export const CONTINENTS = ["Africa", "Americas", "Asia", "Europe", "Oceania"];

const NUMERIC: Record<NumericKind, (code: string) => number | null> = {
  area: (code) => countryFacts(code)?.area ?? null,
  population: (code) => countryStat(code)?.population ?? null,
  gdp: (code) => countryStat(code)?.gdpUsd ?? null,
  gdpPerCapita: (code) => countryStat(code)?.gdpPerCapitaUsd ?? null
};

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
    case "borders": return country.borders.some((neighbour) => card.countries.includes(neighbour));
    case "neighbours": return card.n === 0 ? country.borders.length === 0 : country.borders.length >= card.n;
    case "area": case "population": case "gdp": case "gdpPerCapita": {
      const value = NUMERIC[card.kind](code);
      return value !== null && (card.dir === "over" ? value > card.n : value < card.n);
    }
    case "language": return country.languages.includes(card.language);
    case "flag": return countryStat(code)?.flagColours.includes(card.colour) === card.has;
    case "timezones": {
      const zones = countryStat(code)?.timezoneCount;
      return zones != null && (card.multiple ? zones > 1 : zones === 1);
    }
    case "wild": return true;
  }
}

const compact = (n: number) => n >= 1e12 ? `${n / 1e12} trillion` : n >= 1e9 ? `${n / 1e9} billion` : n >= 1e6 ? `${n / 1e6} million` : n.toLocaleString("en-US");
const listNames = (codes: string[]) => {
  const names = codes.map((code) => countryFacts(code)?.name ?? code);
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
};

export function cardLabel(card: Card): string {
  switch (card.kind) {
    case "letter": return `Starts with "${card.letter.toUpperCase()}"`;
    case "max": return `Name has ${card.n} letters or fewer`;
    case "min": return `Name has ${card.n} letters or more`;
    case "continent": return `In ${card.region === "Americas" ? "the Americas" : card.region}`;
    case "landlocked": return "Landlocked country";
    case "border": return `Borders ${countryFacts(card.country)?.name ?? card.country}`;
    case "borders": return `Shares a land border with ${listNames(card.countries)}`;
    case "neighbours": return card.n === 0 ? "Has no land neighbours (island or isolated)" : `Has ${card.n} or more land neighbours`;
    case "area": return `Area ${card.dir} ${card.n.toLocaleString("en-US")} km²`;
    case "population": return `Population ${card.dir} ${compact(card.n)}`;
    case "gdp": return `GDP ${card.dir} $${compact(card.n)}`;
    case "gdpPerCapita": return `GDP per capita ${card.dir} $${card.n.toLocaleString("en-US")}`;
    case "language": return `${card.language} is an official language`;
    case "flag": return card.has ? `Flag has ${card.colour}` : `Flag has no ${card.colour}`;
    case "timezones": return card.multiple ? "Spans more than one time zone" : "Has a single time zone";
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
function shuffled<T>(items: T[], rng: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}

/** Every non-wild card must fit between MIN_FIT and MAX_FIT unclaimed countries. */
export const MIN_FIT = 12;
export const MAX_FIT = 60;
/** Wild cards are a rare draw. */
export const WILD_RATE = 0.03;
/** An identical card is not dealt again within this many deals. */
export const RECENT_CARDS = 6;

/** The fit band for a board with `unclaimed` countries left: relaxes as the board empties (never below MIN_FITTING_COUNTRIES). */
export function fitBand(unclaimed: number) {
  const min = Math.max(MIN_FITTING_COUNTRIES, Math.min(MIN_FIT, Math.ceil(unclaimed / 4)));
  return { min, max: Math.min(MAX_FIT, Math.max(min, Math.ceil(unclaimed * 0.6))) };
}

/** Rounds to 1, 2, 2.5 or 5 times a power of ten, e.g. 10M, 25M, 50M. */
function niceNumber(value: number) {
  const exponent = Math.floor(Math.log10(value));
  const mantissa = value / 10 ** exponent;
  const best = [1, 2, 2.5, 5, 10].reduce((a, b) => (Math.abs(Math.log(b / mantissa)) < Math.abs(Math.log(a / mantissa)) ? b : a));
  return best * 10 ** exponent;
}

/** Thresholds that put roughly 15-45% of the unclaimed countries on the "over" or "under" side. */
function numericCandidates(kind: NumericKind, unclaimed: string[], rng: () => number): Card[] {
  const values = unclaimed.map(NUMERIC[kind]).filter((value): value is number => value !== null).sort((a, b) => a - b);
  if (values.length < 8) return [];
  const cards: Card[] = [];
  for (let i = 0; i < 12; i++) {
    const share = 0.15 + rng() * 0.3;
    const dir: Direction = rng() < 0.5 ? "over" : "under";
    const raw = values[Math.min(values.length - 1, Math.floor((dir === "over" ? 1 - share : share) * values.length))];
    if (raw > 0) cards.push({ kind, dir, n: niceNumber(raw) });
  }
  return cards;
}

const distinct = <T,>(items: T[]) => [...new Set(items)];
const CANDIDATES = {
  letter: (unclaimed) => distinct(unclaimed.map((code) => countryFacts(code)!.initial)).map((letter): Card => ({ kind: "letter", letter })),
  max: () => [4, 5, 6, 7, 8, 9].map((n): Card => ({ kind: "max", n })),
  min: () => [8, 9, 10, 11, 12, 13].map((n): Card => ({ kind: "min", n })),
  continent: () => CONTINENTS.map((region): Card => ({ kind: "continent", region })),
  landlocked: () => [{ kind: "landlocked" }],
  borders: (_, rng) => {
    const anchors = allCountryFacts().filter((country) => country.borders.length > 0).map((country) => country.code);
    return Array.from({ length: 40 }, (): Card => ({ kind: "borders", countries: shuffled(anchors, rng).slice(0, rng() < 0.6 ? 2 : 3) }));
  },
  neighbours: () => [0, 2, 3, 4, 5, 6, 7, 8].map((n): Card => ({ kind: "neighbours", n })),
  area: (unclaimed, rng) => numericCandidates("area", unclaimed, rng),
  population: (unclaimed, rng) => numericCandidates("population", unclaimed, rng),
  gdp: (unclaimed, rng) => numericCandidates("gdp", unclaimed, rng),
  gdpPerCapita: (unclaimed, rng) => numericCandidates("gdpPerCapita", unclaimed, rng),
  language: (unclaimed) => distinct(unclaimed.flatMap((code) => countryFacts(code)!.languages)).map((language): Card => ({ kind: "language", language })),
  flag: () => FLAG_COLOURS.flatMap((colour): Card[] => [{ kind: "flag", colour, has: true }, { kind: "flag", colour, has: false }]),
  timezones: () => [{ kind: "timezones", multiple: true }, { kind: "timezones", multiple: false }]
} satisfies Record<string, (unclaimed: string[], rng: () => number) => Card[]>;
export const DEALT_KINDS = Object.keys(CANDIDATES) as (keyof typeof CANDIDATES)[];

/**
 * Deals one card. Wild is a rare draw, rolled once and never twice in a row. Otherwise kinds are tried in random
 * order (skipping the previous card's kind and any card in `recent`, newest first) until one has a card that fits
 * between the band's bounds; a repeated kind is the fallback, wild the last resort.
 */
export function dealCard(unclaimed: string[], rng: () => number = Math.random, recent: Card[] = []): Card {
  if (unclaimed.length === 0 || (rng() < WILD_RATE && recent[0]?.kind !== "wild")) return { kind: "wild" };
  const { min, max } = fitBand(unclaimed.length);
  const seen = new Set(recent.slice(0, RECENT_CARDS).map(cardLabel));
  const kinds = shuffled(DEALT_KINDS, rng);
  const last = recent[0]?.kind;
  for (const kind of [...kinds.filter((k) => k !== last), ...kinds.filter((k) => k === last)]) {
    const options = CANDIDATES[kind](unclaimed, rng).filter((card) => {
      if (seen.has(cardLabel(card))) return false;
      const fits = fittingCodes(card, unclaimed).length;
      return fits >= min && fits <= max;
    });
    if (options.length) return pick(options, rng);
  }
  return { kind: "wild" };
}

/** Starting countries are claims in round 0 worth 0 points; they still count for territory and region bonuses. */
export const START_ROUND = 0;
export const isStartClaim = (claim: Pick<Claim, "round">) => claim.round === START_ROUND;
/** Starts must be at least this far apart (km, centre to centre) when the board allows it. */
export const MIN_START_DISTANCE_KM = 3000;

function distanceKm(a: [number, number], b: [number, number]) {
  const rad = Math.PI / 180;
  const h = Math.sin(((b[0] - a[0]) * rad) / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(((b[1] - a[1]) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/**
 * One starting country per player: not an island, at least 2 land neighbours, every start in a different subregion,
 * and as far apart as a few hundred random tries find (stopping early once all pairs are MIN_START_DISTANCE_KM apart).
 */
export function pickStartCountries(count: number, rng: () => number = Math.random): string[] {
  const eligible = allCountryFacts().filter((country) => country.borders.length >= 2);
  let best: string[] = [];
  let bestGap = -1;
  for (let attempt = 0; attempt < 300 && bestGap < MIN_START_DISTANCE_KM; attempt++) {
    const picks = shuffled(eligible, rng).slice(0, count);
    if (new Set(picks.map((country) => country.subregion)).size < picks.length) continue;
    let gap = Infinity;
    picks.forEach((a, i) => picks.slice(i + 1).forEach((b) => { gap = Math.min(gap, distanceKm(a.latlng, b.latlng)); }));
    if (gap > bestGap) { best = picks.map((country) => country.code); bestGap = gap; }
  }
  return best;
}

export function allCodes() {
  return allCountryFacts().map((country) => country.code);
}
export function unclaimedCodes(claims: Pick<Claim, "code">[]) {
  const taken = new Set(claims.map((claim) => claim.code));
  return allCodes().filter((code) => !taken.has(code));
}

/** 1 point per claim, 2 during the last three rounds. */
export function pointsForRound(round: number, totalRounds: number) {
  return round > totalRounds - DOUBLE_POINT_ROUNDS ? 2 : 1;
}
export const isDoubleRound = (round: number, totalRounds: number) => pointsForRound(round, totalRounds) === 2;

/** Subregions with six or fewer countries in the game list. */
export function smallRegions(): { name: string; codes: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const country of allCountryFacts()) groups.set(country.subregion, [...(groups.get(country.subregion) ?? []), country.code]);
  return [...groups.entries()].filter(([, codes]) => codes.length <= SMALL_REGION_MAX)
    .map(([name, codes]) => ({ name, codes })).sort((a, b) => a.name.localeCompare(b.name));
}

/** The biggest group of one owner's countries connected by land borders (ties: the group found first, in claim order). */
export function largestConnectedGroupCodes(codes: string[]): string[] {
  const owned = new Set(codes);
  const seen = new Set<string>();
  let best: string[] = [];
  for (const start of owned) {
    if (seen.has(start)) continue;
    const group: string[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const code = stack.pop()!;
      group.push(code);
      for (const next of countryFacts(code)?.borders ?? []) {
        if (owned.has(next) && !seen.has(next)) { seen.add(next); stack.push(next); }
      }
    }
    if (group.length > best.length) best = group;
  }
  return best;
}
/** Size of the biggest group of one owner's countries connected by land borders. */
export const largestConnectedGroup = (codes: string[]) => largestConnectedGroupCodes(codes).length;

/** Each player's largest connected group (the one the territory bonus is measured on), for the map outline. */
export function largestGroupsByPlayer(playerIds: string[], claims: Pick<Claim, "code" | "playerId">[]): Record<string, string[]> {
  return Object.fromEntries(playerIds.map((id) => [id, largestConnectedGroupCodes(claims.filter((claim) => claim.playerId === id).map((claim) => claim.code)).sort()]));
}

/** Bonuses for owning every country of a small region. */
export function regionBonuses(claims: Pick<Claim, "code" | "playerId">[]): Record<string, Bonus[]> {
  const owner = new Map(claims.map((claim) => [claim.code, claim.playerId]));
  const result: Record<string, Bonus[]> = {};
  for (const region of smallRegions()) {
    const owners = new Set(region.codes.map((code) => owner.get(code)));
    const only = owners.size === 1 ? [...owners][0] : undefined;
    if (only && regionBonusPoints(region.codes.length) > 0) (result[only] ??= []).push({ kind: "region", label: `Owns all of ${region.name}`, points: regionBonusPoints(region.codes.length) });
  }
  return result;
}

export type RegionStatus = "open" | "won" | "blocked";
export type RegionProgress = { name: string; codes: string[]; points: number; owned: Record<string, number>; status: RegionStatus; winner: string | null };
/** Every bonus region with each player's count. "Blocked" once two players hold part of it: nobody can complete it. */
export function regionProgress(claims: Record<string, string>): RegionProgress[] {
  return smallRegions().filter((region) => regionBonusPoints(region.codes.length) > 0).map((region) => {
    const owned: Record<string, number> = {};
    region.codes.forEach((code) => { const owner = claims[code]; if (owner) owned[owner] = (owned[owner] ?? 0) + 1; });
    const owners = Object.keys(owned);
    const winner = owners.length === 1 && owned[owners[0]] === region.codes.length ? owners[0] : null;
    return { ...region, points: regionBonusPoints(region.codes.length), owned, status: winner ? "won" : owners.length > 1 ? "blocked" : "open", winner };
  });
}

/** One line on what a claim did for its region, e.g. "Kazakhstan: 1 of 5 in Central Asia (+4)". */
export function claimRegionNote(claims: Record<string, string>, code: string, playerId: string): string {
  const name = countryFacts(code)?.name ?? code;
  const region = regionProgress({ ...claims, [code]: playerId }).find((entry) => entry.codes.includes(code));
  if (!region) return `${name}: not in a bonus region.`;
  if (region.winner === playerId) return `${name}: you own all of ${region.name}. +${region.points}`;
  if (region.status === "blocked") return `${name}: ${region.name} is split, so no one gets its +${region.points}.`;
  return `${name}: ${region.owned[playerId]} of ${region.codes.length} in ${region.name} (+${region.points}).`;
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

export function computeAwards(playerIds: string[], claims: Claim[], totalRounds: number): Award[] {
  const awards: Award[] = [];
  const played = claims.filter((claim) => !isStartClaim(claim));
  if (played.length) {
    const first = played[0];
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
