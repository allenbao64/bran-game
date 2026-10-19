/**
 * Generic turn infrastructure: pure functions over a serialisable turn state.
 * Game-specific rules (cards, scoring) live elsewhere (see turn-rules.ts), so
 * other turn-based modes can reuse this module with their own card payload.
 */
export const DEFAULT_TURN_MS = 15_000;

export type TurnState<Card = unknown> = {
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
  card: Card | null;
  finished: boolean;
};

export function createTurnState<Card>(order: string[], startedAt: number, totalRounds: number, card: Card | null, turnMs = DEFAULT_TURN_MS): TurnState<Card> {
  return { number: 0, order: [...order], startedAt, turnMs, totalRounds, card, finished: order.length === 0 || totalRounds <= 0 };
}

export const totalTurns = (state: TurnState<unknown>) => state.order.length * state.totalRounds;
export const turnsLeft = (state: TurnState<unknown>) => Math.max(0, totalTurns(state) - state.number);

export function currentPlayerId(state: TurnState<unknown>): string | null {
  return state.finished || state.order.length === 0 ? null : state.order[state.number % state.order.length];
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

/** Moves to the next turn (after a claim or pass). Finishes at the last turn or when `exhausted`. */
export function nextTurn<Card>(state: TurnState<Card>, now: number, card: Card | null, exhausted = false): TurnState<Card> {
  const number = state.number + 1;
  const finished = state.finished || exhausted || number >= totalTurns(state);
  return { ...state, number, startedAt: now, card: finished ? null : card, finished };
}

/**
 * Lazily applies timeouts: every fully expired 15-second turn counts as a pass.
 * `deal` is called once, for the turn that is current after advancing.
 */
export function advanceByTimeouts<Card>(
  state: TurnState<Card>, now: number, deal: (next: TurnState<Card>) => Card | null
): { state: TurnState<Card>; advanced: number } {
  const expired = expiredTurns(state, now);
  if (expired === 0) return { state, advanced: 0 };
  const steps = Math.min(expired, turnsLeft(state));
  const number = state.number + steps;
  const finished = number >= totalTurns(state);
  const next: TurnState<Card> = { ...state, number, startedAt: state.startedAt + expired * state.turnMs, finished, card: null };
  if (!finished) next.card = deal(next);
  return { state: next, advanced: steps };
}
