// Metrics over GameRecord[] (section 4). Pure functions: no I/O. Empty input gives zeros, never NaN.
import { PURE_STRATEGIES, type Strategy } from "./bots";
import type { EventKind, BountyKind } from "@/lib/empire2/types";
import type { GameRecord, SeatRecord } from "./types";

export const STRATEGY_ORDER: Strategy[] = [...PURE_STRATEGIES, "mixed"];
export const BOUNTY_KINDS: BountyKind[] = ["letter", "landlocked", "island", "short", "long", "continent", "region"];
export const EVENT_LIST: EventKind[] = ["tradeWinds", "ceasefire", "goldenAge", "goldRush", "closedBorders"];

export function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

/** Win share per seat: 1 / winners.length for each winner, 0 otherwise. */
export function winShares(g: GameRecord): number[] {
  const out: number[] = Array.from({ length: g.n }, () => 0);
  for (const w of g.winners) out[w] = 1 / g.winners.length;
  return out;
}

// ---------- C1 ----------
export function lengthStats(records: GameRecord[], n: number) {
  const rounds = records.map((r) => r.rounds);
  const m = mean(rounds);
  const histogram: number[] = Array.from({ length: 20 }, () => 0);
  for (const r of rounds) if (r >= 1 && r <= 20) histogram[r - 1] += 1;
  return {
    mean: m,
    median: median(rounds),
    p10: percentile(rounds, 0.1),
    p90: percentile(rounds, 0.9),
    estMinutes: (m * n * 20) / 60,
    histogram,
  };
}

// ---------- C2 and the per-strategy table ----------
export type StrategyRow = {
  strategy: Strategy;
  appearances: number;
  wins: number;
  winRate: number;          // fraction
  ciLo: number;
  ciHi: number;
  avgVp: number;
  countries: number;
  cities: number;
  annexes: number;
  idleShare: number;        // fraction
  influence: {
    spent: { expand: number; colonize: number; city: number; annex: number };
    bountyInfluence: number;
    income: number;
    leftover: number;
  };
};

export function strategyRows(records: GameRecord[]): StrategyRow[] {
  const rows: StrategyRow[] = [];
  for (const s of STRATEGY_ORDER) {
    const seats: { g: GameRecord; sr: SeatRecord; income: number; win: number }[] = [];
    for (const g of records) {
      const ws = winShares(g);
      g.seats.forEach((sr) => {
        if (sr.strategy === s) seats.push({ g, sr, income: incomeOf(g, sr.seat), win: ws[sr.seat] });
      });
    }
    if (seats.length === 0) continue;
    const apps = seats.length;
    const wins = seats.reduce((a, x) => a + x.win, 0);
    const rate = wins / apps;
    const half = 1.96 * Math.sqrt((rate * (1 - rate)) / apps);
    const turns = seats.reduce((a, x) => a + x.sr.stats.turns, 0);
    const idle = seats.reduce((a, x) => a + x.sr.stats.idleTurns, 0);
    const sumSpent = (k: "expand" | "colonize" | "city" | "annex") => mean(seats.map((x) => x.sr.stats.spent[k]));
    rows.push({
      strategy: s,
      appearances: apps,
      wins,
      winRate: rate,
      ciLo: rate - half,
      ciHi: rate + half,
      avgVp: mean(seats.map((x) => x.sr.finalVp)),
      countries: mean(seats.map((x) => x.sr.countries)),
      cities: mean(seats.map((x) => x.sr.cityCount)),
      annexes: mean(seats.map((x) => x.sr.stats.count.annex)),
      idleShare: turns === 0 ? 0 : idle / turns,
      influence: {
        spent: { expand: sumSpent("expand"), colonize: sumSpent("colonize"), city: sumSpent("city"), annex: sumSpent("annex") },
        bountyInfluence: mean(seats.map((x) => x.sr.stats.bountyInfluence)),
        income: mean(seats.map((x) => x.income)),
        leftover: mean(seats.map((x) => x.sr.finalInfluence)),
      },
    });
  }
  return rows;
}

export function incomeOf(g: GameRecord, seat: number): number {
  return g.perRound.reduce((a, r) => a + (r.income[seat] ?? 0), 0);
}

/** C2 value: the top strategy by win rate (first in PURE order on ties). Returns null if no strategy appears. */
export function topStrategy(rows: StrategyRow[]): StrategyRow | null {
  let top: StrategyRow | null = null;
  for (const r of rows) if (top === null || r.winRate > top.winRate) top = r;
  return top;
}

// ---------- C3 ----------
export function seatRates(records: GameRecord[], n: number): { rate: number; wins: number }[] {
  const wins: number[] = Array.from({ length: n }, () => 0);
  for (const g of records) winShares(g).forEach((w, k) => (wins[k] += w));
  return wins.map((w) => ({ wins: w, rate: records.length === 0 ? 0 : w / records.length }));
}

