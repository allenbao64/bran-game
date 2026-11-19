/** Seat indices in pick order for setup (section 7.1). */
export function setupOrder(playerCount: number): { capital: number[]; foothold: number[] } {
  const capital: number[] = [];
  for (let i = 0; i < playerCount; i++) capital.push(i);
  return { capital, foothold: [...capital].reverse() };
}

/** Seat indices for a round: odd rounds ascending, even rounds descending (section 7.2). */
export function roundOrder(round: number, playerCount: number): number[] {
  const seats: number[] = [];
  for (let i = 0; i < playerCount; i++) seats.push(i);
  return round % 2 === 1 ? seats : seats.reverse();
}

/** The first turn of a round from round 2 on is the second of two in a row (section 7.2). */
export function isSecondOfTwo(round: number, indexInRound: number): boolean {
  return round >= 2 && indexInRound === 0;
}
