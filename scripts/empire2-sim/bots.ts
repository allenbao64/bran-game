// Bots: pure functions of (state, map, player, known capitals, rng). No module state, no Math.random, no Date.
import {
  actionCosts, annexProtection, bountyFits, computeIncome, continentsOwned, freeCountries, frontier,
  legalFootholds, legalMoves, ownedBy, scorePlayer,
} from "@/lib/empire2";
import type { Empire2Geo } from "@/lib/empire2";
import { ownerOf } from "@/lib/empire2/state";
import type { Action, CountryCode, EmpireState, PlayerId, PlayerState, Rng } from "@/lib/empire2/types";
import { mulberry32, streamSeed } from "./rng";

export type Strategy = "expander" | "cityBuilder" | "colonizer" | "annexer" | "mixed";
export const PURE_STRATEGIES: Strategy[] = ["expander", "cityBuilder", "colonizer", "annexer"]; // this order is used for every tie-break

type Weights = { region: number; bounty: number; contest: number; contact: number; newContinent: number; fan: number; noise: number };

const STANDARD: Weights = { region: 3, bounty: 1.5, contest: 0.5, contact: 0, newContinent: 0.5, fan: 0.2, noise: 0.4 };
/** Frozen expand weights (section 2.2). `mixed` uses the weights of the strategy it is playing. */
export const BOT_WEIGHTS: Readonly<Record<"standard" | "colonizer" | "annexer", Readonly<Weights>>> = Object.freeze({
  standard: Object.freeze({ ...STANDARD }),
  colonizer: Object.freeze({ ...STANDARD, newContinent: 2.0 }),
  annexer: Object.freeze({ ...STANDARD, contact: 0.75 }),
});

/** The set of capitals this seat knows (section 2.1). One draw per code, always, in ascending code order. */
export function makeKnownCapitals(seed: number, seat: number, geo: Empire2Geo, p: number): Set<string> {
  const r = mulberry32(streamSeed(seed, 100 + seat));
  const known = new Set<string>();
  for (const code of [...geo.codes()].sort()) {
    const draw = r();
    if (draw < p) known.add(code);
  }
  return known;
}

/** The strategy that plays a turn. `mixed` changes plan by round: 1-4 expander, 5-9 cityBuilder, 10+ annexer. */
export function effectiveStrategy(strategy: Strategy, round: number): Strategy {
  if (strategy !== "mixed") return strategy;
  if (round <= 4) return "expander";
  if (round <= 9) return "cityBuilder";
  return "annexer";
}

