import { findClaimableBounty } from "./bounties";
import type { Empire2Geo } from "./geo-adapter";
import { actionCosts, colonizePrice, reliefAvailable } from "./economy";
import { annexProtection, type ProtectionReason } from "./protection";
import { engineError, appendLog, freeCountries, frontier, isKnownCode, normCode, ownedBy, ownerOf, patchState, updatePlayer } from "./state";
import { withTitles } from "./titles";
import { endTurn } from "./turns";
import type {
  Action, ActionResult, BountyCard, CountryCode, Ctx, EmpireState, PlayerId, TurnState,
} from "./types";

export type LegalMoves = { expand: CountryCode[]; colonize: CountryCode[]; city: CountryCode[]; annex: CountryCode[] };

function readType(action: unknown): string | null {
  if (typeof action !== "object" || action === null) return null;
  const t = (action as { type?: unknown }).type;
  return typeof t === "string" ? t : null;
}

/** Replaces the current turn's fields. Returns the state unchanged when there is no turn. */
function setTurn(s: EmpireState, patch: Partial<TurnState>): EmpireState {
  return s.turn === null ? s : patchState(s, { turn: { ...s.turn, ...patch } });
}

/**
 * Pays the first fitting bounty card to the player and removes it (section 8.4, D4).
 * Logs a `bounty` entry. Returns the payout (0 when no card fits).
 */
function claimBounty(
  state: EmpireState,
  playerId: PlayerId,
  code: CountryCode,
  geo: Empire2Geo,
  second: boolean,
): { state: EmpireState; pay: number } {
  const card: BountyCard | undefined = findClaimableBounty(state.bounties, code, geo);
  if (card === undefined) return { state, pay: 0 };
  const pay = state.event === "goldRush" ? state.rules.goldRushBountyPay : state.rules.bountyPay;
  let s = updatePlayer(state, playerId, (p) => ({ ...p, influence: p.influence + pay }));
  s = patchState(s, { bounties: s.bounties.filter((c) => c.id !== card.id) });
  s = appendLog(s, { type: "bounty", round: s.round, playerId, code, amount: pay, second });
  return { state: s, pay };
}

/** The expand cap rejection, with the cap in the message (the default cap gives the original text). */
function expandCapError(max: number): ActionResult {
  return { ok: false, error: { code: "expandCap", message: `You can only expand ${max} times a turn.` } };
}

function requireTurn(state: EmpireState): TurnState | null {
  return state.turn;
}

export function applyExpand(state: EmpireState, playerId: PlayerId, action: { code?: unknown }, ctx: Ctx): ActionResult {
  const geo = ctx.geo;
  const turn = requireTurn(state);
  if (turn === null) return engineError("wrongPhase");
  const code = normCode(action.code);
  if (code === null || !isKnownCode(geo, code)) return engineError("unknownCountry");
  if (ownerOf(state, code) !== undefined) return engineError("countryTaken");
  if (turn.expands >= state.rules.maxExpandsPerTurn) return expandCapError(state.rules.maxExpandsPerTurn);
  if (!frontier(state, playerId, geo).includes(code)) return engineError("notOnFrontier");
  const cost = actionCosts(state).expand;
  if (cost === null) return expandCapError(state.rules.maxExpandsPerTurn);
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.influence < cost) return engineError("notEnoughInfluence");

  let s = updatePlayer(state, playerId, (p) => ({ ...p, influence: p.influence - cost }));
  s = patchState(s, { owners: { ...s.owners, [code]: playerId } });
  const claimed = claimBounty(s, playerId, code, geo, turn.isSecondOfTwo);
  s = claimed.state;
  s = setTurn(s, {
    expands: turn.expands + 1,
    actions: [...turn.actions, { type: "expand", code, cost, bounty: claimed.pay }],
  });
  s = appendLog(s, { type: "expand", round: s.round, playerId, code, amount: 0 - cost, second: turn.isSecondOfTwo });
  return { ok: true, state: withTitles(s, geo) };
}

