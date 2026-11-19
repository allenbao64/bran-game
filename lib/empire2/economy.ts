import type { Empire2Geo } from "./geo-adapter";
import { hasCityInRegion, ownedBy } from "./state";
import type { EmpireState, IncomeBreakdown, PlayerId, Rng, TurnState } from "./types";

/** Income for one player at the start of a round (section 8.1). Reads the snapshot, never current totals. */
export function computeIncome(state: EmpireState, playerId: PlayerId, geo: Empire2Geo): IncomeBreakdown {
  const r = state.rules;
  const mine = ownedBy(state, playerId);
  const cityCount = state.cities.filter((c) => state.owners[c] === playerId).length;

  const base = r.baseIncome;
  const territory = Math.floor(mine.length / r.countriesPerTerritory);
  const cities = cityCount * (state.event === "goldenAge" ? r.goldenAgeCityIncome : r.cityIncome);

  const ownedRegions = new Set(mine.map((code) => geo.regionOf(code)));
  let boom = 0;
  for (const region of state.booms) {
    if (!ownedRegions.has(region)) continue;
    boom += hasCityInRegion(state, playerId, region, geo) ? r.boomCityIncome : r.boomIncome;
  }

  const snapshot = state.roundStartVp;
  const own = snapshot[playerId] ?? 0;
  const values = Object.values(snapshot);
  const leader = values.length > 0 ? Math.max(...values) : own;
  const underdog = leader - own >= r.underdogGap ? r.underdogIncome : 0;

  const total = base + territory + cities + boom + underdog;
  return { base, territory, cities, boom, underdog, total };
}

/** Three (boomRegionCount) regions drawn by a Fisher-Yates over sorted names; returned sorted (section 8.3). */
export function drawBooms(rng: Rng, geo: Empire2Geo, count: number): string[] {
  const names = [...geo.regionNames()];
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  return names.slice(0, count).sort();
}

export type ActionCosts = {
  expand: number | null;
  colonize: number;
  city: number;
  annex: number | null;
};

/** Costs for the current turn (section 8.2). */
export function actionCosts(state: EmpireState): ActionCosts {
  const r = state.rules;
  const t: TurnState | null = state.turn;
  if (t === null) {
    return { expand: null, colonize: r.colonizeCost, city: r.cityCost, annex: null };
  }

  let expand: number | null = null;
  if (t.expands < r.maxExpandsPerTurn) {
    const base = t.expands < r.freeExpandsPerTurn ? 0 : r.expandCost;
    expand = base + (state.event === "closedBorders" ? r.closedBordersExtra : 0);
  }

  const annexBlocked = state.event === "ceasefire" || t.isSecondOfTwo || t.annexed;
  return {
    expand,
    colonize: colonizePrice(state, reliefAvailable(state, t)),
    city: r.cityCost,
    annex: annexBlocked ? null : r.annexCost,
  };
}

/** Colonize price with or without the stuck relief, after the trade winds event and the floor (section 8.2). */
export function colonizePrice(state: EmpireState, relief: boolean): number {
  const r = state.rules;
  let colonize = relief ? r.colonizeReliefCost : r.colonizeCost;
  if (state.event === "tradeWinds") colonize = Math.min(colonize, r.tradeWindsColonizeCost);
  return Math.max(colonize, r.minColonizeCost);
}

/**
 * Whether this turn may use the stuck relief: it is the turn's first colonize, no free country bordered the
 * empire when the turn began, and (cheapColonize "oncePerGame") the player has not used the relief yet.
 */
export function reliefAvailable(state: EmpireState, t: TurnState): boolean {
  if (!t.noFrontierAtStart || t.colonizes !== 0) return false;
  if (state.rules.cheapColonize === "everyStuckTurn") return true;
  return !(state.reliefUsed ?? []).includes(t.playerId);
}
