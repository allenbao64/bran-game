/**
 * Aggregates turn-based game logs into a report. Pure: no Redis, no env, no clock. Input is what parseGameLog returns.
 * Turns with `deal === null` were never shown to anyone (timeout catch-ups): they count as `unseen` and are left out of
 * every card, pair, both-vs-one, timing and seconds statistic.
 */
import type { GameEndReason, GameLog, TurnLogEvent, WrongGuessEvent } from "@/lib/game-log";

/** A winner who trailed by at least this many points at some round end made a "comeback". */
export const COMEBACK_POINTS = 5;

/** Milliseconds; null when count is 0. median of an even count = mean of the middle two. p90 = nearest rank: sorted[ceil(0.9 * n) - 1]. */
export type Spread = { count: number; mean: number | null; median: number | null; p90: number | null };
export type KindRow = {
  kind: string; shown: number;                 // seen turns (deal !== null) whose deal contains this kind
  claimed: number; passed: number; timedOut: number;
  missRate: number | null;                     // (passed + timedOut) / shown
  hitClaims: number;                           // claims whose `hit` includes a card of this kind
  wrongGuesses: number; wrongPerTurn: number | null;   // wrong events whose `kinds` include this kind; / shown
  avgFit: number | null;                       // mean LogCard.fit of this kind when shown
  claimMs: Spread;                             // ms of claim turns that showed this kind
  wrongMs: Spread;                             // ms of wrong guesses on turns that showed this kind
};
export type PairRow = { pair: string; turns: number; claims: number; both: number; one: number; misses: number; bothRate: number | null; avgFitBoth: number | null };
export type SecondsRow = { turnSeconds: number | null; games: number; seenTurns: number; claimed: number; missRate: number | null; claimMs: Spread; wrongMs: Spread };
export type KindSecondsRow = { kind: string; turnSeconds: number | null; claimMs: Spread };
export type RoundTotals = { round: number; sudden: boolean; totals: Record<string, number> };
export type GameRow = {
  logId: string; players: number | null; turnSeconds: number | null; rounds: number | null;
  endReason: GameEndReason | "unfinished";
  turnsPlayed: number; durationMs: number | null;
  suddenRounds: number; winners: string[];
  finalTotals: Record<string, number>;
  margin: number | null;
  roundTotals: RoundTotals[];
  leadChanges: number; maxWinnerDeficit: number | null; comeback: boolean;
  gaps: number;
};
export type LogReport = {
  games: number; finishedGames: number; unfinishedGames: number; gamesWithGaps: number; badFields: number;
  turns: { total: number; seen: number; unseen: number; claimed: number; passed: number; timedOut: number };
  kinds: KindRow[];
  pairs: PairRow[];
  both: { twoCardClaims: number; both: number; one: number; bothRate: number | null };
  bySeconds: SecondsRow[];
  byKindAndSeconds: KindSecondsRow[];
  ends: { byReason: Record<string, number>; byPlayers: Record<string, number>; meanDurationMsBySeconds: Record<string, number> };
  sudden: { games: number; share: number | null; sharedWin: number; decided: number; byRounds: Record<string, number> };
  scoring: { meanLeadChanges: number | null; comebacks: number; finishedWithMargin: number; meanMargin: number | null; medianMargin: number | null };
  perGame: GameRow[];
};

const SECONDS_NOTE = "Times are measured on the server from turn start to the request; players see a new card up to about 1 second later (polling), so real thinking time is a little shorter.";

