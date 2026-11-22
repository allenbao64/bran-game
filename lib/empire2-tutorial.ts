/**
 * The Empire 2.0 practice tutorial: a fixed two-player position on the real engine. Client-safe: no room, no API,
 * no random draws (the rng throws if the engine ever asks for one). Rival moves are not simulated.
 */
import { applyAction } from "@/lib/empire2/engine";
import { empire2Geo } from "@/lib/empire2/geo-adapter";
import { countryByCode } from "@/lib/countries";
import { playtestRules } from "@/lib/empire2-playtest";
import type { Action, Ctx, EmpireState, EngineErrorCode } from "@/lib/empire2/types";

export const TUTORIAL_SEEN_KEY = "bran-e2-tutorial-seen-v1";
export const ME = "you";
export const RIVAL = "rival";

const rules = playtestRules(false);

/** Hints name the country, never the answer. Errors not listed fall back to FALLBACK_HINT. */
export const FALLBACK_HINT = "Not quite. Try the outlined country or the button.";
const NOT_ENOUGH = "Not enough influence. Check the cost on the button.";
const countryName = (code: string) => countryByCode(code)?.name ?? code;
const wrongCapitalOf = (code: string) => `That's not the capital city of ${countryName(code)}. Try again.`;
const EXPAND_HINTS: Partial<Record<EngineErrorCode, string | ((code: string) => string)>> = {
  notOnFrontier: "Expand only works next to your empire. Tap an outlined country.",
  countryTaken: "That one is already taken. Look for an outlined country.",
  notEnoughInfluence: NOT_ENOUGH,
};

export type TutorialStep = {
  id: string;
  heading: string;                                      // at most four words
  text: string;                                         // at most two short sentences
  kind: "intro" | "expand" | "settle" | "stronghold" | "takeOver" | "endTurn";
  /** The scripted move the "Show me" button plays through applyAction. null for the intro. */
  script: Action | null;
  /** Country the demo points at (outline and label). */
  target: string | null;
  /** Button label for the step's action. */
  button: string;
  /** Step needs a typed real-world capital city. */
  needsCapital: boolean;
  hints: Partial<Record<EngineErrorCode, string | ((code: string) => string)>>;
  /** True when the step's action has been done (on any state reached by a legal move of this kind). */
  done: (state: EmpireState) => boolean;
};

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "empire", heading: "Your empire",
    text: `Every country you own is your empire. First to ${rules.winPoints} points wins.`,
    kind: "intro", script: null, target: null, button: "", needsCapital: false, hints: {},
    done: () => true,
  },
  {
    id: "expand", heading: "Expand",
    text: "Expand into a free country that touches your empire. Your first expand each turn is free.",
    kind: "expand", script: { type: "expand", code: "BE" }, target: "BE", button: "Expand (free)", needsCapital: false,
    hints: EXPAND_HINTS,
    done: (state) => (state.turn?.expands ?? 0) >= 1,
  },
  {
    id: "second", heading: "Second expand",
    text: `A second expand costs ${rules.expandCost} influence. You can make ${rules.maxExpandsPerTurn} expands a turn.`,
    kind: "expand", script: { type: "expand", code: "LU" }, target: "LU", button: `Expand (${rules.expandCost})`, needsCapital: false,
    hints: EXPAND_HINTS,
    done: (state) => (state.turn?.expands ?? 0) >= 2,
  },
  {
    id: "settle", heading: "Settle",
    text: `Settle any free country anywhere for ${rules.colonizeCost} influence. It doesn't need to touch you.`,
    kind: "settle", script: { type: "colonize", code: "BR" }, target: "BR", button: `Settle (${rules.colonizeCost})`, needsCapital: false,
    hints: { countryTaken: "Settle takes a free country, one nobody owns.", notEnoughInfluence: NOT_ENOUGH },
    done: (state) => (state.turn?.colonizes ?? 0) >= 1,
  },
  {
    id: "stronghold", heading: "Stronghold",
    text: `Build a stronghold in a country you own for ${rules.cityCost} influence. It scores ${rules.cityPoints} point and pays ${rules.cityIncome} a round.`,
    kind: "stronghold", script: { type: "city", code: "DE", capital: "Berlin" }, target: "DE", button: `Stronghold (${rules.cityCost})`, needsCapital: true,
    hints: {
      wrongCapital: wrongCapitalOf,
      notOwned: "You can only build strongholds in countries you own.",
      notEnoughInfluence: NOT_ENOUGH,
    },
    done: (state) => state.cities.length >= 1,
  },
  {
    id: "takeover", heading: "Take over",
    text: `Take over a rival's country that touches yours for ${rules.annexCost}, if they have at least your points. Name its capital city.`,
    kind: "takeOver", script: { type: "annex", code: "ES", capital: "Madrid" }, target: "ES", button: `Take over (${rules.annexCost})`, needsCapital: true,
    hints: {
      protectedStartingCapital: "Home countries can't be taken over. Pick another rival country.",
      protectedFoothold: "Outposts can't be taken over. Pick another rival country.",
      notRival: "Pick a country a rival owns.",
      notBordering: "Take over a country that touches yours.",
      wrongCapital: wrongCapitalOf,
      notEnoughInfluence: NOT_ENOUGH,
    },
    done: (state) => state.turn?.annexed === true,
  },
  {
    id: "end", heading: "End your turn",
    text: "Press End turn to pass play on. Each round, everyone takes one turn.",
    kind: "endTurn", script: { type: "endTurn" }, target: null, button: "End turn", needsCapital: false, hints: {},
    done: (state) => state.turn?.playerId === RIVAL,
  },
];

