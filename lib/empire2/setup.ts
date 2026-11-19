import { withTitles } from "./titles";
import { setupOrder } from "./order";
import { startRound } from "./turns";
import { engineError, appendLog, freeCountries, isKnownCode, normCode, ownerOf, patchState, updatePlayer } from "./state";
import { resolveRules } from "./rules";
import type { Action, ActionResult, Ctx, EmpireState, GameConfig, Ok, Fail, CountryCode, PlayerId, SetupState } from "./types";
import type { Empire2Geo } from "./geo-adapter";

/**
 * Three capital offers on different continents, each with >= capitalMinNeighbours neighbours,
 * none owned (section 13.1). Draw order: continent shuffle (len-1 draws), then one draw per offer.
 */
export function drawCapitalOffers(state: EmpireState, ctx: Ctx): CountryCode[] {
  const geo = ctx.geo;
  const rules = state.rules;
  const byContinent = new Map<string, CountryCode[]>();
  for (const code of geo.codes()) {
    if (ownerOf(state, code) !== undefined) continue;
    if (geo.neighbours(code).length < rules.capitalMinNeighbours) continue;
    const continent = geo.continentOf(code);
    if (continent === "") continue;
    byContinent.set(continent, [...(byContinent.get(continent) ?? []), code]);
  }
  const continents = [...byContinent.keys()].sort();
  for (let i = continents.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.rng() * (i + 1));
    [continents[i], continents[j]] = [continents[j], continents[i]];
  }
  const offers: CountryCode[] = [];
  for (const continent of continents.slice(0, rules.capitalOffers)) {
    const options = byContinent.get(continent) ?? [];
    const idx = Math.min(options.length - 1, Math.floor(ctx.rng() * options.length));
    offers.push(options[idx]);
  }
  return offers;
}

/** Free countries that border no country owned by a different player (decision D16). */
export function legalFootholds(state: EmpireState, playerId: PlayerId, geo: Empire2Geo): CountryCode[] {
  return geo.codes().filter((code) => {
    if (ownerOf(state, code) !== undefined) return false;
    return !geo.neighbours(code).some((n) => {
      const o = ownerOf(state, n);
      return o !== undefined && o !== playerId;
    });
  });
}

export function createGame(config: GameConfig, ctx: Ctx): Ok<{ state: EmpireState }> | Fail {
  if (typeof config !== "object" || config === null) return engineError("badPlayerCount");
  const rules = resolveRules(config.rules);
  const ids: PlayerId[] = Array.isArray(config.playerIds) ? config.playerIds : [];
  if (ids.length < rules.minPlayers || ids.length > rules.maxPlayers) return engineError("badPlayerCount");
  if (new Set(ids).size !== ids.length) return engineError("duplicatePlayer");
  const turnMs = config.turnMs ?? rules.defaultTurnMs;
  if (!rules.allowedTurnMs.includes(turnMs)) return engineError("badTurnMs");

  const players = ids.map((id, seat) => ({
    id,
    seat,
    influence: rules.startInfluence,
    capital: null,
    foothold: null,
  }));
  const setup: SetupState = { step: "capital", order: setupOrder(ids.length).capital, cursor: 0, offers: [] };
  const base: EmpireState = {
    version: 1,
    phase: "setup",
    rules,
    turnMs,
    players,
    owners: {},
    cities: [],
    setup,
    round: 0,
    turn: null,
    roundStartVp: {},
    booms: [],
    bounties: [],
    event: null,
    titles: { largestEmpire: null, explorer: null },
    waitingWin: [],
    lastIncome: null,
    log: [],
    result: null,
  };
  const offers = drawCapitalOffers(base, ctx);
  return { ok: true, state: patchState(base, { setup: { ...setup, offers } }) };
}

function readType(action: unknown): string | null {
  if (typeof action !== "object" || action === null) return null;
  const t = (action as { type?: unknown }).type;
  return typeof t === "string" ? t : null;
}

/**
 * Deadlock fallback (owner decision, option A). While the picker due next in the foothold step has no legal
 * foothold, they are granted one random free country: one rng draw over ALL free countries (ascending).
 * This knowingly drops the "does not border another player" constraint for this one fallback pick.
 * If no country is free at all, the foothold is skipped and the player keeps only their capital.
 * If the last picker is settled this way, setup completes into round 1 here.
 */
