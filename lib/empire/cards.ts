import { allCountryFacts, countryFacts } from "@/lib/countries";
import {
  EMPIRE_RULES,
  type CardContext,
  type CardKind,
  type DealContext,
  type EmpireCard,
  type EmpireCards,
  type EmpireEvent,
  type EventKind,
  type Rng
} from "@/lib/empire/types";

const EVENT_KINDS: readonly EventKind[] = ["goldRush", "ceasefire", "freeSteals", "closedContinent", "wildRound"];
const RANDOM_KINDS: readonly CardKind[] = ["letter", "short", "long", "continent", "region", "landlocked", "island", "bordersYou", "bordersCountry"];
const MAX_SAMPLE_TRIES = 40;

/** Values the random cards draw from, taken from the country data. Sorted so seeded deals are stable. */
const data = (() => {
  const facts = allCountryFacts();
  const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort();
  return {
    letters: unique(facts.map((f) => f.initial)),
    continents: unique(facts.map((f) => f.region)),
    regions: unique(facts.map((f) => f.subregion || f.region)),
    countries: unique(facts.map((f) => f.code))
  };
})();

export function cardFits(card: EmpireCard, code: string, ctx: CardContext): boolean {
  const facts = countryFacts(code);
  if (!facts) return false;
  switch (card.kind) {
    case "letter":
      return card.letter !== undefined && facts.initial === card.letter.toUpperCase();
    case "short":
      return card.max !== undefined && facts.letters <= card.max;
    case "long":
      return card.min !== undefined && facts.letters >= card.min;
    case "continent":
      return facts.region === card.continent;
    case "region":
      return (facts.subregion || facts.region) === card.region;
    case "landlocked":
      return facts.landlocked;
    case "island":
      return facts.borders.length === 0;
    case "bordersYou":
      return ctx.neighbours(code).some((n) => ctx.ownedByMe.has(n));
    case "bordersCountry":
      return code !== card.country && ctx.neighbours(card.country ?? "").includes(code);
    case "wild":
      return true;
    default:
      return false;
  }
}

export function cardLabel(card: EmpireCard): string {
  switch (card.kind) {
    case "letter": return `Starts with ${card.letter}`;
    case "short": return `${card.max} letters or fewer`;
    case "long": return `${card.min} letters or more`;
    case "continent": return `In ${card.continent}`;
    case "region": return `In ${card.region}`;
    case "landlocked": return "Landlocked";
    case "island": return "Island nation";
    case "bordersYou": return "Borders a country you own";
    case "bordersCountry": return `Borders ${countryFacts(card.country ?? "")?.name ?? card.country ?? "an unknown country"}`;
    default: return "Any country";
  }
}

export function drawEvent(rng: Rng, continents: string[]): EmpireEvent {
  const kinds = continents.length ? EVENT_KINDS : EVENT_KINDS.filter((k) => k !== "closedContinent");
  const kind = pick(rng, kinds);
  if (kind === "closedContinent") return { kind, continent: pick(rng, continents) };
  return { kind };
}

export function eventLabel(event: EmpireEvent): string {
  switch (event.kind) {
    case "goldRush": return "Gold rush: claims are worth 2 points";
    case "ceasefire": return "Ceasefire: no steals";
    case "freeSteals": return "Free steals: steals cost no token";
    case "closedContinent": return `Closed: ${event.continent} can't be claimed`;
    case "wildRound": return "Wild round: every card is Any country";
    default: return "";
  }
}

