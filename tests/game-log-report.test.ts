import assert from "node:assert/strict";
import { test } from "node:test";
import type { GameLog, LogCard, TurnLogEvent, WrongGuessEvent } from "@/lib/game-log";
import { aggregateGames, COMEBACK_POINTS, formatReport, toJsonLines } from "@/lib/game-log-report";

const START_AT = 1_800_000_000_000;

function turn(n: number, over: Partial<TurnLogEvent>): TurnLogEvent {
  return { t: "turn", n, round: 1, sudden: false, pid: "pa", outcome: "pass", ms: 1000, at: START_AT + n * 1000, unclaimed: 188, deal: null, fitBoth: null, ...over };
}

/** The hand-written game from the spec: 2 players, 2 rounds, one sudden-death round. */
function fixtureGame(): GameLog {
  const turns: TurnLogEvent[] = [
    turn(0, {
      round: 1, pid: "pa", outcome: "claim", ms: 6200, at: START_AT + 6200, unclaimed: 188,
      deal: [{ kind: "letter", label: "starts with S", fit: 12 }, { kind: "population", label: "over 10 million", fit: 30 }], fitBoth: 4,
      claim: { code: "KE", points: 3, fit: 2, both: true, hit: [0, 1] },
    }),
    turn(1, {
      round: 1, pid: "pb", outcome: "pass", ms: 2500, at: START_AT + 3500, unclaimed: 187,
      deal: [{ kind: "flag", label: "red flag", fit: 25 }, { kind: "landlocked", label: "landlocked", fit: 14 }], fitBoth: 3,
      totals: { pa: 3, pb: 0 },
    }),
    turn(2, {
      round: 2, pid: "pa", outcome: "timeout", ms: 10000, at: START_AT + 13500,
      deal: [{ kind: "continent", label: "in Europe", fit: 40 }, { kind: "neighbours", label: "3 neighbours or more", fit: 30 }], fitBoth: 18,
    }),
    turn(3, {
      round: 2, pid: "pb", outcome: "claim", ms: 8000, at: START_AT + 21500,
      deal: [{ kind: "letter", label: "starts with S", fit: 12 }, { kind: "flag", label: "red flag", fit: 30 }], fitBoth: 5,
      claim: { code: "SE", points: 3, fit: 2, both: true, hit: [0, 1] }, totals: { pa: 3, pb: 3 },
    }),
    turn(4, {
      round: 3, sudden: true, pid: "pa", outcome: "timeout", ms: 10000, at: START_AT + 31500,
      deal: [{ kind: "min", label: "at least 8 letters", fit: 15 }, { kind: "language", label: "speaks French", fit: 20 }],
      fitBoth: 4,
    }),
    turn(5, {
      round: 3, sudden: true, pid: "pb", outcome: "claim", ms: 3100, at: START_AT + 34600,
      deal: [{ kind: "letter", label: "starts with S", fit: 14 }, { kind: "flag", label: "red flag", fit: 22 }], fitBoth: 4,
      claim: { code: "SN", points: 1, fit: 1, both: false, hit: [0] }, totals: { pa: 3, pb: 4 },
    }),
  ];
  const wrong: WrongGuessEvent[] = [
    { t: "wrong", n: 0, round: 1, sudden: false, pid: "pa", code: "FR", why: "no_fit", kinds: ["letter", "population"], ms: 4000, at: START_AT + 4000 },
  ];
  return {
    logId: "AAAAAA-1800000000000",
    start: {
      t: "start", v: 1, logId: "AAAAAA-1800000000000", room: "AAAAAA", startedAt: START_AT, mode: "turns", turnSeconds: 10, rounds: 2,
      players: [{ id: "pa", name: "Ann", host: true }, { id: "pb", name: "Bo", host: false }],
      startCountries: { pa: "FR", pb: "DE" },
    },
    turns,
    wrong,
    end: {
      t: "end", endedAt: START_AT + 100_000, reason: "turns_played", turnsPlayed: 6, suddenRounds: 1, winners: ["pb"],
      scores: {
        pa: { points: 2, bonus: 1, total: 3, territory: 0 },
        pb: { points: 3, bonus: 1, total: 4, territory: 0 },
      },
      durationMs: 100_000,
    },
    badFields: 0,
  };
}

const withTurns = (game: GameLog, turns: TurnLogEvent[]): GameLog => ({ ...game, turns });