/** The practice position: you hold France (home) and Germany (outpost); the rival holds Italy, Poland and Spain. */
export function createTutorialState(): EmpireState {
  return {
    version: 1,
    phase: "play",
    rules,
    turnMs: null,                       // no time limit: nothing in the practice game can expire
    players: [
      { id: ME, seat: 0, influence: 16, capital: "FR", foothold: "DE" },
      { id: RIVAL, seat: 1, influence: 3, capital: "IT", foothold: "PL" },
    ],
    owners: { FR: ME, DE: ME, IT: RIVAL, ES: RIVAL, PL: RIVAL },
    cities: [],
    setup: null,
    round: 3,
    turn: {
      playerId: ME, seat: 0, indexInRound: 0, isSecondOfTwo: false, startedAt: 0,
      noFrontierAtStart: false, expands: 0, colonizes: 0, annexed: false, actions: [],
    },
    roundStartVp: { [ME]: 0, [RIVAL]: 0 },
    booms: [],
    bounties: [],
    event: null,
    titles: { largestEmpire: null, explorer: null },
    waitingWin: [],
    lastIncome: null,
    log: [],
    result: null,
  };
}

/** The engine context for the tutorial: fixed clock, and any random draw is a bug. */
export const TUTORIAL_CTX: Ctx = {
  geo: empire2Geo,
  rng: () => {
    throw new Error("tutorial rng");
  },
  now: 0,
};

export type StepResult =
  | { ok: true; state: EmpireState }
  | { ok: false; code: EngineErrorCode; hint: string };

/** Applies one move for the practice player. Maps an engine error to a one-line hint (never the engine's own text). */
export function runScriptedStep(state: EmpireState, step: TutorialStep, action: Action, ctx: Ctx = TUTORIAL_CTX): StepResult {
  const r = applyAction(state, ME, action, ctx);
  if (r.ok) return { ok: true, state: r.state };
  const code = r.error.code;
  const picked = (action as { code?: string }).code ?? "";
  const hint = step.hints[code];
  return { ok: false, code, hint: typeof hint === "function" ? hint(picked) : hint ?? FALLBACK_HINT };
}

/** True when the step's action has been done in `state`. */
export function stepIsComplete(step: TutorialStep, state: EmpireState): boolean {
  return step.done(state);
}

/** Storage helpers: every access can throw (private mode, blocked site data), so each one is guarded. */
export function tutorialSeen(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(TUTORIAL_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markTutorialSeen(): void {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(TUTORIAL_SEEN_KEY, "1");
  } catch {
    // Storage is blocked: the first-time prompt may show again, which is acceptable.
  }
}