function spread(values: number[]): Spread {
  const n = values.length;
  if (n === 0) return { count: 0, mean: null, median: null, p90: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  return {
    count: n,
    mean: sorted.reduce((sum, value) => sum + value, 0) / n,
    median: n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    p90: sorted[Math.ceil(0.9 * n) - 1],
  };
}

const rate = (part: number, whole: number) => (whole > 0 ? part / whole : null);
const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
const median = (values: number[]) => spread(values).median;

/** The id with the strictly highest total, or null when tied for first. */
function leaderOf(totals: Record<string, number>): string | null {
  const entries = Object.entries(totals);
  if (entries.length === 0) return null;
  const best = Math.max(...entries.map(([, total]) => total));
  const top = entries.filter(([, total]) => total === best);
  return top.length === 1 ? top[0][0] : null;
}

function byCompare(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

type Analysed = {
  game: GameLog;
  seconds: number | null;
  nameOf: (id: string) => string;
  /** Round-end totals keyed by player id, in turn order. */
  rounds: { round: number; sudden: boolean; totals: Record<string, number> }[];
  row: GameRow;
};

function analyse(game: GameLog): Analysed {
  const names = new Map<string, string>((game.start?.players ?? []).map((player) => [player.id, player.name]));
  const nameOf = (id: string) => names.get(id) ?? id;
  const byName = (totals: Record<string, number>) => Object.fromEntries(Object.entries(totals).map(([id, total]) => [nameOf(id), total]));
  const rounds = game.turns
    .filter((turn) => turn.totals)
    .map((turn) => ({ round: turn.round, sudden: turn.sudden, totals: turn.totals! }));

  const maxN = game.turns.reduce((max, turn) => Math.max(max, turn.n), -1);
  const distinct = new Set(game.turns.map((turn) => turn.n)).size;
  const gaps = game.turns.length ? maxN + 1 - distinct : 0;

  const leaders = rounds.map((round) => leaderOf(round.totals));
  let leadChanges = 0;
  let previous: string | null = null;
  for (const leader of leaders) {
    if (leader === null) continue;
    if (previous !== null && leader !== previous) leadChanges++;
    previous = leader;
  }

  const winners = game.end ? game.end.winners : [];
  let maxWinnerDeficit: number | null = null;
  if (winners.length === 1 && rounds.length > 0) {
    const winner = winners[0];
    maxWinnerDeficit = 0;
    for (const round of rounds) {
      const others = Object.entries(round.totals).filter(([id]) => id !== winner).map(([, total]) => total);
      const bestOther = others.length ? Math.max(...others) : 0;
      maxWinnerDeficit = Math.max(maxWinnerDeficit, bestOther - (round.totals[winner] ?? 0));
    }
  }

  let margin: number | null = null;
  if (game.end && winners.length > 0) {
    if (winners.length > 1) margin = 0;
    else {
      const scores = game.end.scores;
      const winner = winners[0];
      const others = Object.entries(scores).filter(([id]) => id !== winner).map(([, score]) => score.total);
      margin = (scores[winner]?.total ?? 0) - (others.length ? Math.max(...others) : 0);
    }
  }

  let finalTotals: Record<string, number> = {};
  if (game.end) finalTotals = Object.fromEntries(Object.entries(game.end.scores).map(([id, score]) => [nameOf(id), score.total]));
  else if (rounds.length) finalTotals = byName(rounds[rounds.length - 1].totals);

  const suddenRoundsSeen = new Set(game.turns.filter((turn) => turn.sudden).map((turn) => turn.round)).size;
  const row: GameRow = {
    logId: game.logId,
    players: game.start ? game.start.players.length : null,
    turnSeconds: game.start?.turnSeconds ?? null,
    rounds: game.start?.rounds ?? null,
    endReason: game.end ? game.end.reason : "unfinished",
    turnsPlayed: game.end ? game.end.turnsPlayed : (game.turns.length ? maxN + 1 : 0),
    durationMs: game.end ? game.end.durationMs : null,
    suddenRounds: game.end ? game.end.suddenRounds : suddenRoundsSeen,
    winners: winners.map(nameOf),
    finalTotals,
    margin,
    roundTotals: rounds.map((round) => ({ round: round.round, sudden: round.sudden, totals: byName(round.totals) })),
    leadChanges,
    maxWinnerDeficit,
    comeback: maxWinnerDeficit !== null && maxWinnerDeficit >= COMEBACK_POINTS,
    gaps,
  };
  return { game, seconds: game.start?.turnSeconds ?? null, nameOf, rounds, row };
}

type KindAcc = { shown: number; claimed: number; passed: number; timedOut: number; hitClaims: number; wrong: number; fitSum: number; fitCount: number; claimMs: number[]; wrongMs: number[] };

export function aggregateGames(games: GameLog[]): LogReport {
  const analysed = games.map(analyse);
  const turnsTotal = { total: 0, seen: 0, unseen: 0, claimed: 0, passed: 0, timedOut: 0 };

  const seenTurns: { turn: TurnLogEvent; seconds: number | null }[] = [];
  const wrongs: { wrong: WrongGuessEvent; seconds: number | null }[] = [];
  for (const { game, seconds } of analysed) {
    for (const turn of game.turns) {
      turnsTotal.total++;
      if (turn.outcome === "claim") turnsTotal.claimed++;
      if (turn.outcome === "pass") turnsTotal.passed++;
      if (turn.outcome === "timeout") turnsTotal.timedOut++;
      if (turn.deal === null) turnsTotal.unseen++;
      else {
        turnsTotal.seen++;
        seenTurns.push({ turn, seconds });
      }
    }
    for (const wrong of game.wrong) wrongs.push({ wrong, seconds });
  }

  // 1. Card kinds
  const kindAcc = new Map<string, KindAcc>();
  const acc = (kind: string) => {
    let entry = kindAcc.get(kind);
    if (!entry) {
      entry = { shown: 0, claimed: 0, passed: 0, timedOut: 0, hitClaims: 0, wrong: 0, fitSum: 0, fitCount: 0, claimMs: [], wrongMs: [] };
      kindAcc.set(kind, entry);
    }
    return entry;
  };
  for (const { turn } of seenTurns) {
    const deal = turn.deal!;
    for (const kind of new Set(deal.map((card) => card.kind))) {
      const entry = acc(kind);
      entry.shown++;
      if (turn.outcome === "claim") { entry.claimed++; entry.claimMs.push(turn.ms); }
      if (turn.outcome === "pass") entry.passed++;
      if (turn.outcome === "timeout") entry.timedOut++;
    }
    for (const card of deal) {
      const entry = acc(card.kind);
      entry.fitSum += card.fit;
      entry.fitCount++;
    }
    if (turn.outcome === "claim" && turn.claim) {
      const hitKinds = new Set<string>();
      for (const index of turn.claim.hit) {
        const kind = deal[index]?.kind;
        if (kind) hitKinds.add(kind);
      }
      for (const kind of hitKinds) acc(kind).hitClaims++;
    }
  }
  for (const { wrong } of wrongs) {
    for (const kind of new Set(wrong.kinds)) {
      const entry = acc(kind);
      entry.wrong++;
      entry.wrongMs.push(wrong.ms);
    }
  }
  const kinds: KindRow[] = [...kindAcc.entries()].map(([kind, entry]) => ({
    kind,
    shown: entry.shown,
    claimed: entry.claimed,
    passed: entry.passed,
    timedOut: entry.timedOut,
    missRate: rate(entry.passed + entry.timedOut, entry.shown),
    hitClaims: entry.hitClaims,
    wrongGuesses: entry.wrong,
    wrongPerTurn: rate(entry.wrong, entry.shown),
    avgFit: rate(entry.fitSum, entry.fitCount),
    claimMs: spread(entry.claimMs),
    wrongMs: spread(entry.wrongMs),
  })).sort((a, b) => b.shown - a.shown || byCompare(a.kind, b.kind));

  // 2. Pairs and both-vs-one
  const pairAcc = new Map<string, { turns: number; claims: number; both: number; one: number; misses: number; fitBothSum: number }>();
  let twoCardClaims = 0;
  let bothClaims = 0;
  let oneClaims = 0;
  for (const { turn } of seenTurns) {
    const deal = turn.deal!;
    if (deal.length !== 2) continue;
    const key = deal.map((card) => card.kind).sort().join("+");
    let entry = pairAcc.get(key);
    if (!entry) {
      entry = { turns: 0, claims: 0, both: 0, one: 0, misses: 0, fitBothSum: 0 };
      pairAcc.set(key, entry);
    }
    entry.turns++;
    entry.fitBothSum += turn.fitBoth ?? 0;
    if (turn.outcome === "claim" && turn.claim) {
      entry.claims++;
      twoCardClaims++;
      if (turn.claim.both) { entry.both++; bothClaims++; } else { entry.one++; oneClaims++; }
    }
    if (turn.outcome === "pass" || turn.outcome === "timeout") entry.misses++;
  }
  const pairs: PairRow[] = [...pairAcc.entries()].map(([pair, entry]) => ({
    pair,
    turns: entry.turns,
    claims: entry.claims,
    both: entry.both,
    one: entry.one,
    misses: entry.misses,
    bothRate: rate(entry.both, entry.claims),
    avgFitBoth: rate(entry.fitBothSum, entry.turns),
  })).sort((a, b) => b.turns - a.turns || byCompare(a.pair, b.pair));

  // 3. Times by turn length, and by card kind and turn length
  const secondsKeys = [...new Set(analysed.map((entry) => entry.seconds))].sort((a, b) => (a === null ? 1 : b === null ? -1 : a - b));
  const bySeconds: SecondsRow[] = secondsKeys.map((seconds) => {
    const seen = seenTurns.filter((entry) => entry.seconds === seconds).map((entry) => entry.turn);
    const claimMs = seen.filter((turn) => turn.outcome === "claim").map((turn) => turn.ms);
    const misses = seen.filter((turn) => turn.outcome === "pass" || turn.outcome === "timeout").length;
    return {
      turnSeconds: seconds,
      games: analysed.filter((entry) => entry.seconds === seconds).length,
      seenTurns: seen.length,
      claimed: claimMs.length,
      missRate: rate(misses, seen.length),
      claimMs: spread(claimMs),
      wrongMs: spread(wrongs.filter((entry) => entry.seconds === seconds).map((entry) => entry.wrong.ms)),
    };
  });
  const kindSecondsAcc = new Map<string, { kind: string; turnSeconds: number | null; ms: number[] }>();
  for (const { turn, seconds } of seenTurns) {
    for (const kind of new Set(turn.deal!.map((card) => card.kind))) {
      const key = `${kind}\u0000${seconds ?? ""}`;
      let entry = kindSecondsAcc.get(key);
      if (!entry) {
        entry = { kind, turnSeconds: seconds, ms: [] };
        kindSecondsAcc.set(key, entry);
      }
      if (turn.outcome === "claim") entry.ms.push(turn.ms);
    }
  }
  const byKindAndSeconds: KindSecondsRow[] = [...kindSecondsAcc.values()].map((entry) => ({
    kind: entry.kind, turnSeconds: entry.turnSeconds, claimMs: spread(entry.ms),
  })).sort((a, b) => byCompare(a.kind, b.kind) || (a.turnSeconds === null ? 1 : b.turnSeconds === null ? -1 : a.turnSeconds - b.turnSeconds));

  // 4. Ends, sudden death and scores
  const rows = analysed.map((entry) => entry.row);
  const finished = rows.filter((row) => row.endReason !== "unfinished");
  const byReason: Record<string, number> = {};
  const byPlayers: Record<string, number> = {};
  const durationsBySeconds = new Map<string, number[]>();
  for (const row of rows) {
    byReason[row.endReason] = (byReason[row.endReason] ?? 0) + 1;
    if (row.players !== null) byPlayers[String(row.players)] = (byPlayers[String(row.players)] ?? 0) + 1;
    if (row.endReason !== "unfinished" && row.durationMs !== null && row.turnSeconds !== null) {
      const key = String(row.turnSeconds);
      durationsBySeconds.set(key, [...(durationsBySeconds.get(key) ?? []), row.durationMs]);
    }
  }
  const meanDurationMsBySeconds: Record<string, number> = {};
  for (const [key, values] of durationsBySeconds) meanDurationMsBySeconds[key] = mean(values)!;

  const suddenRows = finished.filter((row) => row.suddenRounds > 0);
  const byRounds: Record<string, number> = {};
  for (const row of suddenRows) byRounds[String(row.suddenRounds)] = (byRounds[String(row.suddenRounds)] ?? 0) + 1;

  const withRounds = rows.filter((row) => row.roundTotals.length > 0);
  const margins = rows.map((row) => row.margin).filter((margin): margin is number => margin !== null);

  return {
    games: rows.length,
    finishedGames: finished.length,
    unfinishedGames: rows.length - finished.length,
    gamesWithGaps: rows.filter((row) => row.gaps > 0).length,
    badFields: games.reduce((sum, game) => sum + game.badFields, 0),
    turns: turnsTotal,
    kinds,
    pairs,
    both: { twoCardClaims, both: bothClaims, one: oneClaims, bothRate: rate(bothClaims, twoCardClaims) },
    bySeconds,
    byKindAndSeconds,
    ends: { byReason, byPlayers, meanDurationMsBySeconds },
    sudden: {
      games: suddenRows.length,
      share: rate(suddenRows.length, finished.length),
      sharedWin: suddenRows.filter((row) => row.winners.length > 1).length,
      decided: suddenRows.filter((row) => row.winners.length === 1).length,
      byRounds,
    },
    scoring: {
      meanLeadChanges: mean(withRounds.map((row) => row.leadChanges)),
      comebacks: rows.filter((row) => row.comeback).length,
      finishedWithMargin: margins.length,
      meanMargin: mean(margins),
      medianMargin: median(margins),
    },
    perGame: rows,
  };
}

// ---- Text report ----

const pct = (value: number | null) => (value === null ? "-" : `${Math.round(value * 100)}%`);
const secs = (ms: number | null) => (ms === null ? "-" : `${(ms / 1000).toFixed(1)}s`);
const num = (value: number | null, digits = 0) => (value === null ? "-" : value.toFixed(digits));
const count = (value: number, noun: string) => `${value} ${noun}${value === 1 ? "" : "s"}`;

/** Left-aligns the first column and right-aligns the rest, each padded to its widest cell. */
function table(rows: string[][]): string {
  if (rows.length === 0) return "";
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => (row[column] ?? "").length)));
  return rows.map((row) => row.map((cell, column) => (column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join("  ").trimEnd()).join("\n");
}

function sectionTitle(title: string) {
  return `${title}\n${"-".repeat(title.length)}`;
}

/** Plain-text report. Deterministic; no NaN, undefined or null text (missing values print as "-"). */
export function formatReport(report: LogReport): string {
  const out: string[] = [];
  out.push("Turn-based game log report", "");

  out.push(sectionTitle("Games"));
  out.push(`${count(report.games, "game")}: ${report.finishedGames} finished, ${report.unfinishedGames} unfinished, ${report.gamesWithGaps} with gaps, ${report.badFields} unreadable fields`);
  out.push(`Turns: ${report.turns.total} logged, ${report.turns.seen} shown to players, ${report.turns.unseen} never shown (timeout catch-ups)`);
  out.push(`Outcomes of all turns: ${report.turns.claimed} claimed, ${report.turns.passed} passed, ${report.turns.timedOut} timed out`, "");

  out.push(sectionTitle("1. Miss rate by card kind"));
  out.push("Miss = passed or timed out. Only turns that showed the card are counted. Rates on a few turns are noisy: read them with the counts.");
  if (report.kinds.length === 0) out.push("No shown turns yet.");
  else {
    out.push(table([
      ["card kind", "shown", "claimed", "passed", "timed out", "miss rate", "wrong guesses", "wrong per turn", "avg fit", "median claim"],
      ...report.kinds.map((row) => [
        row.kind, String(row.shown), String(row.claimed), String(row.passed), String(row.timedOut), pct(row.missRate),
        String(row.wrongGuesses), num(row.wrongPerTurn, 2), num(row.avgFit, 1), secs(row.claimMs.median),
      ]),
    ]));
  }
  out.push("");

  out.push(sectionTitle("2. Both cards vs one card"));
  out.push(`Claims on two-card deals: ${report.both.twoCardClaims}. Both cards: ${report.both.both} (${pct(report.both.bothRate)}). One card: ${report.both.one}.`);
  if (report.pairs.length) {
    out.push(table([
      ["card pair", "turns", "claims", "both", "one", "misses", "both rate", "avg fit (both)"],
      ...report.pairs.map((row) => [
        row.pair, String(row.turns), String(row.claims), String(row.both), String(row.one), String(row.misses), pct(row.bothRate), num(row.avgFitBoth, 1),
      ]),
    ]));
  }
  out.push("");

  out.push(sectionTitle("3. Answer time"));
  out.push(table([
    ["turn length", "games", "turns", "claims", "median claim", "mean claim", "p90 claim", "median wrong", "miss rate"],
    ...report.bySeconds.map((row) => [
      row.turnSeconds === null ? "-" : `${row.turnSeconds}s`, String(row.games), String(row.seenTurns), String(row.claimed),
      secs(row.claimMs.median), secs(row.claimMs.mean), secs(row.claimMs.p90), secs(row.wrongMs.median), pct(row.missRate),
    ]),
  ]));
  if (report.byKindAndSeconds.some((row) => row.claimMs.count > 0)) {
    out.push("", "By card kind and turn length (claims only)");
    out.push(table([
      ["card kind", "turn length", "claims", "median claim", "p90 claim"],
      ...report.byKindAndSeconds.filter((row) => row.claimMs.count > 0).map((row) => [
        row.kind, row.turnSeconds === null ? "-" : `${row.turnSeconds}s`, String(row.claimMs.count), secs(row.claimMs.median), secs(row.claimMs.p90),
      ]),
    ]));
  }
  out.push("", SECONDS_NOTE, "");

  out.push(sectionTitle("4. Scores by round and sudden death"));
  out.push(`Sudden death: ${report.sudden.games} of ${report.finishedGames} finished games (${pct(report.sudden.share)}). Decided: ${report.sudden.decided}. Shared win: ${report.sudden.sharedWin}.`);
  out.push(`Margin of victory over ${count(report.scoring.finishedWithMargin, "finished game")}: mean ${num(report.scoring.meanMargin, 1)}, median ${num(report.scoring.medianMargin, 1)}. Comebacks (trailed by ${COMEBACK_POINTS}+): ${report.scoring.comebacks}. Mean lead changes: ${num(report.scoring.meanLeadChanges, 1)}.`);
  for (const row of report.perGame) {
    const rounds = row.roundTotals.length
      ? row.roundTotals.map((round) => `R${round.round}${round.sudden ? " sudden" : ""} ${Object.entries(round.totals).map(([name, total]) => `${name} ${total}`).join(" / ")}`).join("; ")
      : "no round totals";
    out.push(`  ${row.logId}: ${rounds}`);
  }
  out.push("");

  out.push(sectionTitle("5. Games"));
  if (report.perGame.length === 0) out.push("No games found.");
  else {
    out.push(table([
      ["game", "players", "turn", "rounds", "ended", "turns", "length", "sudden", "winners", "margin", "gaps"],
      ...report.perGame.map((row) => [
        row.logId,
        row.players === null ? "-" : String(row.players),
        row.turnSeconds === null ? "-" : `${row.turnSeconds}s`,
        row.rounds === null ? "-" : String(row.rounds),
        row.endReason.replace("_", " "),
        String(row.turnsPlayed),
        row.durationMs === null ? "-" : `${Math.round(row.durationMs / 60000)} min`,
        row.suddenRounds > 0 ? String(row.suddenRounds) : "-",
        row.winners.length ? row.winners.join(" and ") : "-",
        row.margin === null ? "-" : String(row.margin),
        String(row.gaps),
      ]),
    ]));
  }
  return out.join("\n") + "\n";
}

/** One JSON line per record: the start, the turns by n, the wrong guesses, then the end. Each line carries the logId. */
export function toJsonLines(games: GameLog[]): string[] {
  const lines: string[] = [];
  for (const game of games) {
    if (game.start) lines.push(JSON.stringify({ ...game.start, logId: game.logId }));
    for (const turn of [...game.turns].sort((a, b) => a.n - b.n)) lines.push(JSON.stringify({ logId: game.logId, ...turn }));
    for (const wrong of [...game.wrong].sort((a, b) => a.n - b.n || a.at - b.at)) lines.push(JSON.stringify({ logId: game.logId, ...wrong }));
    if (game.end) lines.push(JSON.stringify({ ...game.end, logId: game.logId }));
  }
  return lines;
}
