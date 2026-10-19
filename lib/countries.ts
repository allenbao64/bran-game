import countries from "world-countries";

export type CountryAnswer = { code: string; name: string };
const rows = countries.filter((c) => c.unMember || ["VA", "PS", "TW", "XK"].includes(c.cca2));
const byName = new Map<string, CountryAnswer>();
const byCode = new Map<string, CountryAnswer>();
const byNumericCode = new Map<string, string>();

export function normalizeCountryName(value: string) {
  return value.toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
for (const c of rows) {
  const answer = { code: c.cca2, name: c.name.common };
  byCode.set(answer.code, answer);
  if (c.ccn3) byNumericCode.set(c.ccn3.padStart(3, "0"), answer.code);
  byName.set(normalizeCountryName(c.name.common), answer);
  byName.set(normalizeCountryName(c.name.official), answer);
}
if (!byCode.has("XK")) {
  const kosovo = { code: "XK", name: "Kosovo" };
  byCode.set(kosovo.code, kosovo);
  byName.set("kosovo", kosovo);
}
const aliases: Record<string, string> = {
  "united states of america": "US", usa: "US", "u s a": "US", "u s": "US", us: "US", america: "US", "the states": "US",
  "united kingdom": "GB", uk: "GB", "u k": "GB", gb: "GB", britain: "GB", "great britain": "GB", england: "GB",
  "south korea": "KR", "republic of korea": "KR", rok: "KR", "s korea": "KR", "north korea": "KP", dprk: "KP", "n korea": "KP",
  russia: "RU", "russian federation": "RU", "czech republic": "CZ", czechia: "CZ",
  "ivory coast": "CI", "cote divoire": "CI", uae: "AE", "u a e": "AE", emirates: "AE", "united arab emirates": "AE",
  "vatican city": "VA", vatican: "VA", "holy see": "VA", palestine: "PS", taiwan: "TW", kosovo: "XK",
  "democratic republic of the congo": "CD", "dr congo": "CD", drc: "CD", "d r c": "CD", "d r congo": "CD", "congo kinshasa": "CD",
  "congo democratic republic": "CD", "democratic republic of congo": "CD", zaire: "CD", "congo drc": "CD",
  "republic of the congo": "CG", "republic of congo": "CG", "congo brazzaville": "CG", roc: "CG", "r o c": "CG", congo: "CG",
  "central african republic": "CF", car: "CF", "c a r": "CF", "central africa": "CF",
  holland: "NL", "the netherlands": "NL", moldova: "MD", brunei: "BN", syria: "SY", laos: "LA",
  micronesia: "FM", bolivia: "BO", tanzania: "TZ", venezuela: "VE", vietnam: "VN",
  swaziland: "SZ", eswatini: "SZ", turkey: "TR", turkiye: "TR", "north macedonia": "MK", macedonia: "MK",
  "east timor": "TL", "timor leste": "TL", myanmar: "MM", burma: "MM",
  "cape verde": "CV", "cabo verde": "CV", gambia: "GM", "the gambia": "GM", bahamas: "BS", "the bahamas": "BS",
  "bosnia": "BA", herzegovina: "BA", "bosnia herzegovina": "BA", "bosnia and herzegovina": "BA",
  "trinidad": "TT", tobago: "TT", "trinidad and tobago": "TT", "st lucia": "LC", "st kitts": "KN", "st kitts and nevis": "KN",
  "st vincent": "VC", "saint vincent": "VC", "st vincent and the grenadines": "VC", antigua: "AG", barbuda: "AG",
  "sao tome": "ST", "sao tome and principe": "ST", "png": "PG", "p n g": "PG", nz: "NZ", "new zealand": "NZ",
  "equatorial guinea": "GQ", "eq guinea": "GQ", "guinea bissau": "GW", "saudi": "SA", ksa: "SA", "south sudan": "SS",
  "s africa": "ZA", "rsa": "ZA", "dominican rep": "DO", "dom rep": "DO", swiss: "CH", "ivory": "CI", "burkina": "BF",
  "marshall islands": "MH", "solomons": "SB", "salvador": "SV", "el salvador": "SV", "the philippines": "PH",
  "persia": "IR", "siam": "TH", "kampuchea": "KH", "ceylon": "LK", "abyssinia": "ET", "formosa": "TW"
};
function editDistance(a: string, b: string) {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
/** Forgives small typos, but only when exactly one country is the clear closest match. */
function fuzzyCountry(key: string) {
  const allowed = key.length >= 8 ? 2 : key.length >= 5 ? 1 : 0;
  if (!allowed) return null;
  let best = allowed + 1;
  let winners = new Set<string>();
  const consider = (name: string, code: string) => {
    if (Math.abs(name.length - key.length) > allowed) return;
    const distance = editDistance(key, name);
    if (distance < best) { best = distance; winners = new Set([code]); }
    else if (distance === best) winners.add(code);
  };
  byName.forEach((answer, name) => consider(name, answer.code));
  Object.entries(aliases).forEach(([name, code]) => consider(name, code));
  return best <= allowed && winners.size === 1 ? byCode.get([...winners][0]) ?? null : null;
}
export function resolveCountry(name: string) {
  const key = normalizeCountryName(name);
  const exact = (aliases[key] && byCode.get(aliases[key])) || byName.get(key.replace(/^the /, "")) || byName.get(key);
  return exact || (key ? fuzzyCountry(key) : null);
}
export function countryByCode(code: string) {
  return byCode.get(code.toUpperCase()) ?? null;
}

/** Converts the numeric ISO identifiers used by the world-map data to ISO alpha-2. */
export function countryCodeFromNumericId(id: string | number | undefined) {
  return id === undefined ? undefined : byNumericCode.get(String(id).padStart(3, "0"));
}

/** Bigger scores for smaller countries: obscure answers reward knowledge, not typing speed. */
export function countryPoints(code: string) {
  const area = rows.find((c) => c.cca2 === code.toUpperCase())?.area ?? 0;
  return area >= 500_000 ? 1 : area >= 50_000 ? 2 : area >= 5_000 ? 3 : 4;
}

export function allCountryCodes() {
  return [...byCode.keys()];
}

/** Hint-safe facts about a country: never the full name. */
export function countryHintFacts(code: string) {
  const answer = byCode.get(code.toUpperCase());
  const row = rows.find((c) => c.cca2 === code.toUpperCase());
  if (!answer) return null;
  return {
    letter: answer.name.charAt(0).toUpperCase(),
    region: row?.subregion || row?.region || "Somewhere on Earth",
    length: answer.name.replace(/[^A-Za-z]/g, "").length,
    points: countryPoints(code)
  };
}