/** C3 value in points: the largest |seat rate - 1/n|, with the seat index (0-based). */
export function worstSeat(records: GameRecord[], n: number): { devPts: number; seat: number } {
  if (records.length === 0) return { devPts: 0, seat: 0 };
  let best = { devPts: -1, seat: 0 };
  seatRates(records, n).forEach((x, k) => {
    const dev = Math.abs(x.rate - 1 / n) * 100;
    if (dev > best.devPts) best = { devPts: dev, seat: k };
  });
  return best;
}

// ---------- C4 ----------
export type LastPlaceResult = { value: number; games: number; valid: boolean };

/** Last place at round r still wins (C4 uses r = 6). */
export function lastPlaceAt(records: GameRecord[], round: number): LastPlaceResult {
  let wsum = 0;
  let wwin = 0;
  let games = 0;
  for (const g of records) {
    if (g.rounds < round) continue;
    const snap = g.startVp[round - 1];
    const min = Math.min(...snap);
    const lastSet: number[] = [];
    snap.forEach((v, k) => {
      if (v === min) lastSet.push(k);
    });
    if (lastSet.length === g.n) continue;
    games += 1;
    const ws = winShares(g);
    for (const k of lastSet) {
      const w = 1 / lastSet.length;
      wsum += w;
      wwin += w * ws[k];
    }
  }
  return { value: wsum === 0 ? 0 : wwin / wsum, games, valid: wsum > 0 };
}

// ---------- C5 ----------
export function leaderSnapshots(g: GameRecord): { label: number; vp: number[] }[] {
  const snaps: { label: number; vp: number[] }[] = g.startVp.map((vp, i) => ({ label: i + 1, vp }));
  if (g.rounds >= 6) snaps.push({ label: g.rounds + 1, vp: g.finalVp });
  return snaps;
}

function leaderOf(vp: number[]): number | null {
  const top = Math.max(...vp);
  const holders = vp.map((v, k) => (v === top ? k : -1)).filter((k) => k >= 0);
  return holders.length === 1 ? holders[0] : null;
}

export function hasLeaderChange(g: GameRecord): boolean {
  let last: number | null = null;
  let changed = false;
  for (const s of leaderSnapshots(g)) {
    const leader = leaderOf(s.vp);
    if (s.label >= 6 && leader !== null && last !== null && leader !== last) changed = true;
    if (leader !== null) last = leader;
  }
  return changed;
}

export function leaderChanges(records: GameRecord[]): { changes: number; games: number; failingSeeds: number[] } {
  const failingSeeds: number[] = [];
  let changes = 0;
  for (const g of records) {
    if (hasLeaderChange(g)) changes += 1;
    else failingSeeds.push(g.seed);
  }
  return { changes, games: records.length, failingSeeds };
}

// ---------- Advisory (M1 to M10) ----------
export function turnDiagnostics(records: GameRecord[]) {
  let turns = 0;
  let three = 0;
  const threeB = [0, 0, 0];
  const turnsB = [0, 0, 0];
  let noFrontier = 0;
  let noFrontierColonized = 0;
  let noFrontierIdle = 0;
  let second = 0;
  for (const g of records) {
    for (const sr of g.seats) {
      const st = sr.stats;
      turns += st.turns;
      three += st.threeExpandTurns;
      noFrontier += st.noFrontierTurns;
      noFrontierColonized += st.noFrontierColonized;
      noFrontierIdle += st.noFrontierIdle;
      second += st.secondTurns;
      for (let b = 0; b < 3; b++) {
        threeB[b] += st.threeExpandByBucket[b];
        turnsB[b] += st.turnsByBucket[b];
      }
    }
  }
  const waiting = records.reduce((a, g) => a + g.waiting.length, 0);
  const outcomes = { won: 0, dropped: 0, preempted: 0 };
  for (const g of records) for (const w of g.waiting) outcomes[w.outcome] += 1;
  const share = (x: number, total: number) => (total === 0 ? 0 : x / total);
  const pointsGames = records.filter((g) => g.reason === "points").length;
  return {
    threeExpandRate: share(three, turns),
    threeExpandByBucket: [0, 1, 2].map((b) => share(threeB[b], turnsB[b])),
    noFrontierRate: share(noFrontier, turns),
    unstuckRate: share(noFrontierColonized, noFrontier),
    stuckIdleRate: share(noFrontierIdle, noFrontier),
    secondTurns: second,
    reachedTarget: waiting,
    waitingOutcomes: outcomes,
    waitingPerGame: share(waiting, records.length),
    pointsShare: share(pointsGames, records.length),
    capShare: 1 - share(pointsGames, records.length),
    games: records.length,
    turns,
  };
}