export function applyColonize(state: EmpireState, playerId: PlayerId, action: { code?: unknown }, ctx: Ctx): ActionResult {
  const geo = ctx.geo;
  const turn = requireTurn(state);
  if (turn === null) return engineError("wrongPhase");
  const code = normCode(action.code);
  if (code === null || !isKnownCode(geo, code)) return engineError("unknownCountry");
  if (ownerOf(state, code) !== undefined) return engineError("countryTaken");
  const cost = actionCosts(state).colonize;
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.influence < cost) return engineError("notEnoughInfluence");
  // The stuck relief is spent only when it lowers the price (not, e.g., when trade winds already do).
  const spendsRelief = reliefAvailable(state, turn) && cost < colonizePrice(state, false);

  let s = updatePlayer(state, playerId, (p) => ({ ...p, influence: p.influence - cost }));
  s = patchState(s, { owners: { ...s.owners, [code]: playerId } });
  if (spendsRelief && state.rules.cheapColonize === "oncePerGame" && !(state.reliefUsed ?? []).includes(playerId)) {
    s = patchState(s, { reliefUsed: [...(state.reliefUsed ?? []), playerId] });
  }
  const claimed = claimBounty(s, playerId, code, geo, turn.isSecondOfTwo);
  s = claimed.state;
  s = setTurn(s, {
    colonizes: turn.colonizes + 1,
    actions: [...turn.actions, { type: "colonize", code, cost, bounty: claimed.pay }],
  });
  s = appendLog(s, { type: "colonize", round: s.round, playerId, code, amount: 0 - cost, second: turn.isSecondOfTwo });
  return { ok: true, state: withTitles(s, geo) };
}

export function applyCity(
  state: EmpireState,
  playerId: PlayerId,
  action: { code?: unknown; capital?: unknown },
  ctx: Ctx,
): ActionResult {
  const geo = ctx.geo;
  const turn = requireTurn(state);
  if (turn === null) return engineError("wrongPhase");
  const code = normCode(action.code);
  if (code === null || !isKnownCode(geo, code)) return engineError("unknownCountry");
  if (ownerOf(state, code) !== playerId) return engineError("notOwned");
  if (state.cities.includes(code)) return engineError("alreadyCity");
  const owned = state.cities.filter((c) => state.owners[c] === playerId).length;
  if (owned >= state.rules.maxCities) return engineError("cityLimit");
  const player = state.players.find((p) => p.id === playerId);
  const cost = state.rules.cityCost;
  if (!player || player.influence < cost) return engineError("notEnoughInfluence");
  const capital = typeof action.capital === "string" ? action.capital : "";
  if (!geo.isCapitalOf(code, capital)) return engineError("wrongCapital");

  let s = updatePlayer(state, playerId, (p) => ({ ...p, influence: p.influence - cost }));
  s = patchState(s, { cities: [...s.cities, code].sort() });
  s = setTurn(s, {
    actions: [...turn.actions, { type: "city", code, cost, bounty: 0 }],
  });
  s = appendLog(s, { type: "city", round: s.round, playerId, code, amount: 0 - cost, second: turn.isSecondOfTwo });
  return { ok: true, state: withTitles(s, geo) };
}

function protectionError(reason: ProtectionReason): ActionResult {
  switch (reason) {
    case "city":
      return engineError("protectedCity");
    case "startingCapital":
      return engineError("protectedStartingCapital");
    case "foothold":
      return engineError("protectedFoothold");
    case "regionSet":
      return engineError("protectedRegionSet");
  }
}

