import { EMPIRE2_PLAY_RULES, EMPIRE2_RULES } from "@/lib/empire2";
import type { Rules } from "@/lib/empire2/types";

/** The base rules a run starts from (run.ts --base). "play" is EMPIRE2_PLAY_RULES; "default" is EMPIRE2_RULES. */
export const BASE_NAMES = ["play", "default"] as const;
export type BaseName = (typeof BASE_NAMES)[number];

/** The base as overrides on top of EMPIRE2_RULES. The default base adds nothing, so its runs are unchanged. */
export function baseOverrides(base: BaseName): Partial<Rules> {
  return base === "play" ? { ...EMPIRE2_PLAY_RULES } : {};
}

/** The base name from a command-line value, or null when it is not one of BASE_NAMES. */
export function parseBase(value: string | undefined): BaseName | null {
  return (BASE_NAMES as readonly string[]).includes(value ?? "") ? (value as BaseName) : null;
}

export const KNOW_P = 0.6;
export const DEFAULT_SEED_BASE = 0;
export const MAX_TURNS_PER_GAME = 6000;
export const MAX_ACTIONS_PER_TURN = 40;

export type CheckId = "C1" | "C2" | "C3" | "C4" | "C5";
export type MapKind = "real" | "mini";
export type Field = "pure" | "mixed";

export type ConfigSpec = {
  id: string;                 // base id, plus "+know30" / "+know90" / "+slow10" for sensitivity variants
  map: MapKind;
  n: number;
  field: Field;
  games: number;
  role: "GATE" | "info";
  checks: CheckId[];          // rows shown in the CHECKS table
  reportOnly: CheckId[];      // shown, but not counted by the gate
  knowP: number;
  slowP: number;
};

const ALL: CheckId[] = ["C1", "C2", "C3", "C4", "C5"];

export const CONFIGS: ConfigSpec[] = [
  { id: "real-3p-pure", map: "real", n: 3, field: "pure", games: 2000, role: "GATE", checks: ALL, reportOnly: [], knowP: KNOW_P, slowP: 0 },
  { id: "real-4p-pure", map: "real", n: 4, field: "pure", games: 2000, role: "GATE", checks: ALL, reportOnly: ["C1"], knowP: KNOW_P, slowP: 0 },
  { id: "real-3p-mixed", map: "real", n: 3, field: "mixed", games: 2000, role: "GATE", checks: ["C1", "C3", "C4", "C5"], reportOnly: [], knowP: KNOW_P, slowP: 0 },
  { id: "real-2p-pure", map: "real", n: 2, field: "pure", games: 2000, role: "info", checks: ALL, reportOnly: [], knowP: KNOW_P, slowP: 0 },
  { id: "mini-2p-pure", map: "mini", n: 2, field: "pure", games: 500, role: "info", checks: ALL, reportOnly: [], knowP: KNOW_P, slowP: 0 },
  { id: "mini-3p-pure", map: "mini", n: 3, field: "pure", games: 500, role: "info", checks: ALL, reportOnly: [], knowP: KNOW_P, slowP: 0 },
  { id: "mini-4p-pure", map: "mini", n: 4, field: "pure", games: 500, role: "info", checks: ALL, reportOnly: [], knowP: KNOW_P, slowP: 0 },
];

export const GATE_IDS = ["real-3p-pure", "real-4p-pure", "real-3p-mixed"];

/** Sensitivity runs: info only, 1000 games each (section 3.3). */
export const SENSITIVITY: ConfigSpec[] = [
  { id: "real-3p-pure+know30", map: "real", n: 3, field: "pure", games: 1000, role: "info", checks: ALL, reportOnly: [], knowP: 0.3, slowP: 0 },
  { id: "real-3p-pure+know90", map: "real", n: 3, field: "pure", games: 1000, role: "info", checks: ALL, reportOnly: [], knowP: 0.9, slowP: 0 },
  { id: "real-3p-pure+slow10", map: "real", n: 3, field: "pure", games: 1000, role: "info", checks: ALL, reportOnly: [], knowP: KNOW_P, slowP: 0.1 },
];

/** Rules that tuning may change, with the allowed range (section 1 table). */
export const TUNABLE_RANGES: Record<string, [number, number]> = {
  winPoints: [8, 16],
  baseIncome: [1, 3],
  startInfluence: [2, 5],
  countriesPerTerritory: [3, 5],
  cityIncome: [1, 2],
  boomIncome: [1, 2],
  boomCityIncome: [1, 3],       // also >= boomIncome
  underdogGap: [1, 5],
  underdogIncome: [0, 6],
  bountyPay: [1, 3],            // also <= goldRushBountyPay
  expandCost: [1, 2],
  maxExpandsPerTurn: [1, 3],
  cityCost: [2, 5],
  colonizeCost: [3, 6],
  annexCost: [4, 8],
  maxCities: [3, 6],
  largestEmpirePoints: [1, 5],
  boomRegionCount: [2, 6],
  largestEmpireMin: [5, 8],
  explorerMinContinents: [3, 5],
};