export function dealHand(count: number, ctx: DealContext): EmpireCard[] {
  if (count <= 0) return [];
  const event = ctx.event;
  if (event?.kind === "wildRound") return Array.from({ length: count }, wild);

  const closed = event?.kind === "closedContinent" ? event.continent : undefined;
  const continents = data.continents.filter((c) => c !== closed);
  const kinds = continents.length ? RANDOM_KINDS : RANDOM_KINDS.filter((k) => k !== "continent");
  // Countries on the closed continent never count as fitting.
  const eligible = [...new Set(ctx.unclaimed)].filter((code) => {
    const facts = countryFacts(code);
    return facts !== null && (closed === undefined || facts.region !== closed);
  });

  const hasEnoughFits = (card: EmpireCard) => {
    let fits = 0;
    for (const code of eligible) {
      if (cardFits(card, code, ctx) && ++fits >= EMPIRE_RULES.minFits) return true;
    }
    return false;
  };

  const hand: EmpireCard[] = [];
  const used = new Set<string>();
  let hasWild = false;
  for (let slot = 0; slot < count; slot++) {
    if (!hasWild && ctx.rng() < EMPIRE_RULES.wildChance) {
      hasWild = true;
      hand.push(wild());
      continue;
    }
    const card = sampleCard(kinds, continents, used, ctx.rng, hasEnoughFits);
    if (card) {
      used.add(cardKey(card));
      hand.push(card);
      continue;
    }
    // Sampling failed: fall back to a wild card, or, if one is already in the hand, to any valid card.
    // Two identical wilds are never dealt outside a wildRound, so when nothing else fits the hand is simply shorter (never empty: slot 0 can always fall back to wild).
    if (!hasWild) {
      hasWild = true;
      hand.push(wild());
      continue;
    }
    const pool = allCandidates(continents).filter((c) => !used.has(cardKey(c)) && hasEnoughFits(c));
    if (pool.length) {
      const picked = pick(ctx.rng, pool);
      used.add(cardKey(picked));
      hand.push(picked);
    } else {
      break;
    }
  }
  return hand;
}

export const cards: EmpireCards = { cardFits, cardLabel, dealHand, drawEvent, eventLabel };

function wild(): EmpireCard {
  return { kind: "wild" };
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function cardKey(card: EmpireCard) {
  return [card.kind, card.letter ?? "", card.max ?? "", card.min ?? "", card.continent ?? "", card.region ?? "", card.country ?? ""].join("|");
}

function randomCard(kind: CardKind, rng: Rng, continents: string[]): EmpireCard {
  switch (kind) {
    case "letter": return { kind, letter: pick(rng, data.letters) };
    case "short": return { kind, max: 5 + Math.floor(rng() * 3) };
    case "long": return { kind, min: 9 + Math.floor(rng() * 3) };
    case "continent": return { kind, continent: pick(rng, continents) };
    case "region": return { kind, region: pick(rng, data.regions) };
    case "bordersCountry": return { kind, country: pick(rng, data.countries) };
    default: return { kind: kind as "landlocked" | "island" | "bordersYou" };
  }
}

function sampleCard(
  kinds: readonly CardKind[],
  continents: string[],
  used: Set<string>,
  rng: Rng,
  hasEnoughFits: (card: EmpireCard) => boolean
): EmpireCard | null {
  for (let attempt = 0; attempt < MAX_SAMPLE_TRIES; attempt++) {
    const card = randomCard(pick(rng, kinds), rng, continents);
    if (!used.has(cardKey(card)) && hasEnoughFits(card)) return card;
  }
  return null;
}

/** Every non-wild card with its parameters in the allowed ranges, in a fixed order. */
function allCandidates(continents: string[]): EmpireCard[] {
  const out: EmpireCard[] = [];
  for (const letter of data.letters) out.push({ kind: "letter", letter });
  for (let max = 5; max <= 7; max++) out.push({ kind: "short", max });
  for (let min = 9; min <= 11; min++) out.push({ kind: "long", min });
  for (const continent of continents) out.push({ kind: "continent", continent });
  for (const region of data.regions) out.push({ kind: "region", region });
  out.push({ kind: "landlocked" }, { kind: "island" }, { kind: "bordersYou" });
  for (const country of data.countries) out.push({ kind: "bordersCountry", country });
  return out;
}