export function applyAnnex(
  state: EmpireState,
  playerId: PlayerId,
  action: { code?: unknown; capital?: unknown },
  ctx: Ctx,
): ActionResult {
  const geo = ctx.geo;
  const turn = requireTurn(state);
  if (turn === null) return engineError("wrongPhase");
  const rules = state.rules;

  if (turn.isSecondOfTwo) return engineError("secondTurnNoAnnex");
  if (state.event === "ceasefire") return engineError("ceasefire");
  if (turn.annexed) return engineError("annexUsed");
  const code = normCode(action.code);
  if (code === null || !isKnownCode(geo, code)) return engineError("unknownCountry");
  const targetOwner = ownerOf(state, code);
  if (targetOwner === undefined || targetOwner === playerId) return engineError("notRival");
  const borders = geo.neighbours(code).some((n) => ownerOf(state, n) === playerId);
  if (!borders) return engineError("notBordering");
  const reason = annexProtection(state, code, geo);
  if (reason !== null) return protectionError(reason);
  const targetVp = state.roundStartVp[targetOwner] ?? 0;
  const actorVp = state.roundStartVp[playerId] ?? 0;
  if (targetVp < actorVp) return engineError("targetBelow");
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.influence < rules.annexCost) return engineError("notEnoughInfluence");
  const capital = typeof action.capital === "string" ? action.capital : "";
  if (!geo.isCapitalOf(code, capital)) return engineError("wrongCapital");

  let s = updatePlayer(state, playerId, (p) => ({ ...p, influence: p.influence - rules.annexCost }));
  s = patchState(s, { owners: { ...s.owners, [code]: playerId } });
  s = setTurn(s, {
    annexed: true,
    actions: [...turn.actions, { type: "annex", code, cost: rules.annexCost, bounty: 0 }],
  });
  s = appendLog(s, {
    type: "annex",
    round: s.round,
    playerId,
    code,
    from: targetOwner,
    amount: 0 - rules.annexCost,
    second: false,
  });
  return { ok: true, state: withTitles(s, geo) };
}

/** Play actions after the common checks of section 12.0 (phase, turn owner, clock). */
export function applyPlayAction(state: EmpireState, playerId: PlayerId, action: Action, ctx: Ctx): ActionResult {
  if (state.phase === "finished") return engineError("gameOver");
  if (state.phase === "setup") return engineError("wrongPhase");
  const type = readType(action);
  if (type === null) return engineError("unknownAction");
  if (type === "pickCapital" || type === "pickFoothold") return engineError("wrongPhase");

  const turn = state.turn;
  if (turn === null) return engineError("wrongPhase");
  if (turn.playerId !== playerId) return engineError("notYourTurn");
  if (ctx.now >= turn.startedAt + state.turnMs) return engineError("turnExpired");

  const raw = action as unknown as { code?: unknown; capital?: unknown };
  switch (type) {
    case "expand":
      return applyExpand(state, playerId, raw, ctx);
    case "colonize":
      return applyColonize(state, playerId, raw, ctx);
    case "city":
      return applyCity(state, playerId, raw, ctx);
    case "annex":
      return applyAnnex(state, playerId, raw, ctx);
    case "endTurn":
      return { ok: true, state: endTurn(state, ctx, "endTurn", ctx.now) };
    default:
      return engineError("unknownAction");
  }
}

/** Every action the current player could take now, given a correct capital answer (section 12.7). */
export function legalMoves(state: EmpireState, geo: Empire2Geo): LegalMoves {
  const empty: LegalMoves = { expand: [], colonize: [], city: [], annex: [] };
  const turn = state.turn;
  if (state.phase !== "play" || turn === null) return empty;
  const pid = turn.playerId;
  const player = state.players.find((p) => p.id === pid);
  if (!player) return empty;
  const costs = actionCosts(state);
  const influence = player.influence;

  const expand =
    costs.expand !== null && influence >= costs.expand ? frontier(state, pid, geo) : [];
  const colonize = influence >= costs.colonize ? freeCountries(state, geo) : [];
  const ownedCount = state.cities.filter((c) => state.owners[c] === pid).length;
  const city =
    influence >= state.rules.cityCost && ownedCount < state.rules.maxCities
      ? ownedBy(state, pid).filter((c) => !state.cities.includes(c))
      : [];
  const annex: CountryCode[] = [];
  if (costs.annex !== null && influence >= state.rules.annexCost) {
    for (const code of geo.codes()) {
      const target = ownerOf(state, code);
      if (target === undefined || target === pid) continue;
      if (!geo.neighbours(code).some((n) => ownerOf(state, n) === pid)) continue;
      if (annexProtection(state, code, geo) !== null) continue;
      if ((state.roundStartVp[target] ?? 0) < (state.roundStartVp[pid] ?? 0)) continue;
      annex.push(code);
    }
  }
  return { expand, colonize, city, annex };
}
