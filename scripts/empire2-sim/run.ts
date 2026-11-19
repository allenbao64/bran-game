/**
 * Empire 2.0 bot simulation CLI (spec section 3.4).
 * Run: node --import tsx scripts/empire2-sim/run.ts [--config id] [--gate] [--sensitivity] [--games N]
 *      [--seed-base N] [--rules path] [--know P] [--slow P] [--check] [--tuning-log "change | decision"] [--out dir]
 * Exit codes: 0 normal; 1 a GATE config fails a check; 2 bad arguments or rules file; 3 a thrown bug.
 */
import { execSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveRules } from "@/lib/empire2";
import type { Rules } from "@/lib/empire2/types";
import { CONFIGS, DEFAULT_SEED_BASE, type ConfigSpec, parseRulesOverrides, runIdFor, SENSITIVITY, variantId } from "./config";
import { computeReport, formatReport, type ReportData } from "./report";
import { runConfig } from "./runner";
import type { GameRecord } from "./types";

const USAGE = `Usage: node --import tsx scripts/empire2-sim/run.ts [--config id]... [--gate] [--sensitivity] [--games N]
  [--seed-base N] [--rules path] [--know P] [--slow P] [--check] [--tuning-log "change | decision"] [--out dir]`;

const TUNING_LOG = "docs/empire-2.0/phase2-tuning-log.md";
const DEFAULT_RULES = "scripts/empire2-sim/rules.json";
const DEFAULT_OUT = "scripts/empire2-sim/out";

function usage(message: string): never {
  console.error(message);
  console.error(USAGE);
  process.exit(2);
}

function wholeNumber(flag: string, value: string | undefined, min: number): number {
  if (value === undefined || !/^\d+$/.test(value) || Number(value) < min) usage(`${flag} needs a whole number of at least ${min}.`);
  return Number(value);
}

function probability(flag: string, value: string | undefined): number {
  const x = Number(value);
  if (value === undefined || value.trim() === "" || !Number.isFinite(x) || x < 0 || x > 1) usage(`${flag} needs a number from 0 to 1.`);
  return x;
}

type Args = {
  configs: string[];
  gate: boolean;
  sensitivity: boolean;
  games: number | null;
  seedBase: number;
  rules: string;
  know: number | null;
  slow: number | null;
  check: boolean;
  tuningLog: string | null;
  out: string;
};

function parseArgs(argv: string[]): Args {
  const a: Args = {
    configs: [], gate: false, sensitivity: false, games: null, seedBase: DEFAULT_SEED_BASE,
    rules: DEFAULT_RULES, know: null, slow: null, check: false, tuningLog: null, out: DEFAULT_OUT,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case "--config": {
        const id = next();
        if (id === undefined) usage("--config needs an id.");
        a.configs.push(id);
        break;
      }
      case "--gate": a.gate = true; break;
      case "--sensitivity": a.sensitivity = true; break;
      case "--games": a.games = wholeNumber("--games", next(), 1); break;
      case "--seed-base": a.seedBase = wholeNumber("--seed-base", next(), 0); break;
      case "--rules": {
        const p = next();
        if (p === undefined) usage("--rules needs a path.");
        a.rules = p;
        break;
      }
      case "--know": a.know = probability("--know", next()); break;
      case "--slow": a.slow = probability("--slow", next()); break;
      case "--check": a.check = true; break;
      case "--tuning-log": {
        const note = next();
        if (note === undefined || note.trim() === "") usage('--tuning-log needs a note, "change | decision".');
        a.tuningLog = note;
        break;
      }
      case "--out": {
        const p = next();
        if (p === undefined) usage("--out needs a directory.");
        a.out = p;
        break;
      }
      default:
        usage(`Unknown option: ${arg}`);
    }
  }
  return a;
}

function selectConfigs(a: Args): ConfigSpec[] {
  const all = [...CONFIGS, ...SENSITIVITY];
  if (a.configs.length > 0) {
    return a.configs.map((id) => {
      const spec = all.find((c) => c.id === id);
      if (spec === undefined) usage(`Unknown config: ${id}`);
      return spec;
    });
  }
  if (a.sensitivity) return SENSITIVITY;
  if (a.gate) return CONFIGS.filter((c) => c.role === "GATE");
  return CONFIGS;
}

