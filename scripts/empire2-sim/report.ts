// The report: ReportData (deterministic, plus meta) and the plain-text formatter (section 5).
import type { Rules } from "@/lib/empire2/types";
import { type BaseName, type CheckId, type ConfigSpec, DESIGN_VALUES } from "./config";
import {
  annexStats, bountyStats, BOUNTY_KINDS, comeback, eventStats, type EventRow, incomeBuckets, lastPlaceAt,
  type LastPlaceResult, leaderChanges, lengthStats, pointSources, seatRates, strategyRows, type StrategyRow,
  topStrategy, turnDiagnostics, winnerPositions, worstSeat,
} from "./metrics";
import type { GameRecord } from "./types";

export type RunMeta = {
  seedBase: number;
  /** The base the run started from (run.ts --base). Absent in older callers: read as "default". */
  base?: BaseName;
  overrides: Partial<Rules>;
  startedAt: string;
  wallSeconds: number;
  node: string;
  commit: string;
};

export type CheckRow = {
  id: CheckId;
  name: string;
  value: number;
  display: string;
  threshold: string;
  result: "PASS" | "FAIL" | "info";
  pass: boolean | null;
  note: string;
};

export type ReportData = {
  id: string;
  map: string;
  n: number;
  field: string;
  role: string;
  games: number;
  seedBase: number;
  base: BaseName;
  knowP: number;
  slowP: number;
  overrides: Partial<Rules>;
  /** False when the explorer title is off (EMPIRE2_PLAY_RULES): the report prints n/a for explorer points. */
  explorerTitle: boolean;
  rulesInForce: Record<"winPoints" | "baseIncome" | "startInfluence" | "expandCost" | "cityCost" | "colonizeCost" | "annexCost" | "countriesPerTerritory", number>;
  changedFromDesign: string[];
  checks: CheckRow[];
  gate: "PASS" | "FAIL" | "n/a";
  gateFailing: CheckId[];
  length: ReturnType<typeof lengthStats>;
  strategies: StrategyRow[];
  seats: { seat: number; winRate: number; devPts: number }[];
  pointSources: ReturnType<typeof pointSources>;
  incomeBuckets: ReturnType<typeof incomeBuckets>;
  turn: ReturnType<typeof turnDiagnostics>;
  annexes: ReturnType<typeof annexStats>;
  comeback6: { value: number; games: number };
  comeback10: { value: number; games: number };
  c4Context: { round4: LastPlaceResult; round6: LastPlaceResult; round8: LastPlaceResult };
  c5: { changes: number; games: number; failingSeeds: number[]; failingCount: number };
  bounties: ReturnType<typeof bountyStats>;
  events: EventRow[];
  flags: string[];
  winnerPosition: ReturnType<typeof winnerPositions>;
  meta: RunMeta;
};

const CHECK_NAMES: Record<CheckId, string> = {
  C1: "Average game length (rounds)",
  C2: "Top strategy win rate",
  C3: "Worst seat deviation",
  C4: "Last place at round 6 wins",
  C5: "Leader change after round 5",
};

const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;

