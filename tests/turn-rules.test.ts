import assert from "node:assert/strict";
import { test } from "node:test";
import { allCountryFacts, countryFacts } from "@/lib/countries";
import { countryStat } from "@/lib/country-stats";
import {
  allCodes, cardFits, DEALT_KINDS, fitBand, MAX_FIT, MIN_FIT, RECENT_CARDS, WILD_RATE, pickStartCountries, isStartClaim, claimRegionNote, regionProgress, cardLabel, computeAwards, computeScores, dealCard, fittingCodes, isDoubleRound, largestConnectedGroup,
  pointsForRound, smallRegions, unclaimedCodes, regionBonusPoints, largestConnectedGroupCodes, largestGroupsByPlayer, TURN_SPEEDS, isTurnSeconds, TURN_ROUND_OPTIONS, DEFAULT_TURN_ROUNDS, LEGACY_TURN_ROUNDS, isTurnRounds, type Card, type Claim
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

test("card dealing never deals a card outside the fit band (except wild)", () => {
  const rng = seeded(7);
  const all = allCodes();
  for (let trial = 0; trial < 300; trial++) {
    // Leave a random share of the board unclaimed, from nothing to everything.
    const share = rng();
    const unclaimed = all.filter(() => rng() < share);
    const card = dealCard(unclaimed, rng);
    if (card.kind === "wild") continue;
    const fits = fittingCodes(card, unclaimed).length;
    const band = fitBand(unclaimed.length);
    assert.ok(fits >= band.min && fits <= band.max, `${cardLabel(card)} fits ${fits}, band ${band.min}-${band.max} (${unclaimed.length} unclaimed)`);
  }
});

test("dealing falls back to wild when the board is nearly empty and deals all kinds on a fresh board", () => {
  assert.deepEqual(dealCard(["FR", "DE"], seeded(1)), { kind: "wild" });
  assert.deepEqual(dealCard([], seeded(1)), { kind: "wild" });
  const rng = seeded(42);
  const kinds = new Set<string>();
  let wild = 0;
  for (let i = 0; i < 600; i++) { const card = dealCard(allCodes(), rng); kinds.add(card.kind); if (card.kind === "wild") wild++; }
  assert.deepEqual([...kinds].sort(), [...DEALT_KINDS, "wild"].sort());
  assert.ok(wild < 45, `wild is rare, got ${wild}/600`);
});

test("name-length cards stay in their ranges", () => {
  const rng = seeded(3);
  for (let i = 0; i < 400; i++) {
    const card = dealCard(allCodes(), rng);
    if (card.kind === "max") assert.ok(card.n >= 4 && card.n <= 9);
    if (card.kind === "min") assert.ok(card.n >= 8 && card.n <= 13);
  }
});

test("claims are worth 1 point, or 2 during the last three rounds", () => {
  assert.equal(pointsForRound(1, 12), 1);
  assert.equal(pointsForRound(9, 12), 1);
  assert.equal(pointsForRound(10, 12), 2);
  assert.equal(pointsForRound(12, 12), 2);
  assert.ok(!isDoubleRound(9, 12) && isDoubleRound(10, 12));
  for (const total of TURN_ROUND_OPTIONS) {
    assert.equal(pointsForRound(total - 3, total), 1, `${total} rounds: round ${total - 3} is single`);
    assert.deepEqual([total - 2, total - 1, total].map((round) => pointsForRound(round, total)), [2, 2, 2], `${total} rounds: the last three are double`);
  }
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

test("owning every country in a small region is worth size - 1 (max 4), and one missing country ruins it", () => {
  const anz = smallRegions().find((region) => region.name === "Australia and New Zealand")!.codes;
  assert.equal(anz.length, 2);
  const full = computeScores(["p1", "p2"], anz.map((code) => claim(code, "p1")));
  assert.equal(full.p1.points, 2);
  assert.deepEqual(full.p1.bonuses.map((b) => [b.kind, b.points]), [["region", 1]], "a 2-country region pays +1");
  assert.equal(full.p1.total, 3);
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

test("region bonus scales with region size: 2 -> +1, 3 -> +2, 4 -> +3, 5 or 6 -> +4", () => {
  assert.deepEqual([2, 3, 4, 5, 6].map(regionBonusPoints), [1, 2, 3, 4, 4]);
  for (const region of smallRegions()) {
    const expected = Math.min(region.codes.length - 1, 4);
    const scores = computeScores(["p1", "p2"], region.codes.map((code) => claim(code, "p1")));
    const bonus = scores.p1.bonuses.find((b) => b.kind === "region" && b.label === `Owns all of ${region.name}`);
    assert.equal(bonus?.points, expected, `${region.name} (${region.codes.length} countries)`);
  }
  const names = Object.fromEntries(smallRegions().map((r) => [r.name, r.codes]));
  const sizes = Object.fromEntries(Object.entries(names).map(([n, c]) => [n, c.length]));
  assert.equal(sizes["Australia and New Zealand"], 2);
  assert.equal(sizes["Polynesia"], 3);
  assert.equal(sizes["Eastern Europe"], 4);
  assert.equal(sizes["Central Asia"], 5);
  assert.equal(sizes["Central Europe"], 6);
});

test("the largest-territory bonus stays at +2", () => {
  const scores = computeScores(["p1", "p2"], ["FR", "DE", "BE"].map((c) => claim(c, "p1")));
  assert.equal(scores.p1.bonuses.find((b) => b.kind === "territory")!.points, 2);
});

test("wild cards are a rare draw on a full board (seeded, 10,000 draws)", () => {
  const rng = seeded(12345);
  const all = allCodes();
  let wild = 0;
  for (let i = 0; i < 10_000; i++) if (dealCard(all, rng).kind === "wild") wild++;
  const rate = wild / 10_000;
  assert.ok(rate >= WILD_RATE * 0.6 && rate <= WILD_RATE * 1.4, `wild rate should be about ${WILD_RATE * 100}%, got ${(rate * 100).toFixed(2)}%`);
});

test("late in the game wild stays rare because the band relaxes instead of falling back", () => {
  const rng = seeded(5);
  const few = allCodes().filter((_, i) => i % 10 === 0);
  let wild = 0;
  for (let i = 0; i < 5_000; i++) if (dealCard(few, rng).kind === "wild") wild++;
  assert.ok(wild / 5_000 < 0.08, `got ${(wild / 50).toFixed(1)}%`);
});

test("wild is only a fallback when no other card can be dealt", () => {
  // Never roll wild (rng always high) but only two countries remain: nothing fits the minimum, so wild is the fallback.
  assert.deepEqual(dealCard(["FR", "DE"], () => 0.99), { kind: "wild" });
  // The same constant rng on a full board always deals a real card, never wild.
  const card = dealCard(allCodes(), () => 0.5);
  assert.notEqual(card.kind, "wild");
  assert.ok(fittingCodes(card, allCodes()).length >= MIN_FIT);
  // A low first roll is the intentional wild draw.
  const rolls = [0.01];
  assert.deepEqual(dealCard(allCodes(), () => rolls.shift() ?? 0.5), { kind: "wild" });
});

test("largest connected group codes and the per-player helper", () => {
  assert.deepEqual(largestConnectedGroupCodes(["FR", "DE", "BE", "NL", "JP"]).sort(), ["BE", "DE", "FR", "NL"]);
  assert.deepEqual(largestConnectedGroupCodes([]), []);
  assert.equal(largestConnectedGroupCodes(["FR", "DE", "BE", "NL", "JP"]).length, largestConnectedGroup(["FR", "DE", "BE", "NL", "JP"]));
  const claims = [...["FR", "DE", "BE", "JP"].map((c) => claim(c, "p1")), ...["ES", "PT"].map((c) => claim(c, "p2"))];
  const groups = largestGroupsByPlayer(["p1", "p2", "p3"], claims);
  assert.deepEqual(groups.p1, ["BE", "DE", "FR"], "the island of Japan is not part of the group");
  assert.deepEqual(groups.p2, ["ES", "PT"]);
  assert.deepEqual(groups.p3, [], "players with no claims have no group");
});

test("turn speeds are 10, 15 and 25 seconds", () => {
  assert.deepEqual(TURN_SPEEDS.map((s) => [s.label, s.seconds]), [["Blitz", 10], ["Standard", 15], ["Relaxed", 25]]);
  assert.ok(isTurnSeconds(10) && isTurnSeconds(15) && isTurnSeconds(25));
  assert.ok(!isTurnSeconds(20) && !isTurnSeconds("15") && !isTurnSeconds(undefined));
});

test("round counts are 15, 20 or 30 with 20 as the default, and old rooms keep 12", () => {
  assert.deepEqual([...TURN_ROUND_OPTIONS], [15, 20, 30]);
  assert.equal(DEFAULT_TURN_ROUNDS, 20);
  assert.equal(LEGACY_TURN_ROUNDS, 12);
  for (const good of [15, 20, 30]) assert.ok(isTurnRounds(good));
  for (const bad of [12, 0, 25, "20", 20.5, null, undefined, true]) assert.equal(isTurnRounds(bad), false, `rejects ${JSON.stringify(bad)}`);
});

test("late in the longest game every card still has an answer: 90 claims leave plenty of countries and dealt cards fit at least 3 or are wild", () => {
  const all = allCodes();
  assert.ok(all.length - 90 >= 100, "30 rounds x 3 players cannot exhaust the country list");
  const rng = seeded(21);
  // Claim 89 random countries in a shuffled order, dealing a card at each step.
  const order = [...all].sort(() => rng() - 0.5);
  for (let claimed = 0; claimed < 90; claimed += 1) {
    const unclaimed = order.slice(claimed);
    const card = dealCard(unclaimed, rng);
    if (card.kind !== "wild") assert.ok(fittingCodes(card, unclaimed).length >= fitBand(unclaimed.length).min, `${card.kind} card with ${claimed} claimed`);
  }
});

test("region progress counts each player's share and marks split regions as blocked", () => {
  const byName = (claims: Record<string, string>) => Object.fromEntries(regionProgress(claims).map((region) => [region.name, region]));
  const fresh = byName({});
  assert.equal(Object.keys(fresh).length, 11);
  assert.deepEqual([fresh["Australia and New Zealand"].points, fresh["North America"].points, fresh["Central Asia"].points], [1, 2, 4]);
  assert.equal(fresh["Central Asia"].status, "open");
  const some = byName({ KZ: "p1", UZ: "p1", US: "p1", CA: "p2", AU: "p2", NZ: "p2" });
  assert.deepEqual(some["Central Asia"].owned, { p1: 2 });
  assert.equal(some["Central Asia"].status, "open");
  assert.equal(some["North America"].status, "blocked");
  assert.equal(some["Australia and New Zealand"].status, "won");
  assert.equal(some["Australia and New Zealand"].winner, "p2");
});

test("a claim note says what the country did for its region", () => {
  assert.equal(claimRegionNote({}, "KZ", "p1"), "Kazakhstan: 1 of 5 in Central Asia (+4).");
  assert.equal(claimRegionNote({ AU: "p1" }, "NZ", "p1"), "New Zealand: you own all of Australia and New Zealand. +1");
  assert.equal(claimRegionNote({ US: "p2" }, "CA", "p1"), "Canada: North America is split, so no one gets its +2.");
  assert.equal(claimRegionNote({}, "FR", "p1"), "France: not in a bonus region.");
});

const seededGame = (seed: number) => {
  const rng = seeded(seed);
  return { rng, players: ["a", "b", "c"], pickClaim: (fits: string[], unclaimed: string[]) => (fits.length ? fits : unclaimed)[Math.floor(rng() * (fits.length || unclaimed.length))] };
};

test("simulation: every non-wild card fits the band, kinds are spread, and kinds never repeat in a row", () => {
  const kinds = new Map<string, number>();
  const fitCounts: number[] = [];
  let deals = 0, repeats = 0;
  for (let game = 0; game < 120; game++) {
    const { rng, pickClaim } = seededGame(1000 + game);
    let unclaimed = allCodes();
    let recent: Card[] = [];
    // Start with a random share of the board already gone, then play it down the way a game does.
    unclaimed = unclaimed.filter(() => rng() > (game % 4) * 0.2);
    while (unclaimed.length) {
      const card = dealCard(unclaimed, rng, recent);
      deals++;
      kinds.set(card.kind, (kinds.get(card.kind) ?? 0) + 1);
      if (recent[0] && recent[0].kind === card.kind) { repeats++; assert.ok(unclaimed.length < 40, `${card.kind} repeated with ${unclaimed.length} left`); }
      assert.ok(!recent.slice(0, RECENT_CARDS).some((old) => cardLabel(old) === cardLabel(card)) || card.kind === "wild", `${cardLabel(card)} repeated inside the last ${RECENT_CARDS} deals`);
      const fits = fittingCodes(card, unclaimed);
      if (card.kind !== "wild") {
        const band = fitBand(unclaimed.length);
        assert.ok(fits.length >= band.min && fits.length <= band.max, `${cardLabel(card)}: ${fits.length} fit, band ${band.min}-${band.max}`);
        if (unclaimed.length >= 100) assert.ok(fits.length >= MIN_FIT && fits.length <= MAX_FIT);
        fitCounts.push(fits.length);
      }
      recent = [card, ...recent].slice(0, RECENT_CARDS);
      const take = pickClaim(fits, unclaimed);
      unclaimed = unclaimed.filter((code) => code !== take);
    }
  }
  for (const [kind, count] of kinds) if (kind !== "wild") assert.ok(count / deals <= 0.25, `${kind} is ${((count / deals) * 100).toFixed(1)}% of deals`);
  for (const kind of DEALT_KINDS) assert.ok((kinds.get(kind) ?? 0) > 0, `${kind} is dealt`);
  assert.ok((kinds.get("wild") ?? 0) / deals < 0.08);
  assert.ok(repeats / deals < 0.02, `${repeats} consecutive repeats in ${deals} deals`);
});

test("new cards decide fits from the data, and countries without data never fit numeric cards", () => {
  assert.ok(cardFits({ kind: "borders", countries: ["ES", "DE"] }, "FR") && cardFits({ kind: "borders", countries: ["ES", "DE"] }, "PT"));
  assert.ok(!cardFits({ kind: "borders", countries: ["ES", "DE"] }, "JP") && !cardFits({ kind: "borders", countries: ["JP"] }, "KR"), "island nations have no land borders");
  assert.ok(cardFits({ kind: "neighbours", n: 0 }, "JP") && !cardFits({ kind: "neighbours", n: 0 }, "FR"));
  assert.ok(!cardFits({ kind: "neighbours", n: 10 }, "DE") && cardFits({ kind: "neighbours", n: 10 }, "CN") && cardFits({ kind: "neighbours", n: 2 }, "DE"));
  assert.ok(cardFits({ kind: "area", dir: "over", n: 1_000_000 }, "BR") && cardFits({ kind: "area", dir: "under", n: 1000 }, "MC"));
  assert.ok(cardFits({ kind: "population", dir: "over", n: 100_000_000 }, "JP") && !cardFits({ kind: "population", dir: "over", n: 100_000_000 }, "NO"));
  assert.ok(cardFits({ kind: "gdp", dir: "over", n: 1e12 }, "DE") && cardFits({ kind: "gdp", dir: "under", n: 1e9 }, "TV"));
  assert.ok(cardFits({ kind: "gdpPerCapita", dir: "over", n: 50_000 }, "CH") && cardFits({ kind: "gdpPerCapita", dir: "under", n: 1_500 }, "SS"));
  for (const code of ["KP", "TW", "VA"]) {
    assert.ok(!cardFits({ kind: "gdp", dir: "over", n: 1 }, code) && !cardFits({ kind: "gdp", dir: "under", n: 1e15 }, code), `${code} has no GDP`);
  }
  assert.ok(!cardFits({ kind: "population", dir: "under", n: 1e12 }, "TW") && !cardFits({ kind: "population", dir: "under", n: 1e12 }, "VA"));
  assert.ok(cardFits({ kind: "language", language: "French" }, "FR") && !cardFits({ kind: "language", language: "French" }, "DE"));
  assert.ok(cardFits({ kind: "timezones", multiple: true }, "US") && cardFits({ kind: "timezones", multiple: false }, "DE") && !cardFits({ kind: "timezones", multiple: true }, "DE"));
});

test("flag colours are right for well-known flags", () => {
  const colours = (code: string) => [...countryStat(code)!.flagColours].sort();
  assert.deepEqual(colours("JP"), ["red", "white"]);
  assert.deepEqual(colours("DE"), ["black", "red", "yellow"]);
  assert.deepEqual(colours("BR"), ["blue", "green", "white", "yellow"]);
  assert.deepEqual(colours("CA"), ["red", "white"]);
  assert.deepEqual(colours("SE"), ["blue", "yellow"]);
  assert.deepEqual(colours("IE"), ["green", "orange", "white"]);
  assert.ok(cardFits({ kind: "flag", colour: "red", has: true }, "JP") && !cardFits({ kind: "flag", colour: "red", has: false }, "JP"));
  assert.ok(cardFits({ kind: "flag", colour: "blue", has: false }, "JP"));
  assert.ok(!cardFits({ kind: "flag", colour: "green", has: true }, "ZZ") && !cardFits({ kind: "flag", colour: "green", has: false }, "ZZ"), "unknown codes fit neither side");
});

test("the stats file covers every game country, with missing values left null", () => {
  for (const country of allCountryFacts()) {
    const stat = countryStat(country.code);
    assert.ok(stat, `${country.code} has stats`);
    assert.ok(stat!.flagColours.length >= 1);
  }
  assert.equal(countryStat("TW")!.gdpUsd, null);
  assert.ok(countryStat("DE")!.population! > 80_000_000);
  assert.equal(countryStat("zz"), null);
});

test("labels are plain and say what they test", () => {
  assert.equal(cardLabel({ kind: "borders", countries: ["ES", "DE"] }), "Shares a land border with Spain or Germany");
  assert.equal(cardLabel({ kind: "borders", countries: ["ES", "DE", "PE"] }), "Shares a land border with Spain, Germany or Peru");
  assert.equal(cardLabel({ kind: "neighbours", n: 0 }), "Has no land neighbours (island or isolated)");
  assert.equal(cardLabel({ kind: "neighbours", n: 4 }), "Has 4 or more land neighbours");
  assert.equal(cardLabel({ kind: "area", dir: "over", n: 100_000 }), "Area over 100,000 km²");
  assert.equal(cardLabel({ kind: "population", dir: "under", n: 25_000_000 }), "Population under 25 million");
  assert.equal(cardLabel({ kind: "gdp", dir: "over", n: 1e12 }), "GDP over $1 trillion");
  assert.equal(cardLabel({ kind: "gdp", dir: "under", n: 5e8 }), "GDP under $500 million");
  assert.equal(cardLabel({ kind: "gdpPerCapita", dir: "over", n: 10_000 }), "GDP per capita over $10,000");
  assert.equal(cardLabel({ kind: "language", language: "Spanish" }), "Spanish is an official language");
  assert.equal(cardLabel({ kind: "flag", colour: "red", has: true }), "Flag has red");
  assert.equal(cardLabel({ kind: "flag", colour: "green", has: false }), "Flag has no green");
  assert.equal(cardLabel({ kind: "timezones", multiple: true }), "Spans more than one time zone");
  assert.equal(cardLabel({ kind: "timezones", multiple: false }), "Has a single time zone");
});

test("the fit band relaxes as the board empties and never drops below 3", () => {
  assert.deepEqual(fitBand(197), { min: MIN_FIT, max: MAX_FIT });
  assert.deepEqual(fitBand(100), { min: MIN_FIT, max: MAX_FIT });
  for (let left = 1; left <= 197; left++) {
    const band = fitBand(left);
    assert.ok(band.min >= 3 && band.max >= band.min && band.max <= MAX_FIT && band.min <= MIN_FIT);
  }
});

test("starting countries: land-linked, not islands, different subregions, far apart", () => {
  for (let seed = 1; seed <= 100; seed++) {
    for (const count of [2, 3]) {
      const starts = pickStartCountries(count, seeded(seed));
      assert.equal(new Set(starts).size, count);
      const facts = starts.map((code) => countryFacts(code)!);
      for (const country of facts) assert.ok(country.borders.length >= 2, `${country.name} has 2+ land neighbours`);
      assert.equal(new Set(facts.map((country) => country.subregion)).size, count, "one start per subregion");
    }
  }
  assert.ok(isStartClaim({ round: 0 }) && !isStartClaim({ round: 1 }));
});

test("starting claims score nothing but count for territory and are skipped by the first-claim award", () => {
  const start = { ...claim("DE", "p1", 0, 0), turn: -1 };
  const claims = [start, claim("FR", "p1"), claim("BE", "p1"), { ...claim("JP", "p2", 0, 0), turn: -1 }, claim("ES", "p2")];
  const scores = computeScores(["p1", "p2"], claims);
  assert.equal(scores.p1.points, 2, "the start is worth 0");
  assert.equal(scores.p1.territory, 3, "but it links DE, FR and BE");
  assert.equal(computeAwards(["p1", "p2"], claims, 20).find((award) => award.id === "first")!.detail, "Opened the board with France");
});
