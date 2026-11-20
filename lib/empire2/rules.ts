import type { Rules } from "./types";

export const EMPIRE2_RULES: Rules = {
  startInfluence: 3,
  baseIncome: 2,
  countriesPerTerritory: 4,
  cityIncome: 1,
  goldenAgeCityIncome: 2,
  boomRegionCount: 3,
  boomIncome: 1,
  boomCityIncome: 2,
  underdogGap: 2,
  underdogIncome: 2,
  bountyCount: 2,
  bountyPay: 2,
  goldRushBountyPay: 4,
  bountyMinFits: 3,
  eventEvery: 4,
  freeExpandsPerTurn: 1,
  maxExpandsPerTurn: 3,
  expandCost: 1,
  closedBordersExtra: 1,
  colonizeCost: 4,
  colonizeReliefCost: 2,
  tradeWindsColonizeCost: 2,
  minColonizeCost: 2,
  cityCost: 3,
  maxCities: 4,
  annexCost: 5,
  cityPoints: 1,
  largestEmpireMin: 6,
  largestEmpirePoints: 2,
  explorerMinContinents: 4,
  explorerPoints: 2,
  winPoints: 10,
  roundCap: 20,
  capitalOffers: 3,
  capitalMinNeighbours: 3,
  minPlayers: 2,
  maxPlayers: 4,
  defaultTurnMs: 30000,
  allowedTurnMs: [20000, 30000, 45000],
  turnOrder: "snake",
  winCheck: "endOfTurn",
  territoryPoints: true,
  cheapColonize: "everyStuckTurn",
  explorerTitle: true,
  underdogBoomPick: false,
};

// Owner-chosen rules (2026-11-20), from the phase 2 comparison. Numbers are re-tuned in step 4b.
export const EMPIRE2_PLAY_RULES: Rules = {
  ...EMPIRE2_RULES,
  turnOrder: "leaderLast",
  winCheck: "endOfTurn",
  territoryPoints: false,
  maxExpandsPerTurn: 2,
  winPoints: 14,
  explorerTitle: false,
  underdogBoomPick: false,
};

/** A fresh rules object: the defaults with the overrides applied. */
export function resolveRules(overrides?: Partial<Rules>): Rules {
  const base = EMPIRE2_RULES;
  const merged: Rules = { ...base, allowedTurnMs: [...base.allowedTurnMs], ...(overrides ?? {}) };
  merged.allowedTurnMs = [...merged.allowedTurnMs];
  return merged;
}

/** Victory points for completing a region of this size (own every country). */
export function regionSetPoints(regionSize: number): number {
  if (regionSize <= 5) return 2;
  if (regionSize <= 10) return 3;
  return 4;
}
