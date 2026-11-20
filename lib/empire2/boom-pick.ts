import type { Empire2Geo } from "./geo-adapter";
import { hasCityInRegion, ownedBy } from "./state";
import { roundSeatOrder } from "./order";
import type { EmpireState, PlayerId } from "./types";

/**
 * underdogBoomPick: the picker of a round is the player with the lowest round-start victory points (the snapshot).
 * A tie for lowest goes to the tied player who comes first in this round's turn order.
 */
export function boomPickerId(state: EmpireState): PlayerId {
  const order = roundSeatOrder(state, state.round);
  let best: PlayerId | null = null;
  let bestVp = Infinity;
  for (const seat of order) {
    const p = state.players.find((x) => x.seat === seat);
    if (!p) throw new Error(`boomPickerId: no player in seat ${seat}`);
    const vp = state.roundStartVp[p.id] ?? 0;
    if (vp < bestVp) {
      best = p.id;
      bestVp = vp;
    }
  }
  if (best === null) throw new Error("boomPickerId: no players");
  return best;
}

/** What the player would collect from one boom region this round (section 8.1 boom term, for one region). */
function boomPayout(state: EmpireState, playerId: PlayerId, region: string, geo: Empire2Geo): number {
  const owns = ownedBy(state, playerId).some((c) => geo.regionOf(c) === region);
  if (hasCityInRegion(state, playerId, region, geo)) return state.rules.boomCityIncome;
  return owns ? state.rules.boomIncome : 0;
}

/**
 * The engine's and the bots' boom pick (deterministic, no rng). Maximises the picker's own boom payout this round;
 * ties go to the region where the picker owns the most countries, then to the alphabetically first region.
 * If every region pays 0, it takes the alphabetically first region with no country of the picker's that borders
 * the picker's empire, else the alphabetically first region.
 */
export function bestBoomPick(state: EmpireState, playerId: PlayerId, geo: Empire2Geo): string {
  const regions = [...geo.regionNames()].sort();
  if (regions.length === 0) throw new Error("bestBoomPick: the map has no regions");
  const owned = ownedBy(state, playerId);
  const ownedCount = (region: string) => owned.filter((c) => geo.regionOf(c) === region).length;

  let best: string | null = null;
  let bestPay = -1;
  let bestCount = -1;
  for (const region of regions) {
    const pay = boomPayout(state, playerId, region, geo);
    const count = ownedCount(region);
    if (pay > bestPay || (pay === bestPay && count > bestCount)) {
      best = region;
      bestPay = pay;
      bestCount = count;
    }
  }
  if (best === null) throw new Error("bestBoomPick: no region");
  if (bestPay > 0) return best;

  const mine = new Set(owned);
  const borders = (region: string) =>
    geo.regionMembers(region).some((m) => geo.neighbours(m).some((n) => mine.has(n)));
  const fallback = regions.find((r) => ownedCount(r) === 0 && borders(r));
  return fallback ?? regions[0];
}