export function pointSources(records: GameRecord[]) {
  const keys = ["territory", "cities", "regionSets", "largestEmpire", "explorer"] as const;
  type Key = (typeof keys)[number];
  const winners: Record<Key, number> = { territory: 0, cities: 0, regionSets: 0, largestEmpire: 0, explorer: 0 };
  const all: Record<Key, number> = { territory: 0, cities: 0, regionSets: 0, largestEmpire: 0, explorer: 0 };
  for (const g of records) {
    const ws = winShares(g);
    g.seats.forEach((sr, k) => {
      for (const key of keys) {
        all[key] += sr.vp[key];
        winners[key] += ws[k] * sr.vp[key];
      }
    });
  }
  const sum = (x: Record<Key, number>) => keys.reduce((a, k) => a + x[k], 0);
  const shares = (x: Record<Key, number>) => {
    const total = sum(x);
    return Object.fromEntries(keys.map((k) => [k, total === 0 ? 0 : x[k] / total])) as Record<Key, number>;
  };
  return { winners: shares(winners), all: shares(all), winnerRegionSetShare: shares(winners).regionSets };
}

export function incomeBuckets(records: GameRecord[]) {
  const sums = [0, 0, 0];
  const counts = [0, 0, 0];
  for (const g of records) {
    for (const r of g.perRound) {
      const b = r.round <= 4 ? 0 : r.round <= 9 ? 1 : 2;
      for (const x of r.income) {
        sums[b] += x;
        counts[b] += 1;
      }
    }
  }
  return [0, 1, 2].map((b) => ({ mean: counts[b] === 0 ? 0 : sums[b] / counts[b], observations: counts[b] }));
}

export function annexStats(records: GameRecord[]) {
  const perGame = records.map((g) => g.seats.reduce((a, sr) => a + sr.stats.count.annex, 0));
  const dist = [0, 0, 0, 0];
  for (const a of perGame) dist[Math.min(3, a)] += 1;
  return { mean: mean(perGame), dist };   // dist: 0, 1, 2, 3 or more
}

/** Comeback (M8): weighted share of games whose winner trailed by underdogGap at the start of round r. */
export function comeback(records: GameRecord[], round: number, gap: number): { value: number; games: number } {
  let sum = 0;
  let games = 0;
  for (const g of records) {
    if (g.rounds < round) continue;
    games += 1;
    const snap = g.startVp[round - 1];
    const top = Math.max(...snap);
    const ws = winShares(g);
    g.winners.forEach((w) => {
      if (snap[w] <= top - gap) sum += ws[w];
    });
  }
  return { value: games === 0 ? 0 : sum / games, games };
}

export function bountyStats(records: GameRecord[]) {
  const drawn: Record<string, number> = {};
  const claimed: Record<string, number> = {};
  for (const k of BOUNTY_KINDS) {
    drawn[k] = 0;
    claimed[k] = 0;
  }
  for (const g of records) {
    for (const r of g.perRound) for (const k of r.bountiesDrawn) drawn[k] += 1;
    for (const k of BOUNTY_KINDS) claimed[k] += g.bountiesClaimed[k] ?? 0;
  }
  return { drawn, claimed };
}

export type EventRow = {
  event: EventKind | "none";
  rounds: number;
  games: number;
  rates: { expands: number; colonizes: number; cities: number; annexes: number; bountiesClaimed: number };
  annexesTotal: number;
};

export function eventStats(records: GameRecord[]): EventRow[] {
  const rows: EventRow[] = [];
  for (const ev of [...EVENT_LIST, "none" as const]) {
    let rounds = 0;
    let games = 0;
    const tot = { expands: 0, colonizes: 0, cities: 0, annexes: 0, bountiesClaimed: 0 };
    for (const g of records) {
      let appeared = false;
      for (const r of g.perRound) {
        const match = ev === "none" ? r.event === null : r.event === ev;
        if (!match) continue;
        appeared = true;
        rounds += 1;
        tot.expands += r.expands;
        tot.colonizes += r.colonizes;
        tot.cities += r.cities;
        tot.annexes += r.annexes;
        tot.bountiesClaimed += r.bountiesClaimed;
      }
      if (appeared) games += 1;
    }
    const per = (x: number) => (rounds === 0 ? 0 : x / rounds);
    rows.push({
      event: ev,
      rounds,
      games,
      rates: {
        expands: per(tot.expands),
        colonizes: per(tot.colonizes),
        cities: per(tot.cities),
        annexes: per(tot.annexes),
        bountiesClaimed: per(tot.bountiesClaimed),
      },
      annexesTotal: tot.annexes,
    });
  }
  return rows;
}
