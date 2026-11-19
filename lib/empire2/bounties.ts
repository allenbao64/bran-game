import type { Empire2Geo } from "./geo-adapter";
import type { BountyCard, BountyKind, CountryCode, Rng, Rules } from "./types";

const KINDS: BountyKind[] = ["letter", "landlocked", "island", "short", "long", "continent", "region"];
const MAX_ATTEMPTS = 40;

/** Whether a bounty card fits a country (section 8.4). Unknown codes never fit. */
export function bountyFits(card: BountyCard, code: CountryCode, geo: Empire2Geo): boolean {
  const t = geo.traits(code);
  if (t === null) return false;
  switch (card.kind) {
    case "letter":
      return t.initial === card.value;
    case "landlocked":
      return t.landlocked;
    case "island":
      return t.island;
    case "short":
      return typeof card.value === "number" && t.letters <= card.value;
    case "long":
      return typeof card.value === "number" && t.letters >= card.value;
    case "continent":
      return geo.continentOf(code) === card.value;
    case "region":
      return geo.regionOf(code) === card.value;
  }
}

export function bountyLabel(card: BountyCard): string {
  switch (card.kind) {
    case "letter":
      return `Starts with ${card.value}`;
    case "landlocked":
      return "Landlocked";
    case "island":
      return "Island nation";
    case "short":
      return `${card.value} letters or fewer`;
    case "long":
      return `${card.value} letters or more`;
    case "continent":
      return `In ${card.value}`;
    case "region":
      return `In ${card.value}`;
  }
}

/** First open card (slot order) that fits the country, if any. */
export function findClaimableBounty(
  bounties: readonly BountyCard[],
  code: CountryCode,
  geo: Empire2Geo,
): BountyCard | undefined {
  return bounties.find((c) => bountyFits(c, code, geo));
}

/**
 * Draws the round's bounty cards (section 8.4). Draw order per attempt: kind, then the value
 * when the kind needs one. A rejected attempt keeps its draws. Fallback after 40 failed attempts
 * scans a fixed order and uses no rng.
 */
export function drawBounties(
  rng: Rng,
  geo: Empire2Geo,
  free: CountryCode[],
  round: number,
  rules: Rules,
): BountyCard[] {
  const letters = [...new Set(geo.codes().map((c) => geo.traits(c)?.initial ?? "").filter((x) => x !== ""))].sort();
  const continents = geo.continentNames();
  const regions = geo.regionNames();
  const cards: BountyCard[] = [];

  const isValid = (cand: BountyCard): boolean => {
    if (cards.some((c) => c.kind === cand.kind && c.value === cand.value)) return false;
    let fits = 0;
    for (const code of free) {
      if (bountyFits(cand, code, geo)) fits += 1;
    }
    return fits >= rules.bountyMinFits;
  };

  for (let slot = 0; slot < rules.bountyCount; slot++) {
    const id = `r${round}-${slot}`;
    let card: BountyCard | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && card === null; attempt++) {
      const kind = KINDS[Math.floor(rng() * KINDS.length)];
      let value: string | number | null = null;
      switch (kind) {
        case "letter":
          value = letters[Math.floor(rng() * letters.length)];
          break;
        case "short":
          value = 5 + Math.floor(rng() * 3);
          break;
        case "long":
          value = 9 + Math.floor(rng() * 3);
          break;
        case "continent":
          value = continents[Math.floor(rng() * continents.length)];
          break;
        case "region":
          value = regions[Math.floor(rng() * regions.length)];
          break;
        default:
          value = null;
      }
      const candidate: BountyCard = { id, kind, value };
      if (isValid(candidate)) card = candidate;
    }
    if (card === null) {
      const fallback: BountyCard[] = [];
      for (const L of letters) fallback.push({ id, kind: "letter", value: L });
      for (const n of [5, 6, 7]) fallback.push({ id, kind: "short", value: n });
      for (const n of [9, 10, 11]) fallback.push({ id, kind: "long", value: n });
      for (const c of [...continents].sort()) fallback.push({ id, kind: "continent", value: c });
      for (const r of [...regions].sort()) fallback.push({ id, kind: "region", value: r });
      fallback.push({ id, kind: "landlocked", value: null });
      fallback.push({ id, kind: "island", value: null });
      card = fallback.find(isValid) ?? null;
    }
    if (card !== null) cards.push(card);
  }
  return cards;
}