/** Walks every value of an object and reports any NaN number. */
function containsNaN(value: unknown): boolean {
  if (typeof value === "number") return Number.isNaN(value);
  if (Array.isArray(value)) return value.some(containsNaN);
  if (value && typeof value === "object") return Object.values(value).some(containsNaN);
  return false;
}

test("fixture game: turn and outcome counts", () => {
  const report = aggregateGames([fixtureGame()]);
  assert.equal(report.games, 1);
  assert.equal(report.finishedGames, 1);
  assert.equal(report.turns.total, 6);
  assert.equal(report.turns.seen, 6);
  assert.equal(report.turns.unseen, 0);
  assert.equal(report.turns.claimed, 3);
  assert.equal(report.turns.passed, 1);
  assert.equal(report.turns.timedOut, 2);
});

test("miss rate per card kind", () => {
  const kinds = Object.fromEntries(aggregateGames([fixtureGame()]).kinds.map((row) => [row.kind, row]));
  assert.equal(kinds.letter.shown, 3);
  assert.equal(kinds.letter.claimed, 3);
  assert.equal(kinds.letter.missRate, 0);
  // flag is dealt on n1 (pass), n3 (claim) and n5 (claim): the spec's "shown 2" does not match its own fixture.
  assert.equal(kinds.flag.shown, 3);
  assert.equal(kinds.flag.claimed, 2);
  assert.equal(kinds.flag.passed, 1);
  assert.equal(kinds.flag.missRate, 1 / 3);
  assert.equal(kinds.continent.shown, 1);
  assert.equal(kinds.continent.timedOut, 1);
  assert.equal(kinds.continent.missRate, 1);
  assert.equal(kinds.landlocked.passed, 1);
});

test("wrong guesses are counted on every kind of the deal", () => {
  const kinds = Object.fromEntries(aggregateGames([fixtureGame()]).kinds.map((row) => [row.kind, row]));
  assert.equal(kinds.letter.wrongGuesses, 1);
  assert.equal(kinds.population.wrongGuesses, 1);
  assert.equal(kinds.flag.wrongGuesses, 0);
  assert.equal(kinds.continent.wrongGuesses, 0);
  assert.equal(kinds.population.wrongPerTurn, 1);
});

test("both vs one and the pair table", () => {
  const report = aggregateGames([fixtureGame()]);
  assert.deepEqual(report.both, { twoCardClaims: 3, both: 2, one: 1, bothRate: 2 / 3 });
  const pairs = Object.fromEntries(report.pairs.map((row) => [row.pair, row]));
  assert.equal(pairs["flag+letter"].turns, 2);
  assert.equal(pairs["flag+letter"].claims, 2);
  assert.equal(pairs["flag+letter"].both, 1);
  assert.equal(pairs["flag+letter"].one, 1);
  assert.equal(pairs["letter+population"].both, 1);
  assert.equal(pairs["flag+landlocked"].misses, 1);
  assert.deepEqual(report.pairs.map((row) => row.pair), [
    "flag+letter", "continent+neighbours", "flag+landlocked", "language+min", "letter+population"
  ]);
});

test("answer times by kind and by turn length", () => {
  const report = aggregateGames([fixtureGame()]);
  const letter = report.kinds.find((row) => row.kind === "letter")!;
  assert.equal(letter.claimMs.median, 6200);
  assert.ok(Math.abs(letter.claimMs.mean! - 17300 / 3) < 1e-9);
  assert.equal(letter.claimMs.p90, 8000);
  const row10 = report.bySeconds.find((row) => row.turnSeconds === 10)!;
  assert.equal(row10.claimMs.median, 6200, "all claims: 6200, 8000, 3100");
  assert.equal(row10.wrongMs.median, 4000);
  const population = report.byKindAndSeconds.find((row) => row.kind === "population" && row.turnSeconds === 10)!;
  assert.equal(population.claimMs.median, 6200);
});

test("scores by round, lead changes, comeback and margin", () => {
  const row = aggregateGames([fixtureGame()]).perGame[0];
  assert.equal(row.roundTotals.length, 3);
  assert.deepEqual(row.roundTotals.map((round) => round.round), [1, 2, 3]);
  assert.equal(row.leadChanges, 1);
  assert.deepEqual(row.winners, ["Bo"]);
  assert.equal(row.maxWinnerDeficit, 3);
  assert.equal(row.comeback, false);
  assert.equal(row.margin, 1);
});