/**
 * Engine options (plan step 2): each takes one of the listed strings, or a boolean. The defaults are the current rules.
 * They are accepted in rules.json like the tunable numbers, and validated the same way.
 */
export const OPTION_CHOICES: Record<string, readonly string[] | "boolean"> = {
  turnOrder: ["snake", "clockwise", "rotate", "leaderLast"],
  winCheck: ["endOfTurn", "endOfRound"],
  territoryPoints: "boolean",
  explorerTitle: "boolean",
  cheapColonize: ["everyStuckTurn", "oncePerGame"],
};

/** Fields that must not change during tuning (a change means a rule change: STOP). */
export const PINNED_KEYS: string[] = [
  "freeExpandsPerTurn", "colonizeReliefCost", "minColonizeCost", "tradeWindsColonizeCost",
  "goldenAgeCityIncome", "goldRushBountyPay", "closedBordersExtra", "bountyCount",
  "bountyMinFits", "eventEvery", "roundCap", "capitalOffers", "capitalMinNeighbours", "minPlayers",
  "maxPlayers", "defaultTurnMs", "allowedTurnMs", "cityPoints", "explorerPoints",
];

/** The design values (section 1 table) that the tuning summary compares against. */
export const DESIGN_VALUES: Record<string, number> = {
  winPoints: 10, baseIncome: 2, startInfluence: 3, countriesPerTerritory: 4, cityIncome: 1, boomIncome: 1,
  boomCityIncome: 2, underdogGap: 2, underdogIncome: 2, bountyPay: 2, expandCost: 1, cityCost: 3,
  colonizeCost: 4, annexCost: 5, maxCities: 4, largestEmpireMin: 6, explorerMinContinents: 4,
};

export type RulesParse =
  | { ok: true; overrides: Partial<Rules> }
  | { ok: false; errors: string[] };

/** Validates a rules override object (the content of rules.json). Never accepts pinned, unknown or out-of-range keys. */
export function parseRulesOverrides(raw: unknown): RulesParse {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ["rules file must be a JSON object"] };
  }
  const errors: string[] = [];
  const overrides: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (PINNED_KEYS.includes(key)) {
      errors.push(`"${key}" is pinned (a rule change, not a tuning value)`);
      continue;
    }
    if (key in OPTION_CHOICES) {
      const choice = OPTION_CHOICES[key];
      if (choice === "boolean") {
        if (typeof value !== "boolean") errors.push(`"${key}" must be true or false`);
        else overrides[key] = value;
      } else if (typeof value !== "string" || !choice.includes(value)) {
        errors.push(`"${key}" must be one of ${choice.map((c) => `"${c}"`).join(", ")}`);
      } else {
        overrides[key] = value;
      }
      continue;
    }
    if (!(key in TUNABLE_RANGES)) {
      errors.push(`"${key}" is an unknown or non-tunable key`);
      continue;
    }
    if (typeof value !== "number" || !Number.isInteger(value)) {
      errors.push(`"${key}" must be a whole number`);
      continue;
    }
    const [min, max] = TUNABLE_RANGES[key];
    if (value < min || value > max) {
      errors.push(`"${key}" = ${value} is outside the allowed range ${min} to ${max}`);
      continue;
    }
    overrides[key] = value;
  }
  if (errors.length === 0) {
    const boomIncome = (overrides.boomIncome as number | undefined) ?? EMPIRE2_RULES.boomIncome;
    const boomCityIncome = (overrides.boomCityIncome as number | undefined) ?? EMPIRE2_RULES.boomCityIncome;
    if (boomCityIncome < boomIncome) errors.push(`"boomCityIncome" (${boomCityIncome}) must be >= "boomIncome" (${boomIncome})`);
    const bountyPay = (overrides.bountyPay as number | undefined) ?? EMPIRE2_RULES.bountyPay;
    if (EMPIRE2_RULES.goldRushBountyPay < bountyPay) errors.push(`"bountyPay" (${bountyPay}) must be <= "goldRushBountyPay" (${EMPIRE2_RULES.goldRushBountyPay})`);
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, overrides: overrides as Partial<Rules> };
}

/** Config id with the sensitivity tags for a knowledge and slow-model setting. */
export function variantId(base: string, knowP: number, slowP: number): string {
  const know = knowP === KNOW_P ? "" : `+know${Math.round(knowP * 100)}`;
  const slow = slowP === 0 ? "" : `+slow${Math.round(slowP * 100)}`;
  return `${base}${know}${slow}`;
}

/** File-name form of a config id (no "+"), used in run ids. */
export function runIdFor(id: string, seedBase: number, games: number): string {
  return `${id.replace(/\+/g, "_")}_seed${seedBase}_${games}g`;
}
