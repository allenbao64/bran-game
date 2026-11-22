/** Clock length in ms; null when the game has no time limit. */
export type TurnMs = number | null;

/** Deadline of a clock started at startedAt, or null when untimed. */
export function clockDeadline(startedAt: number, turnMs: TurnMs): number | null {
  return turnMs === null ? null : startedAt + turnMs;
}

/** True when the clock has run out at `now`. Never true when untimed. */
export function clockExpired(now: number, startedAt: number, turnMs: TurnMs): boolean {
  const deadline = clockDeadline(startedAt, turnMs);
  return deadline !== null && now >= deadline;
}