test("sudden death is counted and resolved", () => {
  const sudden = aggregateGames([fixtureGame()]).sudden;
  assert.equal(sudden.games, 1);
  assert.equal(sudden.share, 1);
  assert.equal(sudden.decided, 1);
  assert.equal(sudden.sharedWin, 0);
  assert.deepEqual(sudden.byRounds, { "1": 1 });
});

test("how the game ended", () => {
  const report = aggregateGames([fixtureGame()]);
  assert.deepEqual(report.ends.byReason, { turns_played: 1 });
  assert.deepEqual(report.ends.byPlayers, { "2": 1 });
  assert.deepEqual(report.ends.meanDurationMsBySeconds, { "10": 100_000 });
  const row = report.perGame[0];
  assert.equal(row.players, 2);
  assert.equal(row.turnSeconds, 10);
  assert.equal(row.rounds, 2);
  assert.equal(row.durationMs, 100_000);
});

test("a comeback is flagged at COMEBACK_POINTS", () => {
  assert.equal(COMEBACK_POINTS, 5);
  const trailing = (round1Gap: number) => {
    const game = fixtureGame();
    game.turns[1] = { ...game.turns[1], totals: { pa: round1Gap, pb: 0 } };
    return aggregateGames([game]).perGame[0];
  };
  assert.equal(trailing(5).comeback, true);
  assert.equal(trailing(5).maxWinnerDeficit, 5);
  assert.equal(trailing(4).comeback, false);
  assert.equal(trailing(4).maxWinnerDeficit, 4);
});

test("a shared sudden-death win has margin 0 and no deficit", () => {
  const game = fixtureGame();
  game.end = { ...game.end!, winners: ["pa", "pb"] };
  const report = aggregateGames([game]);
  assert.equal(report.sudden.sharedWin, 1);
  assert.equal(report.perGame[0].margin, 0);
  assert.equal(report.perGame[0].maxWinnerDeficit, null);
});

test("unseen catch-up turns are excluded from card stats", () => {
  const game = fixtureGame();
  const before = aggregateGames([game]);
  const extra = [turn(6, { outcome: "timeout", ms: 15000, sudden: true, round: 3, pid: "pa" }), turn(7, { outcome: "timeout", ms: 15000, sudden: true, round: 3, pid: "pb" })];
  const report = aggregateGames([withTurns(game, [...game.turns, ...extra])]);
  assert.equal(report.turns.unseen, 2);
  assert.equal(report.turns.seen, 6);
  assert.equal(report.turns.timedOut, 4);
  assert.deepEqual(report.kinds.map((row) => [row.kind, row.shown]), before.kinds.map((row) => [row.kind, row.shown]));
  assert.deepEqual(report.pairs, before.pairs);
  assert.deepEqual(report.both, before.both);
});

test("an unfinished game and missing turns are reported, not hidden", () => {
  const game = fixtureGame();
  const partial: GameLog = { ...withTurns(game, game.turns.filter((t) => t.n !== 2)), end: null };
  const report = aggregateGames([partial]);
  assert.equal(report.unfinishedGames, 1);
  assert.equal(report.finishedGames, 0);
  assert.equal(report.perGame[0].gaps, 1);
  assert.equal(report.gamesWithGaps, 1);
  assert.equal(report.perGame[0].endReason, "unfinished");
  assert.equal(report.perGame[0].margin, null);
});

test("games without a start record still count", () => {
  const game = { ...fixtureGame(), start: null };
  const report = aggregateGames([game]);
  const row = report.bySeconds.find((entry) => entry.turnSeconds === null);
  assert.ok(row, "a row for unknown turn length");
  assert.equal(report.perGame[0].players, null);
  assert.equal(report.perGame[0].turnSeconds, null);
  assert.equal(report.games, 1);
});

test("two games with different turn lengths group separately", () => {
  const second = fixtureGame();
  second.logId = "BBBBBB-1800000000001";
  second.start = { ...second.start!, logId: second.logId, room: "BBBBBB", turnSeconds: 25, startedAt: START_AT + 1 };
  const report = aggregateGames([second, fixtureGame()]);
  assert.deepEqual(report.bySeconds.map((row) => row.turnSeconds), [10, 25]);
  assert.deepEqual(report.bySeconds.map((row) => row.games), [1, 1]);
});