function settleFootholds(state: EmpireState, ctx: Ctx): EmpireState {
  let s = state;
  while (s.phase === "setup" && s.setup !== null && s.setup.step === "foothold") {
    const setup = s.setup;
    const seat = setup.order[setup.cursor];
    const picker = s.players.find((p) => p.seat === seat);
    if (!picker) break;
    if (legalFootholds(s, picker.id, ctx.geo).length > 0) break;
    const free = freeCountries(s, ctx.geo);
    if (free.length > 0) {
      const code = free[Math.min(free.length - 1, Math.floor(ctx.rng() * free.length))];
      s = patchState(s, { owners: { ...s.owners, [code]: picker.id } });
      s = updatePlayer(s, picker.id, (p) => ({ ...p, foothold: code }));
      s = appendLog(s, { type: "foothold", round: 0, playerId: picker.id, code });
    }
    const cursor = setup.cursor + 1;
    if (cursor < setup.order.length) {
      s = patchState(s, { setup: { ...setup, cursor } });
      continue;
    }
    s = patchState(s, { setup: null, phase: "play" });
    s = withTitles(s, ctx.geo);
    return startRound(s, 1, ctx);
  }
  return s;
}

export function applySetupAction(
  state: EmpireState,
  playerId: PlayerId,
  action: Action,
  ctx: Ctx,
): ActionResult {
  if (state.phase === "finished") return engineError("gameOver");
  if (state.phase === "play") return engineError("wrongPhase");
  const setup = state.setup;
  if (setup === null) return engineError("wrongPhase");
  const seat = setup.order[setup.cursor];
  const picker = state.players.find((p) => p.seat === seat);
  if (!picker || picker.id !== playerId) return engineError("notYourTurn");

  const type = readType(action);
  const geo = ctx.geo;
  const raw = action as unknown as { code?: unknown };
  const n = state.players.length;

  if (setup.step === "capital") {
    if (type !== "pickCapital") return engineError("unknownAction");
    const code = normCode(raw.code);
    if (code === null || !isKnownCode(geo, code)) return engineError("unknownCountry");
    if (!setup.offers.includes(code)) return engineError("notOffered");

    let s = patchState(state, { owners: { ...state.owners, [code]: playerId } });
    s = updatePlayer(s, playerId, (p) => ({ ...p, capital: code }));
    s = appendLog(s, { type: "capital", round: 0, playerId, code });
    if (setup.cursor + 1 < setup.order.length) {
      const offers = drawCapitalOffers(s, ctx);
      s = patchState(s, { setup: { ...setup, cursor: setup.cursor + 1, offers } });
    } else {
      s = patchState(s, {
        setup: { step: "foothold", order: setupOrder(n).foothold, cursor: 0, offers: [] },
      });
      s = settleFootholds(s, ctx);
    }
    return { ok: true, state: s };
  }

  // foothold step
  if (type !== "pickFoothold") return engineError("unknownAction");
  const code = normCode(raw.code);
  if (code === null || !isKnownCode(geo, code)) return engineError("unknownCountry");
  if (ownerOf(state, code) !== undefined) return engineError("countryTaken");
  const bordersRival = geo.neighbours(code).some((x) => {
    const o = ownerOf(state, x);
    return o !== undefined && o !== playerId;
  });
  if (bordersRival) return engineError("bordersRival");

  let s = patchState(state, { owners: { ...state.owners, [code]: playerId } });
  s = updatePlayer(s, playerId, (p) => ({ ...p, foothold: code }));
  s = appendLog(s, { type: "foothold", round: 0, playerId, code });
  const cursor = setup.cursor + 1;
  if (cursor < setup.order.length) {
    return { ok: true, state: settleFootholds(patchState(s, { setup: { ...setup, cursor } }), ctx) };
  }
  s = patchState(s, { setup: null, phase: "play" });
  s = withTitles(s, geo);
  return { ok: true, state: startRound(s, 1, ctx) };
}

/** Deterministic default setup pick for the server's setup timeout. Uses no rng. */
export function autoSetupPick(state: EmpireState, ctx: Ctx): Action | null {
  if (state.phase !== "setup" || state.setup === null) return null;
  const setup = state.setup;
  const seat = setup.order[setup.cursor];
  const picker = state.players.find((p) => p.seat === seat);
  if (!picker) return null;
  if (setup.step === "capital") {
    const first = setup.offers[0];
    return first === undefined ? null : { type: "pickCapital", code: first };
  }
  const first = legalFootholds(state, picker.id, ctx.geo)[0];
  return first === undefined ? null : { type: "pickFoothold", code: first };
}
