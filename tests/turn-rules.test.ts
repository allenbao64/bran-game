import assert from "node:assert/strict";
import { test } from "node:test";
import { allCountryFacts, countryFacts } from "@/lib/countries";
import {
  allCodes, cardFits, cardLabel, computeAwards, computeScores, dealCard, fittingCodes, isDoubleRound, largestConnectedGroup,
  pointsForRound, smallRegions, unclaimedCodes, type Card, type Claim
} from "@/lib/turn-rules";

const claim = (code: string, playerId: string, round = 1, points = 1): Claim => ({ code, playerId, points, round, turn: 0, at: 0 });
function seeded(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
}

test("each card type decides which countries fit", () => {
  assert.ok(cardFits({ kind: "letter", letter: "b" }, "BR"));
  assert.ok(!cardFits({ kind: "letter", letter: "B" }, "FR"));
  assert.ok(cardFits({ kind: "max", n: 5 }, "CU") && cardFits({ kind: "max", n: 5 }, "TD"), "Cuba and Chad have 5 or fewer letters");
  assert.ok(!cardFits({ kind: "max", n: 5 }, "BR"));
  assert.ok(!cardFits({ kind: "min", n: 9 }, "BR") && cardFits({ kind: "min", n: 9 }, "CI"), "Ivory Coast style names count letters only");
  assert.ok(cardFits({ kind: "continent", region: "Africa" }, "EG") && !cardFits({ kind: "continent", region: "Europe" }, "EG"));
  assert.ok(cardFits({ kind: "landlocked" }, "CH") && !cardFits({ kind: "landlocked" }, "JP"));
  assert.ok(cardFits({ kind: "border", country: "FR" }, "ES") && !cardFits({ kind: "border", country: "FR" }, "PT"));
  assert.ok(cardFits({ kind: "wild" }, "JP"));
  assert.ok(!cardFits({ kind: "wild" }, "ZZ"), "unknown codes never fit");
  assert.equal(cardLabel({ kind: "border", country: "FR" }), "Borders France");
  assert.equal(cardLabel({ kind: "max", n: 6 }), "Name has 6 letters or fewer");
});

test("letter counts ignore spaces and punctuation", () => {
  assert.equal(countryFacts("CI")!.letters, 10);
  assert.equal(countryFacts("NZ")!.letters, 10, "New Zealand");
  assert.equal(countryFacts("XK")!.region, "Europe", "Kosovo is part of the game list");
});

test("card dealing never deals a card with fewer than 3 unclaimed fits (except the wild fallback)", () => {
  const rng = seeded(7);
  const all = allCodes();
  for (let trial = 0; trial < 300; trial++) {
    // Leave a random share of the board unclaimed, from nothing to everything.
    const share = rng();
    const unclaimed = all.filter(() => rng() < share);
    const card = dealCard(unclaimed, rng);
    if (card.kind === "wild") continue;
    assert.ok(fittingCodes(card, unclaimed).length >= 3, `${cardLabel(card)} must have 3 unclaimed fits (had ${unclaimed.length} unclaimed)`);
  }
});

test("dealing falls back to wild when the board is nearly empty and deals all kinds on a fresh board", () => {
  assert.deepEqual(dealCard(["FR", "DE"], seeded(1)), { kind: "wild" });
  assert.deepEqual(dealCard([], seeded(1)), { kind: "wild" });
  const rng = seeded(42);
  const kinds = new Set<string>();
  let wild = 0;
  for (let i = 0; i < 600; i++) { const card = dealCard(allCodes(), rng); kinds.add(card.kind); if (card.kind === "wild") wild++; }
  assert.deepEqual([...kinds].sort(), ["border", "continent", "landlocked", "letter", "max", "min", "wild"]);
  assert.ok(wild > 30 && wild < 130, `about 1 in 10 cards should be wild, got ${wild}/600`);
});

test("size cards use the documented ranges", () => {
  const rng = seeded(3);
  for (let i = 0; i < 400; i++) {
    const card = dealCard(allCodes(), rng);
    if (card.kind === "max") assert.ok(card.n >= 5 && card.n <= 7);
    if (card.kind === "min") assert.ok(card.n >= 9 && card.n <= 11);
  }
});

test("claims are worth 1 point, or 2 during the last three rounds", () => {
  assert.equal(pointsForRound(1), 1);
  assert.equal(pointsForRound(9), 1);
  assert.equal(pointsForRound(10), 2);
  assert.equal(pointsForRound(12), 2);
  assert.ok(!isDoubleRound(9) && isDoubleRound(10));
  assert.equal(pointsForRound(2, 5), 1);
  assert.equal(pointsForRound(3, 5), 2, "total rounds shift the double-point window");
});

test("small regions are subregions with 6 or fewer game countries", () => {
  const names = smallRegions().map((region) => region.name);
  assert.ok(names.includes("Polynesia") && names.includes("Australia and New Zealand") && names.includes("Melanesia"));
  assert.ok(!names.includes("Western Africa"));
  for (const region of smallRegions()) assert.ok(region.codes.length <= 6);
  const total = allCountryFacts().filter((c) => smallRegions().some((r) => r.name === c.subregion)).length;
  assert.ok(total > 10);
});

