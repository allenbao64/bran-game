import type { Empire2Geo } from "./geo-adapter";
import { appendLog, continentsOwned, largestGroupSize, ownerOf, patchState } from "./state";
import type { EmpireState, PlayerId, Titles } from "./types";

/** Owned country sets per player (every player present, possibly empty). */
function ownedSets(s: EmpireState): Map<PlayerId, Set<string>> {
  const sets = new Map<PlayerId, Set<string>>();
  for (const p of s.players) sets.set(p.id, new Set<string>());
  for (const code of Object.keys(s.owners)) {
    const id = ownerOf(s, code);
    if (id === undefined) continue;
    const set = sets.get(id);
    if (set) set.add(code);
  }
  return sets;
}

/** Generic title rule (section 10). Returns the new holder, or null for vacant. */
function holderFor(
  s: EmpireState,
  metric: (set: ReadonlySet<string>) => number,
  min: number,
  previous: PlayerId | null,
  sets: Map<PlayerId, Set<string>>,
): PlayerId | null {
  const qualifiers = s.players
    .map((p) => ({ id: p.id, value: metric(sets.get(p.id) ?? new Set<string>()) }))
    .filter((q) => q.value >= min);
  if (qualifiers.length === 0) return null;
  const best = Math.max(...qualifiers.map((q) => q.value));
  const top = qualifiers.filter((q) => q.value === best).map((q) => q.id);
  if (previous !== null && top.includes(previous)) return previous;
  if (top.length === 1) return top[0];
  return null;
}

export function computeTitles(state: EmpireState, geo: Empire2Geo): Titles {
  const sets = ownedSets(state);
  const largest = holderFor(
    state,
    (set) => largestGroupSize(set, geo),
    state.rules.largestEmpireMin,
    state.titles.largestEmpire,
    sets,
  );
  // explorerTitle false (EMPIRE2_PLAY_RULES): nobody is ever the explorer. Only an explicit false turns it off.
  const explorer =
    state.rules.explorerTitle === false
      ? null
      : holderFor(
          state,
          (set) => continentsOwned(set, geo),
          state.rules.explorerMinContinents,
          state.titles.explorer,
          sets,
        );
  return { largestEmpire: largest, explorer };
}

/** Recomputes titles and logs a `title` entry for each title whose holder changed. */
export function withTitles(state: EmpireState, geo: Empire2Geo): EmpireState {
  const next = computeTitles(state, geo);
  let s = patchState(state, { titles: next });
  if (next.largestEmpire !== state.titles.largestEmpire) {
    s = appendLog(s, { type: "title", round: state.round, playerId: next.largestEmpire, note: "largestEmpire" });
  }
  if (next.explorer !== state.titles.explorer) {
    s = appendLog(s, { type: "title", round: state.round, playerId: next.explorer, note: "explorer" });
  }
  return s;
}
