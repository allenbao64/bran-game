import type { Empire2Geo } from "./geo-adapter";
import { regionSetPoints } from "./rules";
import { completedRegions, ownedBy } from "./state";
import type { EmpireState, GameResult, PlayerId, VpBreakdown } from "./types";

export function scorePlayer(state: EmpireState, id: PlayerId, geo: Empire2Geo): VpBreakdown {
  const r = state.rules;
  const owned = ownedBy(state, id).length;
  const territory = r.territoryPoints ? Math.floor(owned / r.countriesPerTerritory) : 0;
  const cityCount = state.cities.filter((c) => state.owners[c] === id).length;
  const cities = Math.min(cityCount, r.maxCities) * r.cityPoints;
  const regionSets = completedRegions(state, geo)
    .filter((c) => c.owner === id)
    .map((c) => ({ region: c.region, points: regionSetPoints(c.size) }));
  const largestEmpire = state.titles.largestEmpire === id ? r.largestEmpirePoints : 0;
  const explorer = state.titles.explorer === id && r.explorerTitle !== false ? r.explorerPoints : 0;
  const total =
    territory + cities + regionSets.reduce((sum, x) => sum + x.points, 0) + largestEmpire + explorer;
  return { territory, cities, regionSets, largestEmpire, explorer, total };
}

export function scoreAll(state: EmpireState, geo: Empire2Geo): Record<PlayerId, VpBreakdown> {
  const out: Record<PlayerId, VpBreakdown> = {};
  for (const p of state.players) out[p.id] = scorePlayer(state, p.id, geo);
  return out;
}

/** Section 9.3: only a normal (not second-of-two) turn that ends at or above the target wins. */
export function winnerAtTurnEnd(vp: number, second: boolean, winPoints: number): boolean {
  return !second && vp >= winPoints;
}

/**
 * winCheck "endOfRound" (checked after the round's last turn): every player at or above winPoints is a candidate;
 * the most victory points wins, then the most influence; a full tie shares the win. Null when no one qualifies.
 */
export function endOfRoundResult(state: EmpireState, geo: Empire2Geo): GameResult | null {
  const scores = scoreAll(state, geo);
  const vp: Record<PlayerId, number> = {};
  const influence: Record<PlayerId, number> = {};
  for (const p of state.players) {
    vp[p.id] = scores[p.id].total;
    influence[p.id] = p.influence;
  }
  const candidates = state.players.filter((p) => vp[p.id] >= state.rules.winPoints);
  if (candidates.length === 0) return null;
  const bestVp = Math.max(...candidates.map((p) => vp[p.id]));
  const top = candidates.filter((p) => vp[p.id] === bestVp);
  const bestInfluence = Math.max(...top.map((p) => p.influence));
  const winners = top.filter((p) => p.influence === bestInfluence).map((p) => p.id);
  return { winners, reason: "points", round: state.round, vp, influence };
}

/** Round cap result (section 9.5). Ties on points go to influence, then everyone tied shares it. */
export function resolveCap(state: EmpireState, geo: Empire2Geo): GameResult {
  const scores = scoreAll(state, geo);
  const vp: Record<PlayerId, number> = {};
  const influence: Record<PlayerId, number> = {};
  for (const p of state.players) {
    vp[p.id] = scores[p.id].total;
    influence[p.id] = p.influence;
  }
  const bestVp = Math.max(...state.players.map((p) => vp[p.id]));
  const contenders = state.players.filter((p) => vp[p.id] === bestVp);
  const bestInfluence = Math.max(...contenders.map((p) => p.influence));
  const winners = contenders.filter((p) => p.influence === bestInfluence).map((p) => p.id);
  return { winners, reason: "cap", round: state.round, vp, influence };
}
