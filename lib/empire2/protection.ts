import type { Empire2Geo } from "./geo-adapter";
import { completedRegions, ownerOf } from "./state";
import type { CountryCode, EmpireState } from "./types";

export type ProtectionReason = "city" | "startingCapital" | "foothold" | "regionSet";

/** Why a country cannot be annexed, in precedence order (section 12.5). Null when it can be. */
export function annexProtection(state: EmpireState, code: CountryCode, geo: Empire2Geo): ProtectionReason | null {
  if (state.cities.includes(code)) return "city";
  if (state.players.some((p) => p.capital === code)) return "startingCapital";
  if (state.players.some((p) => p.foothold === code)) return "foothold";
  const inSet = completedRegions(state, geo).some((r) => geo.regionMembers(r.region).includes(code));
  if (inSet) return "regionSet";
  return null;
}

export function isAnnexable(state: EmpireState, code: CountryCode, geo: Empire2Geo): boolean {
  return ownerOf(state, code) !== undefined && annexProtection(state, code, geo) === null;
}