function compareCodes(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function playerOf(state: EmpireState, id: PlayerId): PlayerState {
  const p = state.players.find((x) => x.id === id);
  if (!p) throw new Error(`unknown player ${id}`);
  return p;
}

/** Setup picks (section 2.4). No rng. */
export function decideSetup(strategy: Strategy, state: EmpireState, geo: Empire2Geo, playerId: PlayerId, rng: Rng): Action {
  void rng;
  const setup = state.setup;
  if (setup === null) throw new Error("decideSetup: the game is not in setup");
  if (setup.step === "capital") {
    const ranked = [...setup.offers].sort((a, b) => {
      const byNeighbours = geo.neighbours(b).length - geo.neighbours(a).length;
      if (byNeighbours !== 0) return byNeighbours;
      const byRegion = geo.regionMembers(geo.regionOf(b)).length - geo.regionMembers(geo.regionOf(a)).length;
      if (byRegion !== 0) return byRegion;
      return compareCodes(a, b);
    });
    const best = ranked[0];
    if (best === undefined) throw new Error("decideSetup: no capital offers");
    return { type: "pickCapital", code: best };
  }
  const me = playerOf(state, playerId);
  const cands = legalFootholds(state, playerId, geo);
  if (cands.length === 0) throw new Error(`decideSetup: ${playerId} has no legal foothold`);
  const cap = me.capital;
  const capRegion = cap === null ? "" : geo.regionOf(cap);
  const capContinent = cap === null ? "" : geo.continentOf(cap);
  let group: CountryCode[];
  if (strategy === "colonizer") {
    group = cands.filter((c) => geo.continentOf(c) !== capContinent);
    if (group.length === 0) group = cands;
  } else {
    group = cands.filter((c) => geo.regionOf(c) === capRegion);
    if (group.length === 0) group = cands.filter((c) => geo.continentOf(c) === capContinent);
    if (group.length === 0) group = cands;
  }
  const freeNb = (c: CountryCode) => geo.neighbours(c).filter((n) => ownerOf(state, n) === undefined).length;
  let best: CountryCode | null = null;
  let bestScore = -1;
  for (const c of [...group].sort(compareCodes)) {
    const score = freeNb(c);
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  if (best === null) throw new Error("decideSetup: empty foothold group");
  return { type: "pickFoothold", code: best };
}

type Shared = {
  me: PlayerState;
  inf: number;
  costs: ReturnType<typeof actionCosts>;
  moves: ReturnType<typeof legalMoves>;
  turnExpands: number;
  front: CountryCode[];
  frontSet: Set<string>;
  mine: Set<string>;
  myContinents: Set<string>;
  cityPlaces: CountryCode[];
  cityBlocked: boolean;
  annexNow: CountryCode[];
  annexAllCount: number;
  nextIncome: number;
  continentsMine: number;
};

function shared(state: EmpireState, geo: Empire2Geo, playerId: PlayerId, known: ReadonlySet<string>): Shared {
  const me = playerOf(state, playerId);
  const turn = state.turn;
  if (turn === null) throw new Error("decideTurn: no turn");
  const costs = actionCosts(state);
  const moves = legalMoves(state, geo);
  const front = frontier(state, playerId, geo);
  const owned = ownedBy(state, playerId);
  const mine = new Set(owned);
  const myContinents = new Set(owned.map((c) => geo.continentOf(c)));
  const cityCount = state.cities.filter((c) => state.owners[c] === playerId).length;
  const cityPlaces = moves.city.filter((c) => known.has(c));
  const cityBlocked =
    cityCount >= state.rules.maxCities || owned.filter((c) => !state.cities.includes(c) && known.has(c)).length === 0;
  const annexNow = moves.annex.filter((c) => known.has(c));

  // annexAll: every rival country I could annex if I had the influence (section 2.2), from rival-owned neighbours of mine.
  const annexAll = new Set<string>();
  for (const m of owned) {
    for (const c of geo.neighbours(m)) {
      const o = ownerOf(state, c);
      if (o === undefined || o === playerId) continue;
      if (!known.has(c) || annexAll.has(c)) continue;
      if (annexProtection(state, c, geo) !== null) continue;
      if ((state.roundStartVp[o] ?? 0) < (state.roundStartVp[playerId] ?? 0)) continue;
      annexAll.add(c);
    }
  }
  return {
    me,
    inf: me.influence,
    costs,
    moves,
    turnExpands: turn.expands,
    front,
    frontSet: new Set(front),
    mine,
    myContinents,
    cityPlaces,
    cityBlocked,
    annexNow,
    annexAllCount: annexAll.size,
    nextIncome: computeIncome(state, playerId, geo).total,
    continentsMine: continentsOwned(new Set(owned), geo),
  };
}

function canExpand(d: Shared, reserve: number): boolean {
  if (d.front.length === 0 || d.costs.expand === null) return false;
  if (d.turnExpands === 0) return d.inf >= d.costs.expand;
  return d.inf - d.costs.expand >= reserve;
}

function freeNeighbours(state: EmpireState, geo: Empire2Geo, c: CountryCode): number {
  return geo.neighbours(c).filter((n) => ownerOf(state, n) === undefined).length;
}

function freeInRegion(state: EmpireState, geo: Empire2Geo, c: CountryCode): number {
  return geo.regionMembers(geo.regionOf(c)).filter((m) => ownerOf(state, m) === undefined).length;
}

function bestExpand(state: EmpireState, geo: Empire2Geo, playerId: PlayerId, d: Shared, weights: Weights, rng: Rng): CountryCode {
  let best: CountryCode | null = null;
  let bestScore = -Infinity;
  for (const c of d.front) {
    const members = geo.regionMembers(geo.regionOf(c));
    const rivalInRegion = members.some((m) => {
      const o = ownerOf(state, m);
      return o !== undefined && o !== playerId;
    });
    let regionScore = 0;
    if (!rivalInRegion) {
      const mineInRegion = members.filter((m) => d.mine.has(m)).length;
      regionScore = (mineInRegion + 1) / members.length;
      if (mineInRegion === members.length - 1) regionScore += 1;
    }
    const fits = state.bounties.some((card) => bountyFits(card, c, geo)) ? 1 : 0;
    const rivalOwners = new Set<string>();
    let rivalAdjacent = 0;
    for (const n of geo.neighbours(c)) {
      const o = ownerOf(state, n);
      if (o !== undefined && o !== playerId) {
        rivalOwners.add(o);
        rivalAdjacent += 1;
      }
    }
    const newContinent = d.myContinents.has(geo.continentOf(c)) ? 0 : 1;
    const score =
      weights.region * regionScore +
      weights.bounty * fits +
      weights.contest * rivalOwners.size +
      weights.contact * rivalAdjacent +
      weights.newContinent * newContinent +
      weights.fan * freeNeighbours(state, geo, c) +
      weights.noise * rng();
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  if (best === null) throw new Error("bestExpand: no candidate");
  return best;
}

type ColonizeMode = "stuck" | "explore" | "complete";

/** Colonize target in one mode (section 2.2). Candidates are moves.colonize minus the frontier. */
function colonizeTarget(state: EmpireState, geo: Empire2Geo, d: Shared, mode: ColonizeMode, rng: Rng): CountryCode | null {
  let cands = d.moves.colonize.filter((c) => !d.frontSet.has(c));
  if (mode === "explore") cands = cands.filter((c) => !d.myContinents.has(geo.continentOf(c)));
  if (mode === "complete") {
    cands = cands.filter((c) => geo.regionMembers(geo.regionOf(c)).every((m) => m === c || d.mine.has(m)));
  }
  let best: CountryCode | null = null;
  let bestScore = -Infinity;
  for (const c of cands) {
    let score: number;
    if (mode === "stuck") score = freeNeighbours(state, geo, c) + 0.5 * freeInRegion(state, geo, c) + 0.4 * rng();
    else if (mode === "explore") score = freeNeighbours(state, geo, c) * 0.5 + 0.25 * freeInRegion(state, geo, c) + 0.4 * rng();
    else score = geo.regionMembers(geo.regionOf(c)).length + 0.4 * rng();
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

function bestCity(state: EmpireState, geo: Empire2Geo, playerId: PlayerId, d: Shared, rng: Rng): CountryCode {
  let best: CountryCode | null = null;
  let bestScore = -Infinity;
  for (const c of d.cityPlaces) {
    const region = geo.regionOf(c);
    const myInRegion = ownedBy(state, playerId).filter((m) => geo.regionOf(m) === region).length;
    const rivalNeighbour = geo.neighbours(c).some((n) => {
      const o = ownerOf(state, n);
      return o !== undefined && o !== playerId;
    });
    const score =
      2 * (state.booms.includes(region) ? 1 : 0) +
      myInRegion +
      1.5 * (rivalNeighbour && annexProtection(state, c, geo) === null ? 1 : 0) +
      0.3 * rng();
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  if (best === null) throw new Error("bestCity: no candidate");
  return best;
}

function bestAnnex(state: EmpireState, geo: Empire2Geo, playerId: PlayerId, d: Shared, rng: Rng): CountryCode {
  let best: CountryCode | null = null;
  let bestScore = -Infinity;
  const totals = new Map<string, number>();
  for (const c of d.annexNow) {
    const owner = ownerOf(state, c);
    if (owner === undefined) continue;
    let total = totals.get(owner);
    if (total === undefined) {
      total = scorePlayer(state, owner, geo).total;
      totals.set(owner, total);
    }
    const region = geo.regionOf(c);
    const completes = geo.regionMembers(region).every((m) => m === c || d.mine.has(m));
    const score =
      10 * total +
      5 * (completes ? 1 : 0) +
      2 * (state.titles.largestEmpire === owner ? 1 : 0) +
      0.3 * rng();
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  if (best === null) throw new Error(`bestAnnex: no candidate for ${playerId}`);
  return best;
}

function capitalAnswer(geo: Empire2Geo, code: CountryCode): string {
  return geo.capitalsOf(code)[0] ?? "";
}

/** One turn action, or endTurn (section 2.3). Only returns actions the engine accepts. */
export function decideTurn(
  strategy: Strategy,
  state: EmpireState,
  geo: Empire2Geo,
  playerId: PlayerId,
  known: ReadonlySet<string>,
  rng: Rng,
): Action {
  const turn = state.turn;
  if (turn === null || turn.playerId !== playerId) throw new Error(`decideTurn: not ${playerId}'s turn`);
  const eff = effectiveStrategy(strategy, state.round);
  const d = shared(state, geo, playerId, known);
  const rules = state.rules;
  const expandAction = (c: CountryCode): Action => ({ type: "expand", code: c });
  const colonizeAction = (c: CountryCode): Action => ({ type: "colonize", code: c });
  const cityAction = (c: CountryCode): Action => ({ type: "city", code: c, capital: capitalAnswer(geo, c) });
  const annexAction = (c: CountryCode): Action => ({ type: "annex", code: c, capital: capitalAnswer(geo, c) });
  const endTurn: Action = { type: "endTurn" };
  const canColonize = d.moves.colonize.length > 0;

  if (eff === "expander") {
    if (canExpand(d, 0)) return expandAction(bestExpand(state, geo, playerId, d, weightsFor(eff), rng));
    if (d.front.length === 0 && canColonize) {
      const t = colonizeTarget(state, geo, d, "stuck", rng);
      if (t !== null) return colonizeAction(t);
    }
    return endTurn;
  }

  if (eff === "cityBuilder") {
    if (d.turnExpands === 0 && canExpand(d, 0)) return expandAction(bestExpand(state, geo, playerId, d, weightsFor(eff), rng));
    if (d.cityPlaces.length > 0) return cityAction(bestCity(state, geo, playerId, d, rng));
    if (d.cityBlocked && d.annexNow.length > 0) return annexAction(bestAnnex(state, geo, playerId, d, rng));
    const reserve = d.cityBlocked ? 0 : Math.max(0, rules.cityCost - d.nextIncome);
    if (canExpand(d, reserve)) return expandAction(bestExpand(state, geo, playerId, d, weightsFor(eff), rng));
    if (d.front.length === 0 && canColonize) {
      const t = colonizeTarget(state, geo, d, "stuck", rng);
      if (t !== null) return colonizeAction(t);
    }
    return endTurn;
  }

  if (eff === "colonizer") {
    // Continents are chased for the explorer title only. With the title off, no explore colonize and no explore reserve.
    const explorerNeed =
      rules.explorerTitle !== false &&
      d.continentsMine < rules.explorerMinContinents &&
      freeCountries(state, geo).some((c) => !d.myContinents.has(geo.continentOf(c)));
    if (d.turnExpands === 0 && canExpand(d, 0)) return expandAction(bestExpand(state, geo, playerId, d, weightsFor(eff), rng));
    if (canColonize) {
      const t = colonizeTarget(state, geo, d, "complete", rng);
      if (t !== null) return colonizeAction(t);
    }
    if (explorerNeed && canColonize) {
      const t = colonizeTarget(state, geo, d, "explore", rng);
      if (t !== null) return colonizeAction(t);
    }
    const reserve = explorerNeed ? d.costs.colonize : 0;
    if (canExpand(d, reserve)) return expandAction(bestExpand(state, geo, playerId, d, weightsFor(eff), rng));
    if (d.front.length === 0 && canColonize) {
      const t = colonizeTarget(state, geo, d, "stuck", rng);
      if (t !== null) return colonizeAction(t);
    }
    if (d.cityPlaces.length > 0 && d.inf >= rules.cityCost + d.costs.colonize) return cityAction(bestCity(state, geo, playerId, d, rng));
    return endTurn;
  }

  // annexer
  if (d.turnExpands === 0 && canExpand(d, 0)) return expandAction(bestExpand(state, geo, playerId, d, weightsFor(eff), rng));
  if (d.annexNow.length > 0) return annexAction(bestAnnex(state, geo, playerId, d, rng));
  const reserve = d.annexAllCount > 0 ? rules.annexCost : 0;
  if (canExpand(d, reserve)) return expandAction(bestExpand(state, geo, playerId, d, weightsFor(eff), rng));
  if (d.front.length === 0 && canColonize && d.inf - d.costs.colonize >= reserve) {
    const t = colonizeTarget(state, geo, d, "stuck", rng);
    if (t !== null) return colonizeAction(t);
  }
  if (d.cityPlaces.length > 0 && d.inf >= rules.cityCost + rules.annexCost) return cityAction(bestCity(state, geo, playerId, d, rng));
  return endTurn;
}

function weightsFor(eff: Strategy): Weights {
  if (eff === "colonizer") return BOT_WEIGHTS.colonizer;
  if (eff === "annexer") return BOT_WEIGHTS.annexer;
  return BOT_WEIGHTS.standard;
}
