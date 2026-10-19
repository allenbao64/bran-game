import assert from "node:assert/strict";
import test from "node:test";
import { resolveCountry } from "@/lib/countries";

const code = (input: string) => resolveCountry(input)?.code ?? null;

test("common abbreviations and alternate names resolve", () => {
  const cases: Record<string, string> = {
    "dr congo": "CD", drc: "CD", "D.R.C.": "CD", "Congo-Kinshasa": "CD", "Democratic Republic of the Congo": "CD",
    congo: "CG", "congo brazzaville": "CG", car: "CF", "central african republic": "CF",
    usa: "US", "U.S.A.": "US", "united states": "US", uk: "GB", uae: "AE", nz: "NZ", png: "PG",
    czechia: "CZ", "ivory coast": "CI", "cabo verde": "CV", "the gambia": "GM", "the netherlands": "NL",
    bosnia: "BA", "st lucia": "LC", eswatini: "SZ", "timor-leste": "TL", macedonia: "MK", "sao tome": "ST"
  };
  for (const [input, expected] of Object.entries(cases)) assert.equal(code(input), expected, input);
});

test("small typos are forgiven when one country is clearly closest", () => {
  assert.equal(code("Swizerland"), "CH");
  assert.equal(code("Phillipines"), "PH");
  assert.equal(code("Azerbajan"), "AZ");
  assert.equal(code("Kazakhstn"), "KZ");
  assert.equal(code("Guinea Bisau"), "GW");
});

test("fuzzy matching never turns one real country into another or guesses on short or ambiguous input", () => {
  assert.equal(code("Niger"), "NE");
  assert.equal(code("Nigeria"), "NG");
  assert.equal(code("Guinea"), "GN");
  assert.equal(code("Dominica"), "DM");
  assert.equal(code("Mali"), "ML");
  assert.equal(code("Oman"), "OM");
  assert.equal(code("Iran"), "IR");
  assert.equal(code("Chda"), null, "four-letter typos are not guessed");
  assert.equal(code("banana"), null);
  assert.equal(code(""), null);
});