test("owning every country in a small region is worth +2, and one missing country ruins it", () => {
  const anz = smallRegions().find((region) => region.name === "Australia and New Zealand")!.codes;
  assert.equal(anz.length, 2);
  const full = computeScores(["p1", "p2"], anz.map((code) => claim(code, "p1")));
  assert.equal(full.p1.points, 2);
  assert.deepEqual(full.p1.bonuses.map((b) => [b.kind, b.points]), [["region", 2]]);
  assert.equal(full.p1.total, 4);
  const split = computeScores(["p1", "p2"], [claim(anz[0], "p1"), claim(anz[1], "p2")]);
  assert.equal(split.p1.bonusTotal + split.p2.bonusTotal, 0);
  const partial = computeScores(["p1", "p2"], [claim(anz[0], "p1")]);
  assert.equal(partial.p1.bonusTotal, 0);
});

test("connected groups follow land borders", () => {
  assert.equal(largestConnectedGroup(["FR", "DE", "BE", "NL"]), 4);
  assert.equal(largestConnectedGroup(["FR", "JP", "BR"]), 1, "France and Brazil are not linked in the country data, Japan has no land borders");
  assert.equal(largestConnectedGroup(["ES", "JP", "KR"]), 1, "Japan has no land borders");
  assert.equal(largestConnectedGroup([]), 0);
});

test("largest territory needs 3+ connected countries and must strictly beat everyone", () => {
  const europe = ["FR", "DE", "BE", "NL"].map((c) => claim(c, "p1"));
  const small = ["ES", "PT"].map((c) => claim(c, "p2"));
  const scores = computeScores(["p1", "p2"], [...europe, ...small]);
  assert.equal(scores.p1.territory, 4);
  assert.ok(scores.p1.bonuses.some((b) => b.kind === "territory" && b.points === 2));
  assert.equal(scores.p2.bonusTotal, 0);

  const tie = computeScores(["p1", "p2"], [...europe, ...["TH", "MM", "LA", "KH"].map((c) => claim(c, "p2"))]);
  assert.equal(tie.p1.territory, 4);
  assert.equal(tie.p2.territory, 4);
  assert.equal(tie.p1.bonusTotal + tie.p2.bonusTotal, 0, "a tie gives nobody the bonus");

  const tooSmall = computeScores(["p1", "p2"], [claim("FR", "p1"), claim("DE", "p1"), claim("ES", "p2")]);
  assert.equal(tooSmall.p1.bonusTotal, 0, "a group of 2 is below the minimum of 3");

  const disconnected = computeScores(["p1", "p2"], ["ES", "JP", "BR"].map((c) => claim(c, "p1")));
  assert.equal(disconnected.p1.territory, 1);
  assert.equal(disconnected.p1.bonusTotal, 0);
});

test("final score is points (using the stored double points) plus bonuses", () => {
  const claims = [claim("FR", "p1", 1, 1), claim("DE", "p1", 11, 2), claim("BE", "p1", 12, 2), claim("NL", "p2", 12, 2)];
  const scores = computeScores(["p1", "p2"], claims);
  assert.equal(scores.p1.points, 5);
  assert.equal(scores.p1.territory, 3);
  assert.equal(scores.p1.bonuses.length, 1, "FR-DE-BE is 3 linked against 1");
  assert.equal(scores.p1.total, 7);
  assert.equal(scores.p2.total, 2);
});

test("awards: first claim, biggest territory and comeback", () => {
  const claims: Claim[] = [
    claim("JP", "p2", 1), claim("BR", "p1", 1), claim("AR", "p1", 2), claim("PE", "p1", 3),
    // second half: p2 comes back with more points, p1 stays flat
    ...["CA", "AU", "EG", "KR", "IN", "CN", "ZA", "NG", "MX", "ID", "TR"].map((c, i) => claim(c, "p2", 7 + (i % 6), 2))
  ];
  const awards = computeAwards(["p1", "p2"], claims, 12);
  assert.deepEqual(awards.map((a) => a.id).sort(), ["comeback", "first", "territory"]);
  assert.equal(awards.find((a) => a.id === "first")!.playerId, "p2");
  assert.equal(awards.find((a) => a.id === "comeback")!.playerId, "p2");
  assert.equal(computeAwards(["p1", "p2"], [], 12).length, 0);

  const noComeback = computeAwards(["p1", "p2"], [claim("JP", "p1", 1), claim("BR", "p2", 7)], 12);
  assert.ok(!noComeback.some((a) => a.id === "comeback"), "a leader from the start is not a comeback");
  const terr = computeAwards(["p1", "p2"], ["FR", "DE", "BE"].map((c) => claim(c, "p1")), 12);
  assert.ok(terr.some((a) => a.id === "territory" && a.playerId === "p1"));
});

test("unclaimedCodes removes claimed countries", () => {
  assert.equal(unclaimedCodes([{ code: "FR" }, { code: "DE" }]).length, allCodes().length - 2);
  const card: Card = { kind: "continent", region: "Oceania" };
  assert.ok(fittingCodes(card, allCodes()).includes("AU"));
});
