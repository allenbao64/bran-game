/**
 * Shared contract for Empire mode (version 3). Each module under lib/empire/
 * implements one slice of these types so the pieces can be built and tested
 * independently, then wired into the server and screens.
 * Rules reference: the "Atlas Sprint: Turn-Based Mode Design and Build Plan" doc.
 */

export const EMPIRE_RULES = {
  turnMs: 20_000,
  winPoints: 15,
  roundCap: 15,
  startTokens: 2,
  /** After this round ends, the last-place player gets one extra steal token (once per game). */
  lateTokenRound: 8,
  fortLimit: 2,
  cardsDealt: 2,
  underdogCards: 3,
  /** The underdog must also trail the round-start leader by at least this many points. */
  underdogGap: 2,
  /** An event is revealed after every Nth full round and lasts the next round. */
  eventEvery: 3,
  wildChance: 0.1,
  /** A card is only dealt when at least this many unclaimed countries fit it. */
  minFits: 3,
  empireMin: 5,
  empireBonus: 3,
  majorityMin: 3,
  /** Island countries link to this many nearest countries by sea. */
  seaRoutesPerIsland: 2,
  /** Starting capitals need at least this many neighbours (land or sea). */
  capitalMinNeighbours: 3
} as const;

/** Region set bonus by region size: 2–4 countries +3, 5–9 +5, 10+ +8. */
export const setBonus = (regionSize: number) => regionSize <= 4 ? 3 : regionSize <= 9 ? 5 : 8;

/** Host-selectable Empire turn lengths in seconds (Blitz, Standard, Relaxed). Standard matches EMPIRE_RULES.turnMs. */
export const EMPIRE_TURN_SPEEDS = [
  { id: "blitz", label: "Blitz", seconds: 15 },
  { id: "standard", label: "Standard", seconds: 20 },
  { id: "relaxed", label: "Relaxed", seconds: 30 }
] as const;
export const DEFAULT_EMPIRE_TURN_SECONDS = 20;
export const isEmpireTurnSeconds = (value: unknown): value is number => EMPIRE_TURN_SPEEDS.some((speed) => speed.seconds === value);

export type Rng = () => number;

// ---------- Geography (lib/empire/geo.ts) ----------
export type EmpireGeo = {
  /** Land borders plus sea routes; symmetric (if A lists B, B lists A). Alpha-2 codes. */
  neighbours: (code: string) => string[];
  /** Every sea-route pair, each once, as [a, b] with a < b. */
  seaRoutes: () => [string, string][];
  /** Region = world-countries `subregion` (falls back to `region`). */
  regionOf: (code: string) => string;
  regionMembers: (region: string) => string[];
  regionNames: () => string[];
  continentOf: (code: string) => string;
  /** Capital city names for a country (some have several). */
  capitalsOf: (code: string) => string[];
  /** True when `answer` names one of the country's capitals, forgiving case, accents and a small typo. */
  isCapitalOf: (code: string, answer: string) => boolean;
  /** One starting capital per player: each has >= capitalMinNeighbours neighbours, all on different continents. */
  startingCapitals: (playerCount: number, rng: Rng) => string[];
};

// ---------- Cards and events (lib/empire/cards.ts) ----------
export type CardKind =
  | "letter" | "short" | "long" | "continent" | "region" | "landlocked" | "island"
  | "bordersYou" | "bordersCountry" | "wild";
export type EmpireCard = {
  kind: CardKind;
  letter?: string;      // letter: name starts with it
  max?: number;         // short: at most this many letters (5–7)
  min?: number;         // long: at least this many letters (9–11)
  continent?: string;   // continent
  region?: string;      // region
  country?: string;     // bordersCountry: alpha-2 code of the named country
};
export type EventKind = "goldRush" | "ceasefire" | "freeSteals" | "closedContinent" | "wildRound";
export type EmpireEvent = { kind: EventKind; continent?: string };

export type CardContext = {
  /** Countries owned by the player the card is for. */
  ownedByMe: Set<string>;
  neighbours: (code: string) => string[];
};
export type DealContext = CardContext & {
  unclaimed: string[];
  event: EmpireEvent | null;
  rng: Rng;
};
export type EmpireCards = {
  cardFits: (card: EmpireCard, code: string, ctx: CardContext) => boolean;
  cardLabel: (card: EmpireCard) => string;
  /** Deals up to `count` distinct playable cards (each fits >= minFits unclaimed countries); a wildRound event makes every card wild. Late in a game the hand may be shorter (at least 1 card) rather than repeat a card. */
  dealHand: (count: number, ctx: DealContext) => EmpireCard[];
  drawEvent: (rng: Rng, continents: string[]) => EmpireEvent;
  eventLabel: (event: EmpireEvent) => string;
};

