import assert from "node:assert/strict";
import test from "node:test";
import { allCountryFacts, countryFacts } from "@/lib/countries";
import { cards } from "@/lib/empire/cards";
import { EMPIRE_RULES, type CardContext, type DealContext, type EmpireCard, type EmpireEvent, type Rng } from "@/lib/empire/types";

const { cardFits, cardLabel, dealHand, drawEvent, eventLabel } = cards;

function mulberry32(seed: number): Rng {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Small symmetric land-border map for the card-kind tests.
const FAKE_BORDERS: Record<string, string[]> = {
  FR: ["ES", "DE", "IT", "BE"],
  ES: ["FR", "PT"],
  DE: ["FR", "BE"],
  IT: ["FR"],
  BE: ["FR", "DE"],
  PT: ["ES"]
};
const fakeNeighbours = (code: string) => FAKE_BORDERS[code] ?? [];
const ctxOwning = (...owned: string[]): CardContext => ({ ownedByMe: new Set(owned), neighbours: fakeNeighbours });

// Real land borders for the deal tests.
const realNeighbours = (code: string) => countryFacts(code)?.borders ?? [];
const ALL_CODES = allCountryFacts().map((f) => f.code);
const AFRICA = allCountryFacts().filter((f) => f.region === "Africa").map((f) => f.code);

function dealCtx(seed: number, unclaimed: string[], event: EmpireEvent | null = null, owned: string[] = ["FR"]): DealContext {
  return { ownedByMe: new Set(owned), neighbours: realNeighbours, unclaimed, event, rng: mulberry32(seed) };
}

function cardKey(card: EmpireCard) {
  return JSON.stringify(card);
}

function fitCount(card: EmpireCard, codes: string[], ctx: DealContext) {
  return codes.filter((code) => cardFits(card, code, ctx)).length;
}

test("letter cards match the first letter of the country name", () => {
  assert.equal(cardFits({ kind: "letter", letter: "B" }, "BR", ctxOwning()), true);
  assert.equal(cardFits({ kind: "letter", letter: "B" }, "JP", ctxOwning()), false);
});

test("short cards allow up to max letters", () => {
  assert.equal(cardFits({ kind: "short", max: 5 }, "JP", ctxOwning()), true);
  assert.equal(cardFits({ kind: "short", max: 5 }, "BR", ctxOwning()), false);
});

test("long cards need at least min letters", () => {
  assert.equal(cardFits({ kind: "long", min: 9 }, "AF", ctxOwning()), true);
  assert.equal(cardFits({ kind: "long", min: 9 }, "ID", ctxOwning()), true);
  assert.equal(cardFits({ kind: "long", min: 9 }, "JP", ctxOwning()), false);
});

test("continent cards match the continent", () => {
  assert.equal(cardFits({ kind: "continent", continent: "Africa" }, "NG", ctxOwning()), true);
  assert.equal(cardFits({ kind: "continent", continent: "Africa" }, "JP", ctxOwning()), false);
});

test("region cards match the subregion, falling back to the continent", () => {
  assert.equal(cardFits({ kind: "region", region: "South-Eastern Asia" }, "ID", ctxOwning()), true);
  assert.equal(cardFits({ kind: "region", region: "South-Eastern Asia" }, "JP", ctxOwning()), false);
  assert.equal(cardFits({ kind: "region", region: "Western Europe" }, "FR", ctxOwning()), true);
});

test("landlocked cards match landlocked countries only", () => {
  assert.equal(cardFits({ kind: "landlocked" }, "BO", ctxOwning()), true);
  assert.equal(cardFits({ kind: "landlocked" }, "JP", ctxOwning()), false);
});

test("island cards match countries with no land borders", () => {
  assert.equal(cardFits({ kind: "island" }, "JP", ctxOwning()), true);
  assert.equal(cardFits({ kind: "island" }, "BR", ctxOwning()), false);
});

test("bordersYou matches countries next to one you own", () => {
  assert.equal(cardFits({ kind: "bordersYou" }, "ES", ctxOwning("FR")), true);
  assert.equal(cardFits({ kind: "bordersYou" }, "PT", ctxOwning("FR")), false);
  assert.equal(cardFits({ kind: "bordersYou" }, "ES", ctxOwning()), false);
});

test("bordersCountry matches neighbours of the named country, never the country itself", () => {
  const card: EmpireCard = { kind: "bordersCountry", country: "FR" };
  assert.equal(cardFits(card, "ES", ctxOwning()), true);
  assert.equal(cardFits(card, "FR", ctxOwning()), false);
  assert.equal(cardFits(card, "PT", ctxOwning()), false);
});

test("wild fits every known country and unknown codes never fit", () => {
  assert.equal(cardFits({ kind: "wild" }, "JP", ctxOwning()), true);
  assert.equal(cardFits({ kind: "wild" }, "XX", ctxOwning()), false);
  assert.equal(cardFits({ kind: "letter", letter: "X" }, "XX", ctxOwning()), false);
  assert.equal(cardFits({ kind: "island" }, "ZZ", ctxOwning()), false);
});

test("card labels are plain English", () => {
  assert.equal(cardLabel({ kind: "letter", letter: "B" }), "Starts with B");
  assert.equal(cardLabel({ kind: "short", max: 5 }), "5 letters or fewer");
  assert.equal(cardLabel({ kind: "long", min: 10 }), "10 letters or more");
  assert.equal(cardLabel({ kind: "continent", continent: "Africa" }), "In Africa");
  assert.equal(cardLabel({ kind: "region", region: "South-Eastern Asia" }), "In South-Eastern Asia");
  assert.equal(cardLabel({ kind: "landlocked" }), "Landlocked");
  assert.equal(cardLabel({ kind: "island" }), "Island nation");
  assert.equal(cardLabel({ kind: "bordersYou" }), "Borders a country you own");
  assert.equal(cardLabel({ kind: "bordersCountry", country: "BR" }), "Borders Brazil");
  assert.equal(cardLabel({ kind: "wild" }), "Any country");
});

test("over 500 seeded deals, every non-wild card fits enough unclaimed countries and hands have no duplicates", () => {
  const small = ALL_CODES.filter((_, i) => i % 9 === 0);
  for (const unclaimed of [ALL_CODES, small]) {
    for (let seed = 1; seed <= 500; seed++) {
      const count = 2 + (seed % 2);
      const hand = dealHand(count, dealCtx(seed, unclaimed));
      assert.ok(hand.length >= 1 && hand.length <= count, `seed ${seed}: hand of ${hand.length}`);
      if (unclaimed === ALL_CODES) assert.equal(hand.length, count, `a full board always deals a full hand (seed ${seed})`);
      const keys = hand.filter((c) => c.kind !== "wild").map(cardKey);
      assert.equal(new Set(keys).size, keys.length, `duplicate card in seed ${seed}`);
      assert.ok(hand.filter((c) => c.kind === "wild").length <= 1, `two wilds in seed ${seed}`);
      for (const card of hand) {
        if (card.kind === "wild") continue;
        assert.ok(fitCount(card, unclaimed, dealCtx(seed, unclaimed)) >= EMPIRE_RULES.minFits,
          `${cardKey(card)} fits too few countries (seed ${seed})`);
      }
    }
  }
});

test("a deal is deterministic for a seeded rng", () => {
  assert.deepEqual(dealHand(3, dealCtx(42, ALL_CODES)), dealHand(3, dealCtx(42, ALL_CODES)));
});

test("a nearly empty unclaimed list falls back to a single wild, never two identical wilds", () => {
  const none = dealHand(2, dealCtx(7, []));
  assert.deepEqual(none, [{ kind: "wild" }]);
  const one = dealHand(2, dealCtx(7, ["FR"]));
  assert.deepEqual(one, [{ kind: "wild" }]);
  assert.deepEqual(dealHand(3, dealCtx(7, ["FR"])), [{ kind: "wild" }]);
});

test("wildRound deals only wild cards", () => {
  const hand = dealHand(3, dealCtx(3, ALL_CODES, { kind: "wildRound" }));
  assert.deepEqual(hand, [{ kind: "wild" }, { kind: "wild" }, { kind: "wild" }]);
});

test("closedContinent never deals that continent and does not count its countries as fitting", () => {
  const event: EmpireEvent = { kind: "closedContinent", continent: "Africa" };
  const open = ALL_CODES.filter((code) => !AFRICA.includes(code));
  for (let seed = 1; seed <= 500; seed++) {
    const hand = dealHand(2, dealCtx(seed, ALL_CODES, event));
    for (const card of hand) {
      if (card.kind === "wild") continue;
      assert.notEqual(card.kind === "continent" && card.continent === "Africa", true, `seed ${seed}`);
      assert.notEqual(card.kind === "region" && card.region === "Western Africa", true, `seed ${seed}`);
      assert.ok(fitCount(card, open, dealCtx(seed, open)) >= EMPIRE_RULES.minFits, `${cardKey(card)} seed ${seed}`);
    }
  }
});

test("closedContinent with only that continent left unclaimed falls back to wild", () => {
  const event: EmpireEvent = { kind: "closedContinent", continent: "Africa" };
  const hand = dealHand(2, dealCtx(11, AFRICA, event));
  assert.ok(hand.every((c) => c.kind === "wild"));
});

test("drawEvent covers all five event kinds across many draws", () => {
  const rng = mulberry32(99);
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const event = drawEvent(rng, ["Africa", "Asia", "Europe"]);
    seen.add(event.kind);
    if (event.kind === "closedContinent") assert.ok(["Africa", "Asia", "Europe"].includes(event.continent ?? ""));
    else assert.equal(event.continent, undefined);
  }
  assert.deepEqual([...seen].sort(), ["ceasefire", "closedContinent", "freeSteals", "goldRush", "wildRound"]);
});

test("event labels", () => {
  assert.equal(eventLabel({ kind: "goldRush" }), "Gold rush: claims are worth 2 points");
  assert.equal(eventLabel({ kind: "ceasefire" }), "Ceasefire: no steals");
  assert.equal(eventLabel({ kind: "freeSteals" }), "Free steals: steals cost no token");
  assert.equal(eventLabel({ kind: "closedContinent", continent: "Asia" }), "Closed: Asia can't be claimed");
  assert.equal(eventLabel({ kind: "wildRound" }), "Wild round: every card is Any country");
});
