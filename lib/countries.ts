import countries from "world-countries";

export type CountryAnswer = { code: string; name: string };
const rows = countries.filter((c) => c.unMember || ["VA", "PS", "TW", "XK"].includes(c.cca2));
const byName = new Map<string, CountryAnswer>();
const byCode = new Map<string, CountryAnswer>();

export function normalizeCountryName(value: string) {
  return value.toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
for (const c of rows) {
  const answer = { code: c.cca2, name: c.name.common };
  byCode.set(answer.code, answer);
  byName.set(normalizeCountryName(c.name.common), answer);
  byName.set(normalizeCountryName(c.name.official), answer);
}
if (!byCode.has("XK")) {
  const kosovo = { code: "XK", name: "Kosovo" };
  byCode.set(kosovo.code, kosovo);
  byName.set("kosovo", kosovo);
}
const aliases: Record<string, string> = {
  "united states of america": "US", usa: "US", america: "US",
  "united kingdom": "GB", uk: "GB", britain: "GB", "great britain": "GB",
  "south korea": "KR", "north korea": "KP", russia: "RU", "czech republic": "CZ",
  "ivory coast": "CI", "cote divoire": "CI", uae: "AE", "united arab emirates": "AE",
  "vatican city": "VA", palestine: "PS", taiwan: "TW", kosovo: "XK",
  "democratic republic of the congo": "CD", "dr congo": "CD", "republic of the congo": "CG",
  holland: "NL", moldova: "MD", brunei: "BN", syria: "SY", laos: "LA",
  micronesia: "FM", bolivia: "BO", tanzania: "TZ", venezuela: "VE", vietnam: "VN",
  swaziland: "SZ", turkey: "TR", "north macedonia": "MK", "east timor": "TL",
  myanmar: "MM", burma: "MM"
};
export function resolveCountry(name: string) {
  const key = normalizeCountryName(name);
  return (aliases[key] && byCode.get(aliases[key])) || byName.get(key) || null;
}
export function countryByCode(code: string) {
  return byCode.get(code.toUpperCase()) ?? null;
}