// ---------- Game state ----------
export type EmpirePlayer = { id: string; capital: string; stealTokens: number; forts: string[]; lateTokenGiven?: boolean };
export type EmpireLogEntry = {
  kind: "claim" | "steal" | "fortify" | "pass";
  playerId: string;
  code?: string;
  /** steal: the previous owner. */
  from?: string;
  /** claim: points earned (2 during gold rush, else 1). */
  points?: number;
  round: number;
  at: number;
};
export type EmpireState = {
  /** Seat order. */
  players: EmpirePlayer[];
  /** Country code -> owner player id. Capitals are included from the start. */
  owners: Record<string, string>;
  /** 1-based. */
  round: number;
  /** Index into players of whose turn it is. Turn order snakes: odd rounds go seat 0..n-1, even rounds n-1..0. */
  seat: number;
  /** Total score of each player when the current round began (everyone has had equal turns). Drives the underdog hand and the steal rule. Older saved games omit it. */
  roundStartTotals?: Record<string, number>;
  turnStartedAt: number;
  /** Length of each turn in ms; older saved games omit it and use EMPIRE_RULES.turnMs. */
  turnMs?: number;
  /** Current holder of the largest-empire bonus (keeps it on a tie). */
  empireHolder: string | null;
  /** Event active for the current round, if any. */
  event: EmpireEvent | null;
  /** Cards dealt to the current player and the index they picked (null until picked). */
  hand: EmpireCard[];
  chosen: number | null;
  log: EmpireLogEntry[];
  finished: boolean;
  winnerIds: string[];
};

// ---------- Scoring (lib/empire/scoring.ts) ----------
export type ScoreBreakdown = {
  countries: number;
  /** Extra points from gold-rush claims still credited to this player (claim points - 1). */
  goldRush: number;
  empireSize: number;
  empire: number;
  sets: { region: string; points: number }[];
  majorities: string[];
  total: number;
};
export type ScoreResult = {
  scores: Record<string, ScoreBreakdown>;
  /** New largest-empire holder: biggest connected group >= empireMin, strictly biggest, or the previous holder keeps it on a tie. */
  empireHolder: string | null;
};
export type EmpireScoring = {
  scoreEmpire: (state: Pick<EmpireState, "players" | "owners" | "empireHolder" | "log">, geo: Pick<EmpireGeo, "neighbours" | "regionOf" | "regionMembers" | "regionNames">) => ScoreResult;
  /** Countries that can't be stolen: capitals, forts, and every country in a completed region set. */
  protectedCodes: (state: Pick<EmpireState, "players" | "owners">, geo: Pick<EmpireGeo, "regionOf" | "regionMembers" | "regionNames">) => Set<string>;
  /** Winner ids: anyone at >= winPoints after their own turn ends the game; at the round cap the highest total wins; ties -> more countries -> shared. */
  winners: (scores: Record<string, ScoreBreakdown>, reason: "points" | "cap") => string[];
};

// ---------- Actions (lib/empire/actions.ts) ----------
export type EmpireAction =
  | { type: "pick"; index: number }
  | { type: "claim"; code: string }
  | { type: "steal"; code: string; capital: string }
  | { type: "fortify"; code: string }
  | { type: "pass" };
export type ActionError = { error: string; status: number };
export type EmpireDeps = {
  geo: EmpireGeo;
  cards: EmpireCards;
  scoring: EmpireScoring;
  rng: Rng;
};
export type EmpireActions = {
  /** `turnMs` overrides EMPIRE_RULES.turnMs for this game (stored on the state). */
  initEmpire: (playerIds: string[], now: number, deps: EmpireDeps, turnMs?: number) => EmpireState;
  /** Validates and applies one action by `playerId`; never mutates `state`. */
  applyAction: (state: EmpireState, playerId: string, action: EmpireAction, now: number, deps: EmpireDeps) => EmpireState | ActionError;
  /** Lazily applies turn timeouts (each expired turn (state.turnMs, default 20 s) = pass). */
  advanceTimeouts: (state: EmpireState, now: number, deps: EmpireDeps) => EmpireState;
};
