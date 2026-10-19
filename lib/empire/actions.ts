import {
  EMPIRE_RULES,
  type ActionError,
  type EmpireAction,
  type EmpireActions,
  type EmpireCard,
  type EmpireDeps,
  type EmpireLogEntry,
  type EmpirePlayer,
  type EmpireState,
  type ScoreBreakdown,
  type ScoreResult
} from "@/lib/empire/types";

const CONTINENTS = ["Africa", "Americas", "Asia", "Europe", "Oceania"];

type Scores = Record<string, ScoreBreakdown>;

function fail(status: number, error: string): ActionError {
  return { error, status };
}

function totalOf(scores: Scores, playerId: string): number {
  return scores[playerId]?.total ?? 0;
}

function allCountries(deps: EmpireDeps): Set<string> {
  const all = new Set<string>();
  for (const region of deps.geo.regionNames()) {
    for (const code of deps.geo.regionMembers(region)) all.add(code);
  }
  return all;
}

function ownedBy(owners: Record<string, string>, playerId: string): Set<string> {
  const mine = new Set<string>();
  for (const code of Object.keys(owners)) {
    if (owners[code] === playerId) mine.add(code);
  }
  return mine;
}

function scoreState(state: EmpireState, deps: EmpireDeps): ScoreResult {
  return deps.scoring.scoreEmpire(
    { players: state.players, owners: state.owners, empireHolder: state.empireHolder, log: state.log },
    deps.geo
  );
}

/** The player with the unique lowest total, or null when the lowest total is shared. */
function strictlyLast(players: EmpirePlayer[], scores: Scores): string | null {
  if (players.length < 2) return null;
  let lowest = Infinity;
  let lowestId: string | null = null;
  let ties = 0;
  for (const player of players) {
    const total = totalOf(scores, player.id);
    if (total < lowest) {
      lowest = total;
      lowestId = player.id;
      ties = 1;
    } else if (total === lowest) {
      ties += 1;
    }
  }
  return ties === 1 ? lowestId : null;
}

/** Deals the current player's hand: three cards when strictly last on total, else two. */
function dealTo(state: EmpireState, scores: Scores, deps: EmpireDeps): EmpireCard[] {
  const player = state.players[state.seat];
  const underdog = strictlyLast(state.players, scores) === player.id;
  const unclaimed = Array.from(allCountries(deps)).filter((code) => state.owners[code] === undefined);
  return deps.cards.dealHand(underdog ? EMPIRE_RULES.underdogCards : EMPIRE_RULES.cardsDealt, {
    ownedByMe: ownedBy(state.owners, player.id),
    neighbours: (code: string) => deps.geo.neighbours(code),
    unclaimed,
    event: state.event,
    rng: deps.rng
  });
}

function pickedCard(state: EmpireState): EmpireCard | null {
  return state.chosen === null ? null : state.hand[state.chosen] ?? null;
}

function patchPlayer(players: EmpirePlayer[], playerId: string, patch: Partial<EmpirePlayer>): EmpirePlayer[] {
  return players.map((p) => (p.id === playerId ? { ...p, ...patch } : p));
}

function withLog(state: EmpireState, entry: EmpireLogEntry): EmpireState {
  return { ...state, log: [...state.log, entry] };
}

/**
 * Ends the current turn: rescores, checks for a points win, advances the seat,
 * closes the round when the seat wraps, and deals the next hand.
 */
