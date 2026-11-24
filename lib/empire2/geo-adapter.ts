import { allCountryFacts, countryFacts } from "@/lib/countries";
import { geo } from "@/lib/empire/geo";

/** The only file in lib/empire2 that touches Empire 1 geography or country data. */

export type CountryTraits = {
  initial: string;      // uppercase first letter of the name, e.g. "B"
  letters: number;      // count of letters in the name
  landlocked: boolean;
  island: boolean;      // no land border at all
};

export type Empire2Geo = {
  /** Every game country code, uppercase, sorted ascending. */
  codes(): string[];
  /** Land borders plus sea routes. Symmetric. Sorted. */
  neighbours(code: string): string[];
  /** Region name for a code; "" if unknown. */
  regionOf(code: string): string;
  /** Members of a region, sorted ascending. [] if unknown. */
  regionMembers(region: string): string[];
  /** All region names, sorted ascending. */
  regionNames(): string[];
  /** Engine continent (see D1) for a code; "" if unknown. */
  continentOf(code: string): string;
  /** All engine continent names that have at least one country, sorted ascending. */
  continentNames(): string[];
  /** Capital names; first is the canonical answer. */
  capitalsOf(code: string): string[];
  /** True if answer names one of the capitals (tolerant matching). */
  isCapitalOf(code: string, answer: string): boolean;
  /** Bounty facts; null for unknown code. */
  traits(code: string): CountryTraits | null;
};

/** Engine continent (D1): "Americas" is split into "South America" and "North America". */
export function engineContinentOf(code: string): string {
  const upper = code.toUpperCase();
  const c = geo.continentOf(upper);
  if (c !== "Americas") return c;
  return geo.regionOf(upper) === "South America" ? "South America" : "North America";
}

let cachedCodes: string[] | null = null;
function gameCodes(): string[] {
  if (cachedCodes === null) cachedCodes = allCountryFacts().map((f) => f.code).sort();
  return cachedCodes;
}

let cachedContinents: string[] | null = null;
function continentNames(): string[] {
  if (cachedContinents === null) {
    const names = new Set<string>();
    for (const code of gameCodes()) names.add(engineContinentOf(code));
    cachedContinents = [...names].filter((n) => n !== "").sort();
  }
  return [...cachedContinents];
}

export const empire2Geo: Empire2Geo = {
  codes: () => [...gameCodes()],
  neighbours: (code) => geo.neighbours(code.toUpperCase()),
  regionOf: (code) => geo.regionOf(code.toUpperCase()),
  regionMembers: (region) => geo.regionMembers(region),
  regionNames: () => geo.regionNames(),
  continentOf: (code) => (countryFacts(code.toUpperCase()) ? engineContinentOf(code) : ""),
  continentNames,
  capitalsOf: (code) => geo.capitalsOf(code.toUpperCase()),
  isCapitalOf: (code, answer) => geo.isCapitalOf(code.toUpperCase(), answer),
  traits: (code) => {
    const f = countryFacts(code.toUpperCase());
    if (!f) return null;
    return { initial: f.initial, letters: f.letters, landlocked: f.landlocked, island: f.borders.length === 0 };
  },
};
