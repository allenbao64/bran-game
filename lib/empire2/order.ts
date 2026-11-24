import type { EmpireState, TurnOrder } from "./types";

/** Seat indices in pick order for setup (section 7.1). Setup always snakes, whatever the turn order. */
export function setupOrder(playerCount: number): { capital: number[]; foothold: number[] } {
  const capital: number[] = [];
  for (let i = 0; i < playerCount; i++) capital.push(i);
  return { capital, foothold: [...capital].reverse() };
}

/**
 * Seat indices for a round (section 7.2). The default is "snake": odd rounds ascending, even rounds descending.
 * - "clockwise": ascending every round.
 * - "rotate": round r starts at seat (r - 1) mod n and continues ascending, wrapping around.
 * - "leaderLast": by the round-start VP snapshot (`vpBySeat`, indexed by seat), lowest first, highest last;
 *   ties by seat index ascending. Required for this order only.
 */
export function roundOrder(
  round: number,
  playerCount: number,
  turnOrder: TurnOrder = "snake",
  vpBySeat?: readonly number[],
): number[] {
  const n = playerCount;
  const seats: number[] = [];
  for (let i = 0; i < n; i++) seats.push(i);
  switch (turnOrder) {
    case "snake":
      return round % 2 === 1 ? seats : seats.reverse();
    case "clockwise":
      return seats;
    case "rotate": {
      // With 2 players, rotate gives the same seat sequence as snake, so back-to-back turns still occur; it only
      // differs from snake at 3 or more players.
      const start = (((round - 1) % n) + n) % n;
      return seats.map((_, i) => (start + i) % n);
    }
    case "leaderLast": {
      if (vpBySeat === undefined || vpBySeat.length !== n) {
        throw new Error("leaderLast turn order needs the round-start victory points by seat");
      }
      return [...seats].sort((a, b) => vpBySeat[a] - vpBySeat[b] || a - b);
    }
    default:
      throw new Error(`unknown turn order: ${String(turnOrder)}`);
  }
}

/** Seat order of a round of this state, read from its rules and its round-start snapshot (section 7.2). */
export function roundSeatOrder(state: Pick<EmpireState, "players" | "rules" | "roundStartVp">, round: number): number[] {
  const vpBySeat: number[] = [];
  for (const p of state.players) vpBySeat[p.seat] = state.roundStartVp[p.id] ?? 0;
  return roundOrder(round, state.players.length, state.rules.turnOrder, vpBySeat);
}

/**
 * Back-to-back test (section 7.2): the player who takes a round's first turn also took the last turn of the
 * previous round. `previousLastSeat` is null in round 1, where there is no previous turn.
 */
export function isBackToBack(previousLastSeat: number | null, firstSeat: number): boolean {
  return previousLastSeat !== null && previousLastSeat === firstSeat;
}

/**
 * Snake-order shorthand for fixtures: the first turn of a round from round 2 on is the second of two in a row.
 * Equal to isBackToBack under the "snake" order. Other orders must use the state (see roundSeatOrder).
 */
export function isSecondOfTwo(round: number, indexInRound: number): boolean {
  return round >= 2 && indexInRound === 0;
}
