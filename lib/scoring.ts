import { countryPoints } from "@/lib/countries";

export const COOLDOWN_MS = 2500;
export const HINT_COST = 2;
export const EVENT_EVERY_MS = 2 * 60 * 1000;
export const EVENT_LENGTH_MS = 60 * 1000;
export const COMEBACK_MULTIPLIER = 2;
const RANGES: [string, string][] = [["A", "H"], ["I", "P"], ["Q", "Z"]];

export type CountryEvent = { active: boolean; range: string | null; msLeft: number; leaderId: string | null };

/** Every two minutes the leader is restricted to a letter range for a minute. */
export function eventAt(elapsedMs: number) {
  if (elapsedMs < EVENT_EVERY_MS) return { active: false, range: null, msLeft: EVENT_EVERY_MS - elapsedMs };
  const window = Math.floor(elapsedMs / EVENT_EVERY_MS);
  const within = elapsedMs % EVENT_EVERY_MS;
  if (within >= EVENT_LENGTH_MS) return { active: false, range: null, msLeft: EVENT_EVERY_MS - within };
  const [from, to] = RANGES[(window - 1) % RANGES.length];
  return { active: true, range: `${from}–${to}`, msLeft: EVENT_LENGTH_MS - within };
}

export function startsInRange(name: string, range: string) {
  const letter = name.normalize("NFD").replace(/[^A-Za-z]/g, "").charAt(0).toUpperCase();
  const [from, to] = range.split("–");
  return letter >= from && letter <= to;
}

/** Score = points from claims minus points spent on hints. */
export function scoreboard(
  playerIds: string[], claims: Record<string, string>, points: Record<string, string>, spent: Record<string, string>
) {
  const scores: Record<string, number> = Object.fromEntries(playerIds.map((id) => [id, 0]));
  for (const [code, owner] of Object.entries(claims)) {
    if (owner in scores) scores[owner] += Number(points[code] ?? countryPoints(code));
  }
  for (const id of playerIds) scores[id] -= Number(spent[id] ?? 0);
  return scores;
}

export function leaderOf(scores: Record<string, number>) {
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return ranked.length > 1 && ranked[0][1] > 0 && ranked[0][1] > ranked[1][1] ? ranked[0][0] : null;
}

export function countryEvent(elapsedMs: number, scores: Record<string, number>): CountryEvent {
  const event = eventAt(elapsedMs);
  return { ...event, leaderId: event.active ? leaderOf(scores) : null };
}
