export type * from "./types";
export type { CountryTraits, Empire2Geo } from "./geo-adapter";
export type { LegalMoves } from "./actions";
export type { ProtectionReason } from "./protection";

export { EMPIRE2_RULES, resolveRules, regionSetPoints } from "./rules";
export { empire2Geo } from "./geo-adapter";
export { createGame, legalFootholds, autoSetupPick } from "./setup";
export { applyAction } from "./engine";
export { advanceTimeouts } from "./turns";
export { legalMoves } from "./actions";
export { frontier, freeCountries, ownedBy, currentPlayerId, completedRegions, largestGroupSize, continentsOwned } from "./state";
export { actionCosts, computeIncome } from "./economy";
export { scorePlayer, scoreAll } from "./victory";
export { computeTitles } from "./titles";
export { annexProtection, isAnnexable } from "./protection";
export { bountyFits, bountyLabel } from "./bounties";
export { eventLabel, EVENT_KINDS } from "./events";
export { setupOrder, roundOrder, isSecondOfTwo } from "./order";
