/**
 * Builds lib/data/country-stats.json. Run: node --import tsx scripts/build-country-stats.ts
 * Sources: World Bank API (population, GDP, GDP per capita; latest non-null value per country),
 * countries-and-timezones (distinct standard UTC offsets), flag-icons SVGs rasterised with resvg (flag colours).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { getCountry, getTimezone } from "countries-and-timezones";
import countries from "world-countries";
import { allCountryFacts } from "@/lib/countries";
import type { CountryStat, FlagColour } from "@/lib/country-stats";

const FLAG_COLOURS: FlagColour[] = ["red", "white", "blue", "green", "yellow", "black", "orange"];

const INDICATORS = { population: "SP.POP.TOTL", gdpUsd: "NY.GDP.MKTP.CD", gdpPerCapitaUsd: "NY.GDP.PCAP.CD" } as const;
/** A colour counts for a flag when at least this share of its recognised pixels are that colour (drops emblems and fine detail). */
const MIN_SHARE = 0.008; // orange needs 3%: it also appears where red and yellow blend at an edge
const ANCHORS: Record<FlagColour, string[]> = {
  red: ["#d21034", "#ce1126", "#e4002b", "#ff0000", "#8b0000", "#7b1e30", "#a6192e", "#c8102e"],
  white: ["#ffffff", "#f5f5f5"],
  blue: ["#0033a0", "#0038a8", "#002b7f", "#0072ce", "#75aadb", "#41a5ee", "#00a1de", "#1e50a0", "#012169", "#003893", "#4189dd"],
  green: ["#009a44", "#007a3d", "#006a4e", "#00a550", "#008000", "#006b3f", "#00843d", "#115740", "#239f40"],
  yellow: ["#ffd100", "#fcd116", "#fedd00", "#ffcd00", "#ffff00", "#c8a415", "#d4af37", "#f2c500"],
  black: ["#000000", "#1a1a1a"],
  orange: ["#ff8200", "#ff9933", "#f77f00", "#e86100", "#ff6600"]
};
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const anchors = Object.entries(ANCHORS).flatMap(([name, list]) => list.map((hex) => ({ name: name as FlagColour, rgb: rgb(hex) })));
const MAX_DISTANCE = 70;

function flagColours(code: string): FlagColour[] {
  const svg = readFileSync(`node_modules/flag-icons/flags/4x3/${code.toLowerCase()}.svg`);
  const { pixels } = new Resvg(svg, { fitTo: { mode: "width", value: 160 } }).render();
  const counts = new Map<FlagColour, number>();
  let total = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 250) continue;
    let best: FlagColour | null = null;
    let bestDistance = MAX_DISTANCE;
    for (const anchor of anchors) {
      const distance = Math.hypot(pixels[i] - anchor.rgb[0], pixels[i + 1] - anchor.rgb[1], pixels[i + 2] - anchor.rgb[2]);
      if (distance < bestDistance) { bestDistance = distance; best = anchor.name; }
    }
    if (best) { counts.set(best, (counts.get(best) ?? 0) + 1); total++; }
  }
  return FLAG_COLOURS.filter((name) => (counts.get(name) ?? 0) / Math.max(1, total) >= (name === "orange" ? 0.03 : MIN_SHARE));
}

/** Distinct standard UTC offsets across the country's IANA zones. */
/** The timezone database has no Kosovo entry; CLDR files it under Belgrade. */
const ZONE_FALLBACK: Record<string, string[]> = { XK: ["Europe/Belgrade"] };
function timezoneCount(code: string) {
  const offsets = new Set((getCountry(code)?.timezones ?? ZONE_FALLBACK[code] ?? []).map((name) => getTimezone(name)?.utcOffset).filter((offset): offset is number => offset !== undefined));
  return offsets.size || null;
}

async function worldBank(indicator: string) {
  const url = `https://api.worldbank.org/v2/country/all/indicator/${indicator}?format=json&per_page=400&mrnev=1`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`World Bank ${indicator}: HTTP ${response.status}`);
  const [, rows] = await response.json() as [unknown, { countryiso3code: string; value: number | null; date: string }[]];
  return new Map(rows.filter((row) => row.value !== null).map((row) => [row.countryiso3code, row.value as number]));
}

async function main() {
  const alpha3 = new Map(countries.map((c) => [c.cca2, c.cca3]));
  // Kosovo is XKX in the World Bank data.
  alpha3.set("XK", "XKX");
  const data = Object.fromEntries(await Promise.all(Object.entries(INDICATORS).map(async ([field, indicator]) => [field, await worldBank(indicator)] as const)));
  const stats: Record<string, CountryStat> = {};
  for (const { code } of allCountryFacts().sort((a, b) => a.code.localeCompare(b.code))) {
    const value = (field: keyof typeof INDICATORS) => data[field].get(alpha3.get(code) ?? "") ?? null;
    stats[code] = {
      population: value("population"), gdpUsd: value("gdpUsd"), gdpPerCapitaUsd: value("gdpPerCapitaUsd"),
      timezoneCount: timezoneCount(code), flagColours: flagColours(code)
    };
    const gaps = Object.entries(stats[code]).filter(([, v]) => v === null).map(([k]) => k);
    if (gaps.length) console.log(`${code}: missing ${gaps.join(", ")}`);
  }
  const lines = Object.entries(stats).map(([code, stat]) => `  ${JSON.stringify(code)}: ${JSON.stringify(stat)}`);
  writeFileSync("lib/data/country-stats.json", ["{", lines.join(",\n"), "}", ""].join("\n"));
  console.log(`Wrote ${Object.keys(stats).length} countries.`);
}
main().catch((error) => { console.error(error); process.exit(1); });