function endTurn(state: EmpireState, now: number, deps: EmpireDeps): EmpireState {
  const actor = state.players[state.seat];
  const scored = scoreState(state, deps);
  const scores = scored.scores;
  const base: EmpireState = { ...state, empireHolder: scored.empireHolder, hand: [], chosen: null };

  if (totalOf(scores, actor.id) >= EMPIRE_RULES.winPoints) {
    return { ...base, finished: true, winnerIds: deps.scoring.winners(scores, "points") };
  }

  let players = base.players;
  let seat = base.seat + 1;
  let round = base.round;
  let event = base.event;

  if (seat >= players.length) {
    seat = 0;
    const endedRound = round;
    round = endedRound + 1;

    if (endedRound === EMPIRE_RULES.lateTokenRound && !players.some((p) => p.lateTokenGiven)) {
      const last = strictlyLast(players, scores);
      if (last !== null) {
        players = players.map((p) =>
          p.id === last ? { ...p, stealTokens: p.stealTokens + 1, lateTokenGiven: true } : p
        );
      }
    }

    if (round > EMPIRE_RULES.roundCap) {
      return {
        ...base,
        players,
        seat,
        round,
        event: null,
        finished: true,
        winnerIds: deps.scoring.winners(scores, "cap")
      };
    }

    event = endedRound % EMPIRE_RULES.eventEvery === 0 ? deps.cards.drawEvent(deps.rng, CONTINENTS) : null;
  }

  const next: EmpireState = { ...base, players, seat, round, event, turnStartedAt: now };
  return { ...next, hand: dealTo(next, scores, deps) };
}