export function computeReport(records: GameRecord[], config: ConfigSpec, rules: Rules, meta: RunMeta): ReportData {
  const n = config.n;
  const length = lengthStats(records, n);
  const strategies = strategyRows(records);
  const top = topStrategy(strategies);
  const worst = worstSeat(records, n);
  const lp = lastPlaceAt(records, 6);
  const lc = leaderChanges(records);
  const turn = turnDiagnostics(records);
  const annexes = annexStats(records);
  const buckets = incomeBuckets(records);
  const events = eventStats(records);
  const bounties = bountyStats(records);
  const sources = pointSources(records);
  const cb6 = comeback(records, 6, rules.underdogGap);
  const cb10 = comeback(records, 10, rules.underdogGap);
  const winnerPosition = winnerPositions(records, rules);

  const values: Record<CheckId, { value: number; display: string; threshold: string; pass: (v: number) => boolean; note: string }> = {
    C1: {
      value: length.mean,
      display: length.mean.toFixed(2),
      threshold: "12.00 to 16.00",
      pass: (v) => v >= 12 && v <= 16,
      note: "",
    },
    C2: {
      value: (top?.winRate ?? 0) * 100,
      display: pct(top?.winRate ?? 0),
      threshold: "<= 40.0%",
      pass: (v) => v <= 40,
      note: top?.strategy ?? "",
    },
    C3: {
      value: worst.devPts,
      display: `${worst.devPts.toFixed(1)} pts`,
      threshold: "<= 5.0 pts",
      pass: (v) => v <= 5,
      note: `seat ${worst.seat + 1}`,
    },
    C4: {
      value: lp.value * 100,
      display: pct(lp.value),
      threshold: ">= 15.0%",
      pass: (v) => lp.valid && v >= 15,
      note: `${lp.games} games`,
    },
    C5: {
      value: records.length === 0 ? 0 : (lc.changes / records.length) * 100,
      display: pct(records.length === 0 ? 0 : lc.changes / records.length),
      threshold: ">= 95.0%",
      pass: (v) => v >= 95,
      note: `${lc.changes} of ${lc.games} games`,
    },
  };

  const checks: CheckRow[] = [];
  const gateFailing: CheckId[] = [];
  for (const id of config.checks) {
    const v = values[id];
    const passed = v.pass(v.value);
    const gated = config.role === "GATE" && !config.reportOnly.includes(id);
    if (gated && !passed) gateFailing.push(id);
    checks.push({
      id,
      name: CHECK_NAMES[id],
      value: v.value,
      display: v.display,
      threshold: v.threshold,
      pass: gated ? passed : null,
      result: gated ? (passed ? "PASS" : "FAIL") : "info",
      note: v.note,
    });
  }
  const gate: ReportData["gate"] = config.role === "GATE" ? (gateFailing.length === 0 ? "PASS" : "FAIL") : "n/a";

  const flags: string[] = [];
  if (turn.threeExpandRate > 0.35) flags.push(`M1: threeExpandRate ${pct(turn.threeExpandRate)} is above 35.0%`);
  if (turn.noFrontierRate > 0.15) flags.push(`M2: noFrontierRate ${pct(turn.noFrontierRate)} is above 15%`);
  if (turn.unstuckRate < 0.7 && turn.noFrontierRate > 0) flags.push(`M2: unstuckRate ${pct(turn.unstuckRate)} is below 70%`);
  if (turn.waitingPerGame > 0.25) flags.push(`M3: waitingPerGame ${turn.waitingPerGame.toFixed(3)} is above 0.25`);
  if (turn.capShare > 0.05) flags.push(`M4: capShare ${pct(turn.capShare)} is above 5%`);
  if (sources.winnerRegionSetShare > 0.45) {
    flags.push(`M5: region sets are ${pct(sources.winnerRegionSetShare)} of winners' points (above 45%): a rule problem, STOP S4`);
  }
  const bucketBounds: [number, number][] = [[2.5, 4.5], [4.5, 7.5], [7.0, Infinity]];
  const bucketNames = ["1-4", "5-9", "10+"];
  buckets.forEach((b, k) => {
    if (b.observations === 0) return;
    const [lo, hi] = bucketBounds[k];
    if (b.mean < lo || b.mean > hi) flags.push(`M6: income in rounds ${bucketNames[k]} is ${b.mean.toFixed(2)}, outside the paper range`);
  });
  if (records.length > 0 && (annexes.mean < 1 || annexes.mean > 8)) flags.push(`M7: annexes per game ${annexes.mean.toFixed(2)} is outside 1 to 8`);
  if (records.some((g) => g.rounds >= 6) && cb6.value < 0.1) flags.push(`M8: comeback at round 6 is ${pct(cb6.value)}, below 10%`);
  const ceasefire = events.find((e) => e.event === "ceasefire");
  if (ceasefire !== undefined && ceasefire.annexesTotal > 0) {
    flags.push(`M9: ${ceasefire.annexesTotal} annexes in ceasefire rounds: ENGINE BUG, STOP S1`);
  }
  for (const row of strategies) {
    if (row.winRate < 0.1) flags.push(`M10: ${row.strategy} win rate ${pct(row.winRate)} is below 10%: weak or broken bot, check it for a bot bug`);
    if (row.idleShare > 0.25) flags.push(`M10: ${row.strategy} idle share ${pct(row.idleShare)} is above 25%`);
  }

  const changedFromDesign: string[] = [];
  for (const [key, design] of Object.entries(DESIGN_VALUES)) {
    const v = (rules as unknown as Record<string, number>)[key];
    if (v !== design) changedFromDesign.push(`${key} ${design} -> ${v}`);
  }

  const failingSeeds = lc.failingSeeds.slice(0, 20);
  const seatsOut = seatRates(records, n).map((x, k) => ({
    seat: k,
    winRate: x.rate,
    devPts: Math.abs(x.rate - 1 / n) * 100,
  }));

  return {
    id: config.id,
    map: config.map,
    n,
    field: config.field,
    role: config.role,
    games: records.length,
    seedBase: meta.seedBase,
    base: meta.base ?? "default",
    knowP: config.knowP,
    slowP: config.slowP,
    overrides: meta.overrides,
    explorerTitle: rules.explorerTitle !== false,
    rulesInForce: {
      winPoints: rules.winPoints,
      baseIncome: rules.baseIncome,
      startInfluence: rules.startInfluence,
      expandCost: rules.expandCost,
      cityCost: rules.cityCost,
      colonizeCost: rules.colonizeCost,
      annexCost: rules.annexCost,
      countriesPerTerritory: rules.countriesPerTerritory,
    },
    changedFromDesign,
    checks,
    gate,
    gateFailing,
    length,
    strategies,
    seats: seatsOut,
    pointSources: sources,
    incomeBuckets: buckets,
    turn,
    annexes,
    comeback6: cb6,
    comeback10: cb10,
    c4Context: {
      round4: lastPlaceAt(records, 4),
      round6: lp,
      round8: lastPlaceAt(records, 8),
    },
    c5: { changes: lc.changes, games: lc.games, failingSeeds, failingCount: lc.failingSeeds.length },
    bounties,
    events,
    flags,
    winnerPosition,
    meta,
  };
}