function withOverrides(spec: ConfigSpec, a: Args): ConfigSpec {
  const knowP = a.know ?? spec.knowP;
  const slowP = a.slow ?? spec.slowP;
  const base = spec.id.split("+")[0];
  return { ...spec, id: variantId(base, knowP, slowP), knowP, slowP, games: a.games ?? spec.games };
}

function gitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
}

/** Appends one row to the tuning log (section 6.2). The note is "change | decision". */
function appendTuningRow(note: string, spec: ConfigSpec, seedBase: number, data: ReportData): void {
  const idx = note.lastIndexOf(" | ");
  const change = idx < 0 ? note.trim() : note.slice(0, idx).trim();
  const decision = idx < 0 ? "-" : note.slice(idx + 3).trim();
  const path = resolve(process.cwd(), TUNING_LOG);
  if (!existsSync(path)) {
    writeFileSync(path, "# Empire 2.0 phase 2: tuning log\n\n## Runs\n\n| # | change | config | games | seedBase | C1 rounds | C2 top strat (rate) | C3 dev pts | C4 % | C5 % | cap% | annexes/game | decision |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n");
  }
  const existing = readFileSync(path, "utf8");
  const rowCount = existing.split("\n").filter((line) => /^\| \d+ \|/.test(line)).length;
  const top = data.strategies.reduce((best, s) => (best === null || s.winRate > best.winRate ? s : best), data.strategies[0] ?? null);
  const topText = top === null ? "-" : `${top.strategy} (${(top.winRate * 100).toFixed(1)}%)`;
  const c = (id: string) => data.checks.find((x) => x.id === id);
  const c4 = c("C4");
  const c5 = c("C5");
  const c3 = c("C3");
  const row = [
    String(rowCount + 1),
    change,
    spec.id,
    String(data.games),
    String(seedBase),
    data.length.mean.toFixed(2),
    topText,
    c3 ? c3.value.toFixed(1) : "-",
    c4 ? c4.value.toFixed(1) : "-",
    c5 ? c5.value.toFixed(1) : "-",
    (data.turn.capShare * 100).toFixed(1),
    data.annexes.mean.toFixed(2),
    decision,
  ];
  appendFileSync(path, `| ${row.join(" | ")} |\n`);
}

function main(): void {
  const a = parseArgs(process.argv.slice(2));
  const rulesPath = resolve(process.cwd(), a.rules);
  if (!existsSync(rulesPath)) usage(`Rules file not found: ${a.rules}`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(rulesPath, "utf8"));
  } catch (e) {
    usage(`Rules file is not valid JSON: ${(e as Error).message}`);
  }
  const parsed = parseRulesOverrides(raw);
  if (!parsed.ok) {
    console.error(`Rules file ${a.rules} rejected:`);
    for (const err of parsed.errors) console.error(`  ${err}`);
    process.exit(2);
  }
  const overrides: Partial<Rules> = parsed.overrides;
  const rules = resolveRules(overrides);
  const specs = selectConfigs(a).map((s) => withOverrides(s, a));
  if (a.tuningLog !== null && a.games !== null) usage("A logged tuning run needs the full game count (drop --games).");
  const outDir = resolve(process.cwd(), a.out);
  mkdirSync(outDir, { recursive: true });
  const commit = gitCommit();
  let gateFailed = false;

  for (const spec of specs) {
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    let records: GameRecord[];
    try {
      records = runConfig(spec, { seedBase: a.seedBase, rules: overrides, check: a.check });
    } catch (e) {
      console.error(`BUG in ${spec.id}: ${(e as Error).message}`);
      process.exit(3);
    }
    const meta = { seedBase: a.seedBase, overrides, startedAt, wallSeconds: (Date.now() - t0) / 1000, node: process.version, commit };
    const data = computeReport(records, spec, rules, meta);
    const text = formatReport(data);
    process.stdout.write(text);
    const runId = runIdFor(spec.id, a.seedBase, spec.games);
    writeFileSync(join(outDir, `${runId}.txt`), text);
    writeFileSync(join(outDir, `${runId}.json`), JSON.stringify(data, null, 2) + "\n");
    writeFileSync(join(outDir, `${runId}.records.json`), JSON.stringify(records) + "\n");
    if (a.tuningLog !== null) appendTuningRow(a.tuningLog, spec, a.seedBase, data);
    if (data.gate === "FAIL") gateFailed = true;
  }
  process.exit(gateFailed ? 1 : 0);
}

main();