function initEmpire(playerIds: string[], now: number, deps: EmpireDeps, turnMs?: number): EmpireState {
  // Fisher-Yates shuffle of the seat order using the injected rng.
  const order = [...playerIds];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(deps.rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  const capitals = deps.geo.startingCapitals(order.length, deps.rng);
  const players: EmpirePlayer[] = order.map((id, seat) => ({
    id,
    capital: capitals[seat],
    stealTokens: EMPIRE_RULES.startTokens,
    forts: []
  }));
  const owners: Record<string, string> = {};
  for (const player of players) owners[player.capital] = player.id;

  const base: EmpireState = {
    players,
    owners,
    round: 1,
    seat: 0,
    turnStartedAt: now,
    ...(turnMs ? { turnMs } : {}),
    empireHolder: null,
    event: null,
    hand: [],
    chosen: null,
    log: [],
    finished: false,
    winnerIds: []
  };
  const scores = scoreState(base, deps).scores;
  return { ...base, hand: dealTo(base, scores, deps) };
}

function pick(state: EmpireState, index: number): EmpireState | ActionError {
  if (!Number.isInteger(index) || index < 0 || index >= state.hand.length) {
    return fail(400, "Pick a card from your hand.");
  }
  return { ...state, chosen: index };
}

function claim(state: EmpireState, playerId: string, code: string, now: number, deps: EmpireDeps): EmpireState | ActionError {
  const card = pickedCard(state);
  if (!card) return fail(400, "Pick a card first.");
  if (!allCountries(deps).has(code)) return fail(400, "Unknown country.");

  const owner = state.owners[code];
  if (owner === playerId) return fail(409, "You already own that country.");
  if (owner !== undefined) return fail(409, "That country belongs to another player. Try a steal.");

  const event = state.event;
  if (event?.kind === "closedContinent" && deps.geo.continentOf(code) === event.continent) {
    return fail(409, "That continent is closed this round.");
  }

  const neighbours = (c: string) => deps.geo.neighbours(c);
  if (!deps.cards.cardFits(card, code, { ownedByMe: ownedBy(state.owners, playerId), neighbours })) {
    return fail(400, "That doesn't fit your card.");
  }

  const points = event?.kind === "goldRush" ? 2 : 1;
  const next: EmpireState = {
    ...state,
    owners: { ...state.owners, [code]: playerId },
    log: [...state.log, { kind: "claim", playerId, code, points, round: state.round, at: now }]
  };
  return endTurn(next, now, deps);
}

function steal(
  state: EmpireState,
  playerId: string,
  code: string,
  capital: string,
  now: number,
  deps: EmpireDeps
): EmpireState | ActionError {
  const card = pickedCard(state);
  if (!card) return fail(400, "Pick a card first.");
  if (state.event?.kind === "ceasefire") return fail(409, "A ceasefire is on this round.");
  if (!allCountries(deps).has(code)) return fail(400, "Unknown country.");

  const owner = state.owners[code];
  if (owner === undefined || owner === playerId) {
    return fail(409, "You can only steal a country owned by another player.");
  }

  const neighbours = (c: string) => deps.geo.neighbours(c);
  const mine = ownedBy(state.owners, playerId);
  if (!neighbours(code).some((n) => mine.has(n))) {
    return fail(409, "You can only steal a country that borders one of yours.");
  }

  const scores = scoreState(state, deps).scores;
  if (totalOf(scores, owner) < totalOf(scores, playerId)) {
    return fail(409, "You can only steal from players at or above your score.");
  }

  if (deps.scoring.protectedCodes(state, deps.geo).has(code)) {
    return fail(409, "That country is protected.");
  }

  if (!deps.cards.cardFits(card, code, { ownedByMe: mine, neighbours })) {
    return fail(400, "That doesn't fit your card.");
  }

  // The current player is the actor; applyAction has already checked the turn.
  const actor = state.players[state.seat];
  const free = state.event?.kind === "freeSteals";
  if (!free && actor.stealTokens < 1) return fail(409, "You have no steal tokens left.");

  if (!deps.geo.isCapitalOf(code, capital)) {
    // A wrong capital is not an error: no token is spent and the turn ends.
    return endTurn(withLog(state, { kind: "pass", playerId, code, round: state.round, at: now }), now, deps);
  }

  const next: EmpireState = {
    ...state,
    players: free ? state.players : patchPlayer(state.players, playerId, { stealTokens: actor.stealTokens - 1 }),
    owners: { ...state.owners, [code]: playerId },
    log: [...state.log, { kind: "steal", playerId, code, from: owner, round: state.round, at: now }]
  };
  return endTurn(next, now, deps);
}

function fortify(state: EmpireState, playerId: string, code: string, now: number, deps: EmpireDeps): EmpireState | ActionError {
  if (state.owners[code] !== playerId) return fail(409, "You can only fortify a country you own.");
  if (state.players.some((p) => p.capital === code)) return fail(409, "Capitals can't be fortified.");

  const actor = state.players[state.seat];
  if (actor.forts.includes(code)) return fail(409, "That country is already fortified.");
  if (actor.forts.length >= EMPIRE_RULES.fortLimit) return fail(409, "You have no forts left.");

  const next: EmpireState = {
    ...withLog(state, { kind: "fortify", playerId, code, round: state.round, at: now }),
    players: patchPlayer(state.players, playerId, { forts: [...actor.forts, code] })
  };
  return endTurn(next, now, deps);
}

function applyAction(
  state: EmpireState,
  playerId: string,
  action: EmpireAction,
  now: number,
  deps: EmpireDeps
): EmpireState | ActionError {
  if (state.finished) return fail(409, "The game is over.");
  const current = state.players[state.seat];
  if (!current || current.id !== playerId) return fail(409, "It's not your turn.");

  switch (action.type) {
    case "pick":
      return pick(state, action.index);
    case "claim":
      return claim(state, playerId, action.code, now, deps);
    case "steal":
      return steal(state, playerId, action.code, action.capital, now, deps);
    case "fortify":
      return fortify(state, playerId, action.code, now, deps);
    case "pass":
      return endTurn(withLog(state, { kind: "pass", playerId, round: state.round, at: now }), now, deps);
    default:
      return fail(400, "Unknown action.");
  }
}

function advanceTimeouts(state: EmpireState, now: number, deps: EmpireDeps): EmpireState {
  let current = state;
  let changed = false;
  const turnMs = state.turnMs ?? EMPIRE_RULES.turnMs;
  while (!current.finished && now >= current.turnStartedAt + turnMs) {
    const expiredAt = current.turnStartedAt + turnMs;
    const result = applyAction(current, current.players[current.seat].id, { type: "pass" }, expiredAt, deps);
    if ("error" in result) break;
    current = result;
    changed = true;
  }
  return changed ? current : state;
}

export const actions: EmpireActions = { initEmpire, applyAction, advanceTimeouts };
