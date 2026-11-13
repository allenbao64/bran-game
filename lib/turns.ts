/**
 * Generic turn infrastructure: pure functions over a serialisable turn state.
 * Game-specific rules (cards, scoring) live elsewhere (see turn-rules.ts), so
 * other turn-based modes can reuse this module with their own deal payload.
 * The engine knows nothing about scores: when a phase ends it asks `onPhaseEnd`
 * whether another (sudden-death) phase should be played.
 */
export const DEFAULT_TURN_MS = 15_000;

/** An optional extra phase played after the normal rounds, by only some players. */
export type SuddenPhase = {
  /** Players still in it, in normal turn order. Always >= 2. */
  order: string[];
  /** `number` of the first turn of the CURRENT sudden-death round. */
  startNumber: number;
  /** 1-based sudden-death round being played (stays at the last round played once the game finishes). */
  round: number;
  maxRounds: number;
};

export type TurnState<Deal = unknown> = {
  /** 0-based count of turns taken so far; also the compare-and-set token. */
  number: number;
  /** Player ids in join order. */
  order: string[];
  /** When the current turn started (ms epoch). */
  startedAt: number;
  turnMs: number;
  /** Every player gets this many turns. */
  totalRounds: number;
  /** What the current player has been dealt (null once finished). */
  deal: Deal | null;
  finished: boolean;
  /** Present once normal rounds ended in a tie and sudden death began. Never removed. */
  sudden?: SuddenPhase;
};

/** Called when a phase ends (normal rounds, or one sudden-death round). Return the next sudden-death phase, or null to end the game. */
export type PhaseEnd<Deal> = (state: TurnState<Deal>) => SuddenPhase | null;

export function createTurnState<Deal>(order: string[], startedAt: number, totalRounds: number, deal: Deal | null, turnMs = DEFAULT_TURN_MS): TurnState<Deal> {
  return { number: 0, order: [...order], startedAt, turnMs, totalRounds, deal, finished: order.length === 0 || totalRounds <= 0 };
}

/** Normal turns only. */
export const totalTurns = (state: TurnState<unknown>) => state.order.length * state.totalRounds;

/** Whether the phase the state is in (normal, or the current sudden-death round) has no turns left. */
export const isPhaseOver = (state: TurnState<unknown>) => (state.sudden
  ? state.number - state.sudden.startNumber >= state.sudden.order.length
  : state.number >= totalTurns(state));

/** Turns left in the CURRENT phase (sudden: the rest of the current sudden-death round). Never negative. */
export function turnsLeft(state: TurnState<unknown>): number {
  if (state.finished) return 0;
  const left = state.sudden
    ? state.sudden.startNumber + state.sudden.order.length - state.number
    : totalTurns(state) - state.number;
  return Math.max(0, left);
}

export function currentPlayerId(state: TurnState<unknown>): string | null {
  if (state.finished) return null;
  if (state.sudden) return state.sudden.order[state.number - state.sudden.startNumber] ?? null;
  return state.order.length === 0 ? null : state.order[state.number % state.order.length];
}
export function isPlayersTurn(state: TurnState<unknown>, playerId: string) {
  return currentPlayerId(state) === playerId;
}
/** 1-based round for a turn number, capped at the last round. */
export function roundOfTurn(state: TurnState<unknown>, turnNumber: number) {
  return Math.min(state.totalRounds, Math.floor(turnNumber / Math.max(1, state.order.length)) + 1);
}
export const currentRound = (state: TurnState<unknown>) => roundOfTurn(state, state.number);

export function msLeft(state: TurnState<unknown>, now: number) {
  return Math.max(0, state.startedAt + state.turnMs - now);
}
/** How many full turns have elapsed since the stored turn start. */
export function expiredTurns(state: TurnState<unknown>, now: number) {
  if (state.finished) return 0;
  return Math.max(0, Math.floor((now - state.startedAt) / state.turnMs));
}

/**
 * Moves to the next turn (after a claim, pass or timeout). Finishes when `exhausted`, or when the current phase is
 * over and `onPhaseEnd` returns no further phase. Without `onPhaseEnd` the game finishes after the normal turns.
 */
export function nextTurn<Deal>(state: TurnState<Deal>, now: number, deal: Deal | null, exhausted = false, onPhaseEnd?: PhaseEnd<Deal>): TurnState<Deal> {
  const next: TurnState<Deal> = { ...state, number: state.number + 1, startedAt: now, deal, finished: state.finished || exhausted };
  if (!next.finished && isPhaseOver(next)) {
    const sudden = onPhaseEnd?.(next) ?? null;
    if (sudden) next.sudden = sudden;
    else next.finished = true;
  }
  if (next.finished) next.deal = null;
  return next;
}

/**
 * Lazily applies timeouts: every fully expired turn counts as a pass (`onExpire` is told about each one).
 * `deal` is called once, for the turn that is current after advancing, and only when the game is not finished.
 */
export function advanceByTimeouts<Deal>(
  state: TurnState<Deal>, now: number, deal: (next: TurnState<Deal>) => Deal | null,
  onPhaseEnd?: PhaseEnd<Deal>,
  onExpire?: (turn: { playerId: string; endedAt: number; state: TurnState<Deal> }) => void
): { state: TurnState<Deal>; advanced: number } {
  const expired = expiredTurns(state, now);
  let current = state;
  let advanced = 0;
  while (advanced < expired && !current.finished) {
    const playerId = currentPlayerId(current);
    const endedAt = current.startedAt + current.turnMs;
    if (playerId !== null) onExpire?.({ playerId, endedAt, state: current });
    current = nextTurn(current, endedAt, null, false, onPhaseEnd);
    advanced++;
  }
  if (advanced === 0) return { state, advanced: 0 };
  if (!current.finished) current = { ...current, deal: deal(current) };
  return { state: current, advanced };
}