// ---------- text ----------

function checkLine(c: CheckRow): string {
  return [c.id.padEnd(4), c.name.padEnd(34), c.display.padEnd(12), c.threshold.padEnd(18), c.result.padEnd(7), c.note]
    .join("")
    .trimEnd();
}

function gateLine(d: ReportData): string {
  if (d.role !== "GATE") return "GATE: n/a (info config)";
  return d.gate === "PASS" ? "GATE: PASS" : `GATE: FAIL (${d.gateFailing.join(" ")})`;
}

/** Plain text, no colours, `\n` line endings, no trailing spaces. Total: never throws, prints "no games" when empty. */
export function formatReport(d: ReportData): string {
  const out: string[] = [];
  const add = (...lines: string[]) => out.push(...lines.map((l) => l.trimEnd()));
  const section = (title: string) => {
    out.push("");
    out.push(title);
  };

  add("EMPIRE 2.0 SIMULATION REPORT");
  add(
    `config: ${d.id}  map=${d.map} players=${d.n} field=${d.field} games=${d.games} seeds=${d.seedBase}..${d.seedBase + Math.max(d.games, 1) - 1}`,
  );
  add(`base: ${d.base} (${d.base === "play" ? "EMPIRE2_PLAY_RULES" : "EMPIRE2_RULES"})`);
  add(`know=${d.knowP} slow=${d.slowP}`);
  add(`rules overrides: ${Object.keys(d.overrides).length > 0 ? JSON.stringify(d.overrides) : "none"}`);
  const r = d.rulesInForce;
  add(
    `rules in force: winPoints=${r.winPoints} baseIncome=${r.baseIncome} startInfluence=${r.startInfluence} expandCost=${r.expandCost} cityCost=${r.cityCost} colonizeCost=${r.colonizeCost} annexCost=${r.annexCost} countriesPerTerritory=${r.countriesPerTerritory}`,
  );
  if (d.games === 0) {
    add("no games");
    return out.join("\n") + "\n";
  }

  section("CHECKS");
  add(
    ["ID".padEnd(4), "Check".padEnd(34), "Value".padEnd(12), "Threshold".padEnd(18), "Result".padEnd(7), "Note"].join("").trimEnd(),
  );
  add("-".repeat(90));
  for (const c of d.checks) add(checkLine(c));
  add(gateLine(d));

  section("STRATEGIES");
  add(
    [
      "Strategy".padEnd(12), "Games".padStart(7), "Win%".padStart(8), "95% CI".padStart(14), "Avg VP".padStart(8),
      "Countries".padStart(10), "Cities".padStart(8), "Annexes".padStart(9), "Idle%".padStart(7),
    ].join(""),
  );
  for (const s of d.strategies) {
    const lo = Math.max(0, s.ciLo) * 100;
    const hi = Math.min(1, s.ciHi) * 100;
    add(
      [
        s.strategy.padEnd(12),
        String(s.appearances).padStart(7),
        pct(s.winRate).padStart(8),
        `${lo.toFixed(1)}-${hi.toFixed(1)}`.padStart(14),
        s.avgVp.toFixed(2).padStart(8),
        s.countries.toFixed(2).padStart(10),
        s.cities.toFixed(2).padStart(8),
        s.annexes.toFixed(2).padStart(9),
        pct(s.idleShare).padStart(7),
      ].join(""),
    );
  }

  section("SEATS");
  add(["Seat".padStart(6), "Win%".padStart(8), "Dev(pts)".padStart(10)].join(""));
  for (const s of d.seats) {
    add([String(s.seat + 1).padStart(6), pct(s.winRate).padStart(8), `${s.devPts.toFixed(1)}`.padStart(10)].join(""));
  }

  section("GAME LENGTH");
  add(
    `mean ${d.length.mean.toFixed(2)}  median ${d.length.median.toFixed(2)}  p10 ${d.length.p10.toFixed(2)}  p90 ${d.length.p90.toFixed(2)}  estMinutes ${d.length.estMinutes.toFixed(1)}`,
  );
  d.length.histogram.forEach((count, k) => {
    const share = (count / d.games) * 100;
    const bar = "#".repeat(Math.min(50, Math.floor(share / 2)));
    add(`R${String(k + 1).padStart(2, "0")} ${String(count).padStart(5)} ${bar}`);
  });

  section("POINT SOURCES");
  add(["Source".padEnd(16), "Winners%".padStart(10), "All%".padStart(8)].join(""));
  const srcNames: [string, "territory" | "cities" | "regionSets" | "largestEmpire" | "explorer"][] = [
    ["territory", "territory"], ["cities", "cities"], ["region sets", "regionSets"], ["largest empire", "largestEmpire"], ["explorer", "explorer"],
  ];
  for (const [label, key] of srcNames) {
    if (key === "explorer" && !d.explorerTitle) {
      add(`${label.padEnd(16)}n/a (title off)`);
      continue;
    }
    add([label.padEnd(16), pct(d.pointSources.winners[key]).padStart(10), pct(d.pointSources.all[key]).padStart(8)].join(""));
  }

  section("INFLUENCE");
  for (const s of d.strategies) {
    const f = s.influence;
    add(
      `${s.strategy}: spent per appearance expand ${f.spent.expand.toFixed(2)}, colonize ${f.spent.colonize.toFixed(2)}, city ${f.spent.city.toFixed(2)}, annex ${f.spent.annex.toFixed(2)}; bounty ${f.bountyInfluence.toFixed(2)}; total income ${f.income.toFixed(2)}; left over ${f.leftover.toFixed(2)}`,
    );
  }
  add(
    `income by round: 1-4 ${d.incomeBuckets[0].mean.toFixed(2)}, 5-9 ${d.incomeBuckets[1].mean.toFixed(2)}, 10+ ${d.incomeBuckets[2].mean.toFixed(2)}`,
  );

  section("TURN DIAGNOSTICS");
  const t = d.turn;
  add(
    `threeExpandRate: ${pct(t.threeExpandRate)}`,
    `threeExpandRate rounds 1-4: ${pct(t.threeExpandByBucket[0])}`,
    `threeExpandRate rounds 5-9: ${pct(t.threeExpandByBucket[1])}`,
    `threeExpandRate rounds 10+: ${pct(t.threeExpandByBucket[2])}`,
    `noFrontierRate: ${pct(t.noFrontierRate)}`,
    `unstuckRate: ${pct(t.unstuckRate)}`,
    `stuckIdleRate: ${pct(t.stuckIdleRate)}`,
    `secondTurns: ${t.secondTurns}`,
    `reachedTarget/secondTurns: ${t.reachedTarget} of ${t.secondTurns} (${pct(t.secondTurns === 0 ? 0 : t.reachedTarget / t.secondTurns)})`,
    `waiting won: ${pct(t.reachedTarget === 0 ? 0 : t.waitingOutcomes.won / t.reachedTarget)}`,
    `waiting dropped: ${pct(t.reachedTarget === 0 ? 0 : t.waitingOutcomes.dropped / t.reachedTarget)}`,
    `waiting preempted: ${pct(t.reachedTarget === 0 ? 0 : t.waitingOutcomes.preempted / t.reachedTarget)}`,
    `waitingPerGame: ${t.waitingPerGame.toFixed(3)}`,
  );

  section("ANNEXES AND COMEBACKS");
  add(
    `annexes per game: ${d.annexes.mean.toFixed(2)}`,
    `annexes distribution: 0: ${d.annexes.dist[0]}, 1: ${d.annexes.dist[1]}, 2: ${d.annexes.dist[2]}, 3+: ${d.annexes.dist[3]}`,
    `comeback round 6: ${pct(d.comeback6.value)} (games ${d.comeback6.games})`,
    `comeback round 10: ${pct(d.comeback10.value)} (games ${d.comeback10.games})`,
    `C4 context round 4: ${pct(d.c4Context.round4.value)} (games ${d.c4Context.round4.games})`,
    `C4 context round 6: ${pct(d.c4Context.round6.value)} (games ${d.c4Context.round6.games})`,
    `C4 context round 8: ${pct(d.c4Context.round8.value)} (games ${d.c4Context.round8.games})`,
    `C5 games with a leader change: ${d.c5.changes} of ${d.c5.games}`,
    `C5 games without a leader change: ${d.c5.failingCount}; seeds (up to 20): ${d.c5.failingSeeds.join(", ") || "none"}`,
  );

  section("EVENTS AND BOUNTIES");
  add(["Bounty".padEnd(12), "Drawn".padStart(8), "Claimed".padStart(9), "Claim%".padStart(8)].join(""));
  for (const k of BOUNTY_KINDS) {
    const drawn = d.bounties.drawn[k];
    const claimed = d.bounties.claimed[k];
    add([k.padEnd(12), String(drawn).padStart(8), String(claimed).padStart(9), pct(drawn === 0 ? 0 : claimed / drawn).padStart(8)].join(""));
  }
  add(
    [
      "Event".padEnd(14), "Rounds".padStart(8), "Games".padStart(7), "Expand".padStart(8), "Colonize".padStart(9),
      "City".padStart(7), "Annex".padStart(7), "Bounty".padStart(8),
    ].join(""),
  );
  for (const e of d.events) {
    add(
      [
        e.event.padEnd(14), String(e.rounds).padStart(8), String(e.games).padStart(7),
        e.rates.expands.toFixed(3).padStart(8), e.rates.colonizes.toFixed(3).padStart(9), e.rates.cities.toFixed(3).padStart(7),
        e.rates.annexes.toFixed(3).padStart(7), e.rates.bountiesClaimed.toFixed(3).padStart(8),
      ].join(""),
    );
  }
  add("(rates are per round)");

  section("FLAGS");
  if (d.flags.length === 0) add("none");
  for (const f of d.flags) add(`FLAG ${f}`);

  section("WINNER TURN POSITION (final round)");
  d.winnerPosition.byPosition.forEach((count, k) => {
    const share = count / d.games;
    add(`position ${k + 1}: count ${count.toFixed(1)}, share ${pct(share)}`);
  });

  out.push("");
  add(gateLine(d));
  return out.join("\n") + "\n";
}