test("empty input gives zeros and null rates", () => {
  const report = aggregateGames([]);
  assert.equal(report.games, 0);
  assert.equal(report.turns.total, 0);
  assert.equal(report.both.bothRate, null);
  assert.equal(report.sudden.share, null);
  assert.equal(report.scoring.meanMargin, null);
  assert.equal(containsNaN(report), false);
  assert.match(formatReport(report), /Games/);
});

test("formatReport prints all five sections", () => {
  const report = aggregateGames([fixtureGame()]);
  const text = formatReport(report);
  for (const heading of ["Games", "1. Miss rate by card kind", "2. Both cards vs one card", "3. Answer time", "4. Scores by round and sudden death", "5. Games"]) {
    assert.ok(text.includes(heading), heading);
  }
  assert.ok(text.includes("Times are measured on the server from turn start to the request; players see a new card up to about 1 second later (polling), so real thinking time is a little shorter."));
  assert.ok(text.includes("Ann") && text.includes("Bo"));
  assert.ok(text.includes("R1 Ann 3 / Bo 0"));
  assert.equal(/NaN|undefined|null/.test(text), false);
  assert.equal(formatReport(report), text, "same input, same text");
  assert.equal(formatReport(aggregateGames([fixtureGame()])), text);
});

test("toJsonLines: one parseable line per record, in order, with the logId", () => {
  const game = fixtureGame();
  const lines = toJsonLines([game]);
  const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.deepEqual(parsed.map((entry) => entry.t), ["start", "turn", "turn", "turn", "turn", "turn", "turn", "wrong", "end"]);
  assert.deepEqual(parsed.filter((entry) => entry.t === "turn").map((entry) => entry.n), [0, 1, 2, 3, 4, 5]);
  assert.ok(parsed.every((entry) => entry.logId === game.logId));
  assert.equal(lines.some((line) => line.includes("token")), false);
});

test("sudden death is only counted for finished games, so the share never exceeds 1", () => {
  const unfinished = { ...fixtureGame(), end: null };
  const report = aggregateGames([fixtureGame(), unfinished]);
  assert.equal(report.finishedGames, 1);
  assert.equal(report.sudden.games, 1);
  assert.equal(report.sudden.share, 1);
});

test("formatReport shows the denominators next to the rates", () => {
  const text = formatReport(aggregateGames([fixtureGame()]));
  assert.match(text, /turn length\s+games\s+turns\s+claims/);
  assert.match(text, /10s\s+1\s+6\s+3\s/, "10s: 1 game, 6 shown turns, 3 claims");
  assert.match(text, /Rates on a few turns are noisy/);
  assert.match(text, /flag\s+3\s+2\s+1\s+0\s+33%/, "flag: shown 3, claimed 2, passed 1, timed out 0, miss 33%");
  assert.match(text, /Margin of victory over 1 finished game:/);
  assert.equal(/continent\s+10s\s+0/.test(text), false, "kinds with no claims are not listed by turn length");
});

test("two players with the same name stay separate in round totals and final totals", () => {
  const game = fixtureGame();
  game.start = { ...game.start!, players: [{ id: "pa", name: "Sam", host: true }, { id: "pb", name: "Sam", host: false }] };
  const row = aggregateGames([game]).perGame[0];
  assert.deepEqual(Object.keys(row.roundTotals[0].totals).sort(), ["Sam #1", "Sam #2"]);
  assert.deepEqual(row.roundTotals[0].totals, { "Sam #1": 3, "Sam #2": 0 });
  assert.deepEqual(Object.keys(row.finalTotals).sort(), ["Sam #1", "Sam #2"]);
  assert.deepEqual(row.finalTotals, { "Sam #1": 3, "Sam #2": 4 });
  assert.deepEqual(row.winners, ["Sam #2"]);
});

test("control characters in player names never reach the text report", () => {
  const game = fixtureGame();
  game.start = { ...game.start!, players: [{ id: "pa", name: "\u001b[31mRED\nFAKE", host: true }, { id: "pb", name: "Bo", host: false }] };
  const text = formatReport(aggregateGames([game]));
  assert.equal(text.includes("\u001b"), false, "no escape character");
  assert.equal(text.split("\n").some((line) => line.startsWith("FAKE")), false, "no forged line");
  assert.ok(text.includes("[31mRED FAKE 3 / Bo 0"), "the name is kept, with the controls turned into spaces");
});

