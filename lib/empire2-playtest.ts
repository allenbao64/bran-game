import { EMPIRE2_PLAY_RULES } from "@/lib/empire2/rules";
import type { Rules } from "@/lib/empire2/types";

/** The owner's candidate values. Must equal scripts/empire2-sim/rules-candidate.json (a test checks this). */
export const EMPIRE2_PLAYTEST_OVERRIDES = { colonizeCost: 6, winPoints: 16, underdogIncome: 3, underdogGap: 1, largestEmpirePoints: 4 } as const;

/** Full rules for every empire2 room. Pass this whole object as GameConfig.rules. */
export function playtestRules(underdogBoomPick: boolean): Rules {
  return { ...EMPIRE2_PLAY_RULES, ...EMPIRE2_PLAYTEST_OVERRIDES, underdogBoomPick };
}

/** Host-picked clock. seconds 0 means no time limit (the wire and room value; the engine uses null). */
export const EMPIRE2_TURN_SPEEDS = [
  { id: "quick", label: "Quick", seconds: 20 },
  { id: "standard", label: "Standard", seconds: 30 },
  { id: "relaxed", label: "Relaxed", seconds: 45 },
  { id: "untimed", label: "No time limit", seconds: 0 },
] as const;
export const DEFAULT_EMPIRE2_TURN_SECONDS = 30;
export const isEmpire2TurnSeconds = (value: unknown): value is number => EMPIRE2_TURN_SPEEDS.some((s) => s.seconds === value);

/** Host seconds (0 = no time limit) to the engine clock: null when untimed. */
export function empire2TurnMs(seconds: number): number | null { return seconds === 0 ? null : seconds * 1000; }

export type Empire2Phase = "capital" | "foothold" | "boomPick" | "playing" | "ended";
export type Empire2Action =
  | { type: "pickCapital"; code: string } | { type: "pickFoothold"; code: string }
  | { type: "expand"; code: string } | { type: "colonize"; code: string }
  | { type: "city"; code: string; capital: string } | { type: "annex"; code: string; capital: string }
  | { type: "pickBoom"; region: string } | { type: "endTurn" };
export type Empire2Vp = { total: number; cities: number; regionSets: { region: string; points: number }[]; largestEmpire: number; territory: number; explorer: number };
export type Empire2Income = { base: number; territory: number; cities: number; boom: number; underdog: number; total: number };
export type Empire2ViewPlayer = {
  id: string; name: string; color: string; host: boolean;
  influence: number; capital: string | null; foothold: string | null;
  countries: number; cities: number; titles: string[];          // titles: "Largest empire" when held
  vp: Empire2Vp;
  income: Empire2Income | null;                                 // last round's collection; null during setup
};
export type Empire2Costs = { expand: number | null; colonize: number; city: number; annex: number | null; relief: boolean };
export type Empire2Legal = { expand: string[]; colonize: string[]; city: string[]; annex: string[] };
export type Empire2View = {
  phase: Empire2Phase;
  viewerId: string;
  currentPlayerId: string | null;
  round: number; roundCap: number; winPoints: number;
  turnMs: number | null;                                       // null = no time limit
  deadline: number | null;                                     // server ms; null when no clock runs
  serverNow: number;                                           // server ms at the read
  underdogBoomPick: boolean;
  players: Empire2ViewPlayer[];                                // room join order (colours follow this order)
  owners: Record<string, string>;                              // country code to player id
  cities: string[];
  frontier: string[];                                          // viewer's frontier codes; [] when ended
  setup: { step: "capital" | "foothold"; offers: string[] | null; footholds: string[] | null } | null;
  boomPick: { playerId: string; region: string | null; by: "player" | "timeout" | null; regions: string[] } | null;
  booms: string[];
  bounties: { id: string; label: string }[];
  event: string | null;                                        // eventLabel(kind)
  turn: { playerId: string; expands: number; colonizes: number; annexed: boolean; second: boolean } | null;
  legal: Empire2Legal | null;                                  // only for the current player in phase "playing"
  costs: Empire2Costs | null;                                  // same condition as legal
  log: string[];                                               // plain text, newest first, at most 12
  result: { reason: "points" | "cap" | "hostEnded"; winnerIds: string[] } | null;
};