test("host-ended games are excluded from margin, sudden-death share and duration", () => {
  const natural = fixtureGame();
  natural.end = { ...natural.end!, scores: { pa: { points: 1, bonus: 0, total: 1, territory: 0 }, pb: { points: 3, bonus: 1, total: 4, territory: 0 } } };
  const ended = fixtureGame();
  ended.logId = "BBBBBB-1800000000001";
  ended.start = { ...ended.start!, logId: ended.logId, room: "BBBBBB", startedAt: START_AT + 1 };
  // Margin 1 and no sudden death: if it were counted, the sudden share would be 1 of 2 and the margin mean would change.
  ended.end = { ...ended.end!, reason: "host_ended", suddenRounds: 0, durationMs: 9_000 };
  const report = aggregateGames([natural, ended]);
  assert.equal(report.finishedGames, 1);
  assert.equal(report.hostEndedGames, 1);
  assert.equal(report.scoring.finishedWithMargin, 1);
  assert.equal(report.scoring.meanMargin, 3);
  assert.equal(report.sudden.share, 1, "one finished game, and it was sudden death");
  assert.deepEqual(report.ends.meanDurationMsBySeconds, { "10": 100_000 });
  assert.deepEqual(report.ends.byReason, { turns_played: 1, host_ended: 1 }, "the ends table still lists every game");
  const text = formatReport(report);
  assert.ok(text.includes("2 games: 1 finished, 1 ended by the host, 0 unfinished"));
});

test("pairs with fewer than 10 turns are hidden and counted", () => {
  const card = (kind: LogCard["kind"]): LogCard => ({ kind, label: kind, fit: 5 });
  const turns = [
    ...Array.from({ length: 12 }, (_, n) => turn(n, { deal: [card("flag"), card("letter")], outcome: "pass" })),
    ...Array.from({ length: 2 }, (_, k) => turn(12 + k, { deal: [card("continent"), card("neighbours")], outcome: "timeout" })),
  ];
  const report = aggregateGames([withTurns(fixtureGame(), turns)]);
  assert.equal(report.pairs.length, 2, "the data keeps every pair");
  const text = formatReport(report);
  assert.ok(text.includes("flag+letter"));
  assert.equal(text.includes("continent+neighbours"), false);
  assert.ok(text.includes("1 further pair"));
});

test("a pair's both-rate prints as - with fewer than 5 claims", () => {
  const card = (kind: LogCard["kind"]): LogCard => ({ kind, label: kind, fit: 5 });
  const claim = { code: "XX", points: 1, fit: 2, both: true, hit: [0, 1] };
  const turns = Array.from({ length: 12 }, (_, n) => turn(n, {
    deal: [card("flag"), card("letter")],
    outcome: n < 2 ? "claim" : "pass",
    claim: n < 2 ? claim : undefined,
  }));
  const text = formatReport(aggregateGames([withTurns(fixtureGame(), turns)]));
  assert.match(text, /flag\+letter\s+12\s+2\s+2\s+0\s+10\s+-\s/, "2 claims, both rate shown as -");
  const row = text.split("\n").find((line) => line.startsWith("flag+letter"));
  assert.ok(row, "the pair row is printed");
  assert.equal(row.includes("%"), false, "no percentage on that row");
});

test("the answer-time and score sections carry the small-sample note", () => {
  const text = formatReport(aggregateGames([fixtureGame()]));
  const note = "Based on 1 games; treat anything under about 30 games as anecdotal.";
  assert.equal(text.split(note).length - 1, 2, "once under section 3 and once under section 4");
});

test("section 4 lists only the 20 most recent games", () => {
  const games = Array.from({ length: 23 }, (_, i) => {
    const game = fixtureGame();
    const logId = `GAME${String(i).padStart(2, "0")}-${START_AT + i}`;
    return { ...game, logId, start: { ...game.start!, logId, room: logId.slice(0, 6), startedAt: START_AT + i } };
  });
  const text = formatReport(aggregateGames(games));
  const section4 = text.split("4. Scores by round and sudden death")[1].split("5. Games")[0];
  assert.equal(section4.includes("GAME00-"), false, "the oldest is not listed");
  assert.ok(section4.includes("GAME22-"), "the newest is listed");
  assert.ok(section4.includes("... and 3 older games"));
});
