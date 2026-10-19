import assert from "node:assert/strict";
import test from "node:test";
import { actions } from "@/lib/empire/actions";
import { cards } from "@/lib/empire/cards";
import { geo } from "@/lib/empire/geo";
import { scoring } from "@/lib/empire/scoring";
import {
  EMPIRE_RULES,
  type ActionError,
  type CardContext,
  type EmpireAction,
  type EmpireCard,
  type EmpireDeps,
  type EmpirePlayer,
  type EmpireState,
  type Rng,
  type ScoreBreakdown
} from "@/lib/empire/types";

// Integration tests: the real geo, cards, scoring and actions modules wired together.

const WILD: EmpireCard = { kind: "wild" };
const ALL: string[] = geo.regionNames().flatMap((region) => geo.regionMembers(region));
const ALL_SET = new Set(ALL);
const { roundCap, winPoints, turnMs, startTokens, fortLimit, eventEvery, lateTokenRound } = EMPIRE_RULES;

/** Small deterministic PRNG (mulberry32). */
function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeDeps(seed: number): EmpireDeps {
  return { geo, cards, scoring, rng: mulberry32(seed) };
}

function isError(value: EmpireState | ActionError): value is ActionError {
  return "error" in value;
}

function ok(result: EmpireState | ActionError): EmpireState {
  if (isError(result)) assert.fail(`rejected: ${result.error} (${result.status})`);
  return result;
}

function rejected(result: EmpireState | ActionError, status?: number): ActionError {
  assert.ok(isError(result), "expected the action to be rejected");
  if (status !== undefined) assert.equal(result.status, status, result.error);
  return result;
}

function player(id: string, capital: string, stealTokens: number = startTokens, forts: string[] = []): EmpirePlayer {
  return { id, capital, stealTokens, forts };
}

function stateOf(players: EmpirePlayer[], owners: Record<string, string>, extra: Partial<EmpireState> = {}): EmpireState {
  return {
    players,
    owners,
    round: 1,
    seat: 0,
    turnStartedAt: 0,
    empireHolder: null,
    event: null,
    hand: [WILD, WILD],
    chosen: null,
    log: [],
    finished: false,
    winnerIds: [],
    ...extra
  };
}

function ownedBy(state: Pick<EmpireState, "owners">, id: string): string[] {
  return ALL.filter((code) => state.owners[code] === id);
}

function scoresOf(state: Pick<EmpireState, "players" | "owners" | "empireHolder" | "log">): Record<string, ScoreBreakdown> {
  return scoring.scoreEmpire(state, geo).scores;
}

/** Id of the unique lowest total (the module's "strictly last"), or null. */
function strictlyLastId(state: EmpireState): string | null {
  if (state.players.length < 2) return null;
  const scores = scoresOf(state);
  const min = Math.min(...state.players.map((p) => scores[p.id].total));
  const lowest = state.players.filter((p) => scores[p.id].total === min);
  return lowest.length === 1 ? lowest[0].id : null;
}

/** Countries reachable from `start` in breadth-first order, skipping `avoid`. The first k form a connected set. */
function bfsChain(start: string, k: number, avoid: Set<string> = new Set()): string[] {
  const out = [start];
  const seen = new Set([start, ...avoid]);
  const queue = [start];
  while (out.length < k && queue.length > 0) {
    const code = queue.shift() as string;
    for (const next of geo.neighbours(code)) {
      if (out.length >= k) break;
      if (!seen.has(next)) {
        seen.add(next);
        out.push(next);
        queue.push(next);
      }
    }
  }
  assert.equal(out.length, k, `could not grow a ${k}-country chain from ${start}`);
  return out;
}

function neighbourhood(codes: string[]): Set<string> {
  const out = new Set<string>();
  for (const code of codes) for (const n of geo.neighbours(code)) out.add(n);
  return out;
}

function closedContinentOf(state: EmpireState): string | undefined {
  return state.event?.kind === "closedContinent" ? state.event.continent : undefined;
}

// ---------- invariants ----------

function checkState(state: EmpireState, label: string) {
  const ids = state.players.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, `${label}: duplicate player ids`);
  assert.ok(state.seat >= 0 && state.seat < state.players.length, `${label}: seat out of range`);
  assert.ok(state.round >= 1 && state.round <= roundCap + 1, `${label}: round ${state.round} out of range`);
  if (!state.finished) assert.ok(state.round <= roundCap, `${label}: round past the cap while still running`);

  for (const [code, owner] of Object.entries(state.owners)) {
    assert.ok(ALL_SET.has(code), `${label}: owned unknown country ${code}`);
    assert.ok(ids.includes(owner), `${label}: ${code} owned by non-player ${owner}`);
  }
  for (const p of state.players) {
    assert.equal(state.owners[p.capital], p.id, `${label}: ${p.id} lost capital ${p.capital}`);
    assert.ok(p.stealTokens >= 0, `${label}: ${p.id} has negative steal tokens`);
    assert.ok(p.stealTokens <= startTokens + (p.lateTokenGiven ? 1 : 0), `${label}: ${p.id} has too many steal tokens`);
    assert.ok(p.forts.length <= fortLimit, `${label}: ${p.id} has more than ${fortLimit} forts`);
    assert.equal(new Set(p.forts).size, p.forts.length, `${label}: ${p.id} fortified a country twice`);
    for (const fort of p.forts) {
      assert.equal(state.owners[fort], p.id, `${label}: ${p.id} fort ${fort} is not theirs`);
      assert.ok(!state.players.some((q) => q.capital === fort), `${label}: fort on a capital ${fort}`);
    }
  }

  const scored = scoring.scoreEmpire(state, geo);
  assert.equal(scored.empireHolder, state.empireHolder, `${label}: stored empire holder is stale`);
  let countrySum = 0;
  let maxSize = 0;
  for (const p of state.players) {
    const s = scored.scores[p.id];
    const setPoints = s.sets.reduce((sum, set) => sum + set.points, 0);
    assert.equal(s.total, s.countries + s.goldRush + s.empire + setPoints + s.majorities.length, `${label}: ${p.id} total is not the sum of its parts`);
    assert.equal(s.countries, ownedBy(state, p.id).length, `${label}: ${p.id} country count is wrong`);
    assert.equal(s.empire, scored.empireHolder === p.id ? EMPIRE_RULES.empireBonus : 0, `${label}: ${p.id} empire bonus is wrong`);
    countrySum += s.countries;
    maxSize = Math.max(maxSize, s.empireSize);
  }
  assert.equal(countrySum, Object.keys(state.owners).length, `${label}: countries do not add up to owned countries`);
  if (scored.empireHolder !== null) {
    const holder = scored.scores[scored.empireHolder];
    assert.ok(holder.empireSize >= empireMin(), `${label}: empire holder has only ${holder.empireSize}`);
    assert.equal(holder.empireSize, maxSize, `${label}: empire holder is not the biggest group`);
  }
}

function empireMin(): number {
  return EMPIRE_RULES.empireMin;
}

/** At turn start: the hand has 3 cards for a strictly last player, else 2, and each non-wild card fits an open country. */
function checkTurnStart(state: EmpireState, label: string) {
  if (state.finished) return;
  assert.equal(state.chosen, null, `${label}: a pick survived the turn change`);
  const current = state.players[state.seat];
  const expected = strictlyLastId(state) === current.id ? EMPIRE_RULES.underdogCards : EMPIRE_RULES.cardsDealt;
  assert.equal(state.hand.length, expected, `${label}: hand size ${state.hand.length}, expected ${expected}`);

  const closed = closedContinentOf(state);
  const open = ALL.filter((c) => state.owners[c] === undefined && (closed === undefined || geo.continentOf(c) !== closed));
  const ctx: CardContext = { ownedByMe: new Set(ownedBy(state, current.id)), neighbours: (c) => geo.neighbours(c) };
  state.hand.forEach((card, i) => {
    if (card.kind === "wild") return;
    assert.ok(open.some((c) => cards.cardFits(card, c, ctx)), `${label}: hand card ${i} (${cards.cardLabel(card)}) is unplayable`);
  });
}

function checkTransition(prev: EmpireState, next: EmpireState, action: EmpireAction, label: string) {
  assert.ok(next.log.length >= prev.log.length, `${label}: log shrank`);
  assert.ok(next.round >= prev.round, `${label}: round went backwards`);
  if (next.finished) return;
  if (next.round === prev.round) {
    assert.deepEqual(next.event, prev.event, `${label}: event changed mid-round`);
  } else {
    assert.equal(next.event !== null, prev.round % eventEvery === 0, `${label}: wrong event for round ${next.round}`);
  }
  if (action.type === "pick") return;

  assert.equal(next.log.length, prev.log.length + 1, `${label}: an action should add exactly one log entry`);
  const entry = next.log[next.log.length - 1];
  const actorPrev = prev.players[prev.seat];
  assert.equal(entry.playerId, actorPrev.id, `${label}: log credits the wrong player`);
  assert.notEqual(next.seat, prev.seat, `${label}: turn did not pass`);
  const actorNext = next.players.find((p) => p.id === actorPrev.id) as EmpirePlayer;
  const tokensBefore = prev.players.find((p) => p.id === actorPrev.id)?.stealTokens ?? 0;

  if (entry.kind === "steal") {
    assert.equal(next.owners[entry.code as string], actorPrev.id, `${label}: stolen country not transferred`);
    assert.equal(entry.from, prev.owners[entry.code as string], `${label}: steal log names the wrong victim`);
    const free = prev.event?.kind === "freeSteals";
    assert.equal(actorNext.stealTokens, free ? tokensBefore : tokensBefore - 1, `${label}: steal token accounting wrong`);
  } else if (entry.kind === "claim") {
    assert.equal(prev.owners[entry.code as string], undefined, `${label}: claimed an owned country`);
    assert.equal(next.owners[entry.code as string], actorPrev.id, `${label}: claimed country not owned`);
    assert.equal(entry.points, prev.event?.kind === "goldRush" ? 2 : 1, `${label}: wrong claim points`);
  } else if (entry.kind === "pass" && entry.code !== undefined) {
    // Wrong capital: owner unchanged, no token spent.
    assert.equal(next.owners[entry.code], prev.owners[entry.code], `${label}: wrong capital changed ownership`);
    assert.equal(actorNext.stealTokens, tokensBefore, `${label}: wrong capital spent a token`);
  } else if (entry.kind === "fortify") {
    assert.equal(next.owners[entry.code as string], actorPrev.id, `${label}: fortified a country not owned`);
  }
  for (const p of next.players) {
    const before = prev.players.find((q) => q.id === p.id) as EmpirePlayer;
    if (p.id !== actorPrev.id || entry.kind !== "steal") {
      if (p.stealTokens !== before.stealTokens) {
        assert.ok(p.lateTokenGiven && !before.lateTokenGiven, `${label}: ${p.id} tokens changed unexpectedly`);
      }
    }
  }
}

function checkEnd(state: EmpireState, seed: number, stats: Stats) {
  assert.ok(state.finished, `seed ${seed}: not finished`);
  assert.ok(state.winnerIds.length > 0, `seed ${seed}: no winner`);
  const scores = scoresOf(state);
  const totals = state.players.map((p) => scores[p.id].total);
  const top = Math.max(...totals);
  const topPlayers = state.players.filter((p) => scores[p.id].total === top);
  const topCountries = Math.max(...topPlayers.map((p) => scores[p.id].countries));
  for (const id of state.winnerIds) {
    assert.ok(state.players.some((p) => p.id === id), `seed ${seed}: winner ${id} is not a player`);
    assert.equal(scores[id].total, top, `seed ${seed}: winner ${id} is not on the top total`);
    assert.equal(scores[id].countries, topCountries, `seed ${seed}: winner ${id} loses the countries tie-break`);
  }
  if (state.round > roundCap) {
    stats.finishedByCap += 1;
  } else {
    stats.finishedByPoints += 1;
    assert.ok(top >= winPoints, `seed ${seed}: ended on points without anyone reaching ${winPoints}`);
  }
  assert.ok(state.round <= roundCap + 1, `seed ${seed}: game ran past the round cap`);
}

// ---------- bot ----------

type Stats = {
  games: number;
  actions: number;
  claims: number;
  steals: number;
  wrongCapitals: number;
  forts: number;
  passes: number;
  timeoutPasses: number;
  lateTokens: number;
  underdogHands: number;
  finishedByCap: number;
  finishedByPoints: number;
  events: Record<string, number>;
};

function emptyStats(): Stats {
  return {
    games: 0, actions: 0, claims: 0, steals: 0, wrongCapitals: 0, forts: 0, passes: 0,
    timeoutPasses: 0, lateTokens: 0, underdogHands: 0, finishedByCap: 0, finishedByPoints: 0, events: {}
  };
}

function chooseAction(state: EmpireState, actorId: string, rng: Rng): EmpireAction {
  const me = state.players[state.seat];
  const card = state.hand[state.chosen as number];
  const mine = new Set(ownedBy(state, actorId));
  const ctx: CardContext = { ownedByMe: mine, neighbours: (c) => geo.neighbours(c) };
  const scores = scoresOf(state);
  const protectedSet = scoring.protectedCodes(state, geo);
  const closed = closedContinentOf(state);
  const roll = rng();

  const canSteal = state.event?.kind !== "ceasefire" && (me.stealTokens > 0 || state.event?.kind === "freeSteals");
  if (roll < 0.08) return { type: "pass" };
  if (roll < 0.3 && canSteal) {
    const candidates = ALL.filter((code) => {
      const owner = state.owners[code];
      return owner !== undefined && owner !== actorId
        && geo.neighbours(code).some((n) => mine.has(n))
        && scores[owner].total >= scores[actorId].total
        && !protectedSet.has(code)
        && cards.cardFits(card, code, ctx);
    });
    if (candidates.length > 0) {
      const code = candidates[Math.floor(rng() * candidates.length)];
      const capital = rng() < 0.85 ? geo.capitalsOf(code)[0] ?? "" : "Nowhere at all";
      return { type: "steal", code, capital };
    }
  }
  if (roll < 0.36 && me.forts.length < fortLimit) {
    const capitals = new Set(state.players.map((p) => p.capital));
    const candidates = [...mine].filter((code) => !capitals.has(code) && !me.forts.includes(code));
    if (candidates.length > 0) return { type: "fortify", code: candidates[Math.floor(rng() * candidates.length)] };
  }
  const open = ALL.filter((c) => state.owners[c] === undefined && (closed === undefined || geo.continentOf(c) !== closed));
  const fits = open.filter((c) => cards.cardFits(card, c, ctx));
  if (fits.length === 0) return { type: "pass" };
  return { type: "claim", code: fits[Math.floor(rng() * fits.length)] };
}

/** Actions that must be refused. None of them may change the state. */
function tryIllegal(state: EmpireState, actorId: string, now: number, deps: EmpireDeps, rng: Rng) {
  const before = JSON.stringify(state);
  const mine = ownedBy(state, actorId);
  const unowned = ALL.filter((c) => state.owners[c] === undefined);
  const attempts: EmpireAction[] = [
    { type: "pick", index: state.hand.length },
    { type: "fortify", code: unowned[Math.floor(rng() * unowned.length)] },
    { type: "claim", code: "ZZ" }
  ];
  if (mine.length > 0) {
    attempts.push({ type: "claim", code: mine[0] });
    attempts.push({ type: "steal", code: mine[0], capital: geo.capitalsOf(mine[0])[0] ?? "" });
  }
  for (const action of attempts) {
    const res = actions.applyAction(state, actorId, action, now, deps);
    rejected(res);
    assert.equal(JSON.stringify(state), before, `rejected ${action.type} still mutated the state`);
  }
  const other = state.players.find((p) => p.id !== actorId);
  if (other) {
    rejected(actions.applyAction(state, other.id, { type: "pass" }, now, deps), 409);
    assert.equal(JSON.stringify(state), before, "an out-of-turn pass mutated the state");
  }
}

function runGame(seed: number, stats: Stats) {
  const deps = makeDeps(seed);
  const botRng = mulberry32(seed * 7919 + 13);
  const count = 2 + Math.floor(botRng() * 4);
  const ids = Array.from({ length: count }, (_, i) => `p${i + 1}`);
  let now = 1_000_000;
  let state = actions.initEmpire(ids, now, deps);
  stats.games += 1;
  checkState(state, `seed ${seed} init`);
  checkTurnStart(state, `seed ${seed} init`);

  for (let step = 1; !state.finished; step += 1) {
    assert.ok(step < 5000, `seed ${seed}: game did not finish within 5000 steps`);
    const label = `seed ${seed} step ${step} round ${state.round}`;

    // Sometimes the clock runs past a deadline; the server applies timeouts first.
    now += botRng() < 0.1 ? turnMs + 1 + Math.floor(botRng() * 3000) : Math.floor(botRng() * 12000);
    const timed = actions.advanceTimeouts(state, now, deps);
    if (timed !== state) {
      const added = timed.log.slice(state.log.length);
      for (const entry of added) {
        assert.equal(entry.kind, "pass", `${label}: a timeout produced a ${entry.kind}`);
        assert.equal(entry.at % 1, 0, `${label}: timeout time is not whole`);
      }
      stats.timeoutPasses += added.length;
      if (timed.round === state.round + 1 && !timed.finished) {
        stats.events[timed.event?.kind ?? "none"] = (stats.events[timed.event?.kind ?? "none"] ?? 0) + 1;
      }
      checkState(timed, `${label} timeout`);
      checkTurnStart(timed, `${label} timeout`);
      state = timed;
      continue;
    }

    const actorId = state.players[state.seat].id;
    if (state.chosen === null) {
      const index = Math.floor(botRng() * state.hand.length);
      const next = ok(actions.applyAction(state, actorId, { type: "pick", index }, now, deps));
      assert.equal(next.chosen, index, `${label}: pick not recorded`);
      assert.deepEqual(next.owners, state.owners, `${label}: pick changed ownership`);
      assert.equal(next.log.length, state.log.length, `${label}: pick wrote to the log`);
      checkState(next, `${label} pick`);
      state = next;
      continue;
    }

    if (botRng() < 0.08) tryIllegal(state, actorId, now, deps, botRng);

    const action = chooseAction(state, actorId, botRng);
    const next = ok(actions.applyAction(state, actorId, action, now, deps));
    stats.actions += 1;
    checkState(next, label);
    checkTransition(state, next, action, label);
    const entry = next.log[next.log.length - 1];
    if (entry) {
      if (entry.kind === "claim") stats.claims += 1;
      if (entry.kind === "steal") stats.steals += 1;
      if (entry.kind === "fortify") stats.forts += 1;
      if (entry.kind === "pass" && entry.code !== undefined) stats.wrongCapitals += 1;
      else if (entry.kind === "pass") stats.passes += 1;
    }
    if (next.round === state.round + 1 && !next.finished) {
      stats.events[next.event?.kind ?? "none"] = (stats.events[next.event?.kind ?? "none"] ?? 0) + 1;
    }
    if (next.players.some((p) => p.lateTokenGiven) && !state.players.some((p) => p.lateTokenGiven)) stats.lateTokens += 1;
    if (!next.finished && next.hand.length === EMPIRE_RULES.underdogCards) stats.underdogHands += 1;
    state = next;
    if (state.finished) break;
    checkTurnStart(state, label);
  }

  checkEnd(state, seed, stats);
  const after = JSON.stringify(state);
  rejected(actions.applyAction(state, state.players[0].id, { type: "pass" }, now, deps), 409);
  assert.equal(JSON.stringify(state), after, "a finished game was mutated");
}

// ---------- tests ----------

test("300 seeded bot games keep every invariant after every action", () => {
  const stats = emptyStats();
  for (let seed = 1; seed <= 300; seed += 1) runGame(seed, stats);
  // Coverage: the bot must actually exercise the interesting paths.
  assert.ok(stats.claims > 1000, `too few claims: ${stats.claims}`);
  assert.ok(stats.steals > 20, `too few steals: ${stats.steals}`);
  assert.ok(stats.wrongCapitals > 0, "no wrong-capital steals exercised");
  assert.ok(stats.forts > 0, "no forts exercised");
  assert.ok(stats.timeoutPasses > 0, "no timeouts exercised");
  assert.ok(stats.underdogHands > 0, "no underdog hands exercised");
  assert.ok(stats.finishedByCap + stats.finishedByPoints === stats.games, "some games did not finish");
  console.log(`empire bot: ${JSON.stringify(stats)}`);
});

test("steal of an island works across its sea route (JP via KR)", () => {
  assert.ok(geo.neighbours("JP").includes("KR"), "JP should link to KR");
  assert.ok(geo.seaRoutes().some(([a, b]) => a === "JP" && b === "KR"), "JP-KR should be a sea route");
  const deps = makeDeps(1);
  const start = stateOf(
    [player("p1", "FR"), player("p2", "CN")],
    { FR: "p1", KR: "p1", CN: "p2", JP: "p2", PH: "p2", VN: "p2", TH: "p2" },
    { hand: [{ kind: "island" }, WILD] }
  );
  let s = ok(actions.applyAction(start, "p1", { type: "pick", index: 0 }, 10, deps));
  s = ok(actions.applyAction(s, "p1", { type: "steal", code: "JP", capital: "Tokyo" }, 10, deps));
  assert.equal(s.owners.JP, "p1");
  assert.equal(s.players[0].stealTokens, startTokens - 1);
  assert.ok(s.log.some((e) => e.kind === "steal" && e.code === "JP" && e.from === "p2"));
});

test("island steal is refused when the thief has no land or sea border with it", () => {
  const deps = makeDeps(2);
  const start = stateOf(
    [player("p1", "FR"), player("p2", "CN")],
    { FR: "p1", CN: "p2", JP: "p2", PH: "p2", VN: "p2", TH: "p2" },
    { hand: [{ kind: "island" }, WILD] }
  );
  const s = ok(actions.applyAction(start, "p1", { type: "pick", index: 0 }, 10, deps));
  rejected(actions.applyAction(s, "p1", { type: "steal", code: "JP", capital: "Tokyo" }, 10, deps), 409);
});

test("a completed small region set protects its countries from steals", () => {
  const set = geo.regionMembers("Australia and New Zealand").slice().sort();
  assert.deepEqual(set, ["AU", "NZ"]);
  assert.ok(geo.neighbours("AU").includes("PG"), "AU should border PG by sea");
  const deps = makeDeps(3);

  const full = stateOf(
    [player("p1", "PG"), player("p2", "FJ")],
    { PG: "p1", FJ: "p2", AU: "p2", NZ: "p2" }
  );
  assert.ok(scoring.protectedCodes(full, geo).has("AU"), "AU should be protected by the completed set");
  const blocked = ok(actions.applyAction(full, "p1", { type: "pick", index: 0 }, 10, deps));
  const err = rejected(actions.applyAction(blocked, "p1", { type: "steal", code: "AU", capital: "Canberra" }, 10, deps), 409);
  assert.match(err.error, /protected/i);

  const partial = stateOf(
    [player("p1", "PG"), player("p2", "FJ")],
    { PG: "p1", FJ: "p2", AU: "p2" }
  );
  assert.ok(!scoring.protectedCodes(partial, geo).has("AU"), "AU is not protected while its set is incomplete");
  let s = ok(actions.applyAction(partial, "p1", { type: "pick", index: 0 }, 10, deps));
  s = ok(actions.applyAction(s, "p1", { type: "steal", code: "AU", capital: "Canberra" }, 10, deps));
  assert.equal(s.owners.AU, "p1");
});

test("empire holder keeps the bonus on a tie and loses it when stolen below 5", () => {
  const deps = makeDeps(4);
  const p1Set = bfsChain("FR", 5);
  const p2Set = bfsChain("JP", 5, new Set([...p1Set, ...neighbourhood(p1Set)]));
  assert.equal(new Set([...p1Set, ...p2Set]).size, 10, "groups must be disjoint");
  assert.ok(p2Set.every((c) => !neighbourhood(p1Set).has(c)), "groups must not touch");

  const owners: Record<string, string> = {};
  for (const c of p1Set) owners[c] = "p1";
  for (const c of p2Set) owners[c] = "p2";
  const players = [player("p1", "FR"), player("p2", "JP")];

  const tie = scoring.scoreEmpire({ players, owners, empireHolder: "p1", log: [] }, geo);
  assert.equal(tie.scores.p1.empireSize, 5);
  assert.equal(tie.scores.p2.empireSize, 5);
  assert.equal(tie.empireHolder, "p1", "a tie keeps the previous holder");
  assert.equal(tie.scores.p1.empire, EMPIRE_RULES.empireBonus);
  assert.equal(tie.scores.p2.empire, 0);

  const noPrev = scoring.scoreEmpire({ players, owners, empireHolder: null, log: [] }, geo);
  assert.equal(noPrev.empireHolder, null, "a tie with no previous holder gives nobody the bonus");

  // p2 grows to 6 and takes the bonus from p1.
  const grown = bfsChain("JP", 6, new Set([...p1Set, ...neighbourhood(p1Set)]));
  const owners6 = { ...owners, [grown[5]]: "p2" };
  const bigger = scoring.scoreEmpire({ players, owners: owners6, empireHolder: "p1", log: [] }, geo);
  assert.equal(bigger.empireHolder, "p2");
  assert.equal(bigger.scores.p1.empire, 0);

  // A thief with one country (its capital, next to p1's group) steals a p1 country through a real steal.
  // p1 falls to 4 connected, below the 5 needed, and loses the bonus.
  const target = p1Set.find((c) => c !== "FR" && geo.neighbours(c).some((n) => owners[n] === undefined))!;
  const thiefBorder = geo.neighbours(target).find((n) => owners[n] === undefined)!;
  const thiefOwners: Record<string, string> = { ...Object.fromEntries(p1Set.map((c) => [c, "p1"])), [thiefBorder]: "p2" };
  const thiefPlayers = [player("p1", "FR"), player("p2", thiefBorder)];
  const thiefState = stateOf(thiefPlayers, thiefOwners, { empireHolder: "p1", seat: 1, hand: [WILD, WILD] });
  assert.equal(scoresOf(thiefState).p1.empireSize, 5);
  const sw = ok(actions.applyAction(thiefState, "p2", { type: "pick", index: 0 }, 10, deps));
  const stolen = ok(actions.applyAction(sw, "p2", { type: "steal", code: target, capital: geo.capitalsOf(target)[0] ?? "" }, 10, deps));
  assert.equal(stolen.owners[target], "p2");
  assert.equal(stolen.empireHolder, null, "p1 fell below 5 and should lose the bonus");
  assert.equal(scoresOf(stolen).p1.empire, 0);
});

test("gold rush points stay with the claimer only while they still own the country", () => {
  const deps = makeDeps(5);
  const start = stateOf(
    [player("p1", "FR"), player("p2", "PL")],
    { FR: "p1", PL: "p2" },
    { event: { kind: "goldRush" }, hand: [WILD, WILD] }
  );
  let s = ok(actions.applyAction(start, "p1", { type: "pick", index: 0 }, 10, deps));
  s = ok(actions.applyAction(s, "p1", { type: "claim", code: "DE" }, 10, deps));
  const rushed = scoresOf(s);
  assert.equal(rushed.p1.goldRush, 1, "claim during gold rush should add 1 extra point");
  assert.equal(rushed.p1.countries, 2);
  assert.equal(rushed.p1.total, 3);

  // p2 borders DE (through PL) and steals it: the extra point must leave with it.
  const turn2 = { ...s, hand: [WILD, WILD], chosen: null };
  let t = ok(actions.applyAction(turn2, "p2", { type: "pick", index: 1 }, 20, deps));
  t = ok(actions.applyAction(t, "p2", { type: "steal", code: "DE", capital: "Berlin" }, 20, deps));
  assert.equal(t.owners.DE, "p2");
  const after = scoresOf(t);
  assert.equal(after.p1.goldRush, 0, "gold rush bonus must follow the country");
  assert.equal(after.p2.goldRush, 0, "the thief does not inherit the bonus");
  assert.equal(after.p1.total, 1);
});

test("a closed continent blocks claims there and is never dealt as a fitting card", () => {
  const deps = makeDeps(6);
  const start = stateOf(
    [player("p1", "FR"), player("p2", "JP")],
    { FR: "p1", JP: "p2" },
    { event: { kind: "closedContinent", continent: "Europe" }, hand: [WILD, WILD] }
  );
  let s = ok(actions.applyAction(start, "p1", { type: "pick", index: 0 }, 10, deps));
  rejected(actions.applyAction(s, "p1", { type: "claim", code: "DE" }, 10, deps), 409);
  s = ok(actions.applyAction(s, "p1", { type: "claim", code: "KR" }, 10, deps));
  assert.equal(s.owners.KR, "p1", "Asia stays open while Europe is closed");

  for (let seed = 1; seed <= 200; seed += 1) {
    const ctx = {
      ownedByMe: new Set(["FR"]),
      neighbours: (c: string) => geo.neighbours(c),
      unclaimed: ALL.filter((c) => c !== "FR" && c !== "JP"),
      event: { kind: "closedContinent" as const, continent: "Europe" },
      rng: mulberry32(seed)
    };
    const hand = cards.dealHand(2, ctx);
    const open = ctx.unclaimed.filter((c) => geo.continentOf(c) !== "Europe");
    for (const card of hand) {
      assert.ok(!(card.kind === "continent" && card.continent === "Europe"), `seed ${seed}: dealt the closed continent`);
      if (card.kind === "wild") continue;
      assert.ok(open.some((c) => cards.cardFits(card, c, { ownedByMe: ctx.ownedByMe, neighbours: ctx.neighbours })),
        `seed ${seed}: ${cards.cardLabel(card)} fits only the closed continent`);
    }
  }
});

test("timeouts across several turns land on the right player and round", () => {
  const deps = makeDeps(7);
  const s0 = actions.initEmpire(["a", "b", "c"], 0, deps);
  const order = s0.players.map((p) => p.id);
  assert.equal(actions.advanceTimeouts(s0, turnMs - 1, deps), s0, "no expiry before 20 s");

  const s2 = actions.advanceTimeouts(s0, 2 * turnMs, deps);
  assert.equal(s2.log.length, 2);
  assert.deepEqual(s2.log.map((e) => e.playerId), [order[0], order[1]]);
  assert.deepEqual(s2.log.map((e) => e.at), [turnMs, 2 * turnMs]);
  assert.equal(s2.seat, 2);
  assert.equal(s2.round, 1);
  assert.equal(s2.turnStartedAt, 2 * turnMs);

  const s3 = actions.advanceTimeouts(s2, 3 * turnMs, deps);
  assert.equal(s3.seat, 0);
  assert.equal(s3.round, 2);
  assert.equal(s3.event, null);

  // Nine expired turns: rounds 1-3 all close; round 3 closing reveals an event for round 4.
  const s9 = actions.advanceTimeouts(s0, 9 * turnMs, deps);
  assert.equal(s9.round, 4);
  assert.equal(s9.seat, 0);
  assert.deepEqual(s9.log.map((e) => e.playerId), [...order, ...order, ...order]);
  assert.ok(s9.event !== null, "round 3 closing should reveal an event");
  assert.equal(s9.turnStartedAt, 9 * turnMs);

  // The event lasts one round: after round 4 closes it is gone.
  const s12 = actions.advanceTimeouts(s9, 12 * turnMs, deps);
  assert.equal(s12.round, 5);
  assert.equal(s12.event, null);
});

test("a timed-out turn clears the pick and does not spend a steal token", () => {
  const deps = makeDeps(8);
  const start = stateOf(
    [player("p1", "FR"), player("p2", "JP")],
    { FR: "p1", JP: "p2" },
    { turnStartedAt: 0, chosen: 1, hand: [{ kind: "island" }, WILD] }
  );
  const timed = actions.advanceTimeouts(start, turnMs, deps);
  assert.equal(timed.chosen, null);
  assert.equal(timed.seat, 1);
  assert.equal(timed.players[0].stealTokens, startTokens);
});

test("a late action is refused once advanceTimeouts has applied the expiry", () => {
  const deps = makeDeps(9);
  const start = stateOf([player("p1", "FR"), player("p2", "JP")], { FR: "p1", JP: "p2" }, { chosen: 0, hand: [WILD, WILD] });
  const expired = actions.advanceTimeouts(start, turnMs + 500, deps);
  assert.equal(expired.seat, 1);
  rejected(actions.applyAction(expired, "p1", { type: "claim", code: "DE" }, turnMs + 500, deps), 409);
});

test("late steal token goes once to the strictly last player after round 8", () => {
  const deps = makeDeps(10);
  const start = stateOf(
    [player("p1", "FR"), player("p2", "JP")],
    { FR: "p1", DE: "p1", IT: "p1", JP: "p2" },
    { round: lateTokenRound, seat: 1, hand: [WILD, WILD] }
  );
  let s = ok(actions.applyAction(start, "p2", { type: "pick", index: 0 }, 10, deps));
  s = ok(actions.applyAction(s, "p2", { type: "pass" }, 10, deps));
  assert.equal(s.round, lateTokenRound + 1);
  const p2 = s.players[1];
  assert.equal(p2.stealTokens, startTokens + 1, "strictly last player gets the late token");
  assert.equal(p2.lateTokenGiven, true);
  assert.equal(s.players[0].stealTokens, startTokens);

  // A later round end does not give another one.
  s = { ...s, seat: 1, hand: [WILD, WILD], chosen: null };
  s = ok(actions.applyAction(s, "p2", { type: "pass" }, 30, deps));
  assert.equal(s.players[1].stealTokens, startTokens + 1, "only once per game");
});

test("no late token when the last place is shared", () => {
  const deps = makeDeps(11);
  const start = stateOf(
    [player("p1", "FR"), player("p2", "JP")],
    { FR: "p1", DE: "p1", JP: "p2", KR: "p2" },
    { round: lateTokenRound, seat: 1, hand: [WILD, WILD] }
  );
  let s = ok(actions.applyAction(start, "p2", { type: "pick", index: 0 }, 10, deps));
  s = ok(actions.applyAction(s, "p2", { type: "pass" }, 10, deps));
  assert.equal(s.players[1].stealTokens, startTokens);
  assert.equal(s.players[1].lateTokenGiven ?? false, false);
});

test("the strictly last player gets 3 cards, a shared last place gets 2", () => {
  const deps = makeDeps(12);
  const behind = stateOf(
    [player("p1", "FR"), player("p2", "JP")],
    { FR: "p1", DE: "p1", IT: "p1", JP: "p2" }
  );
  const passed = ok(actions.applyAction(behind, "p1", { type: "pass" }, 10, deps));
  assert.equal(passed.seat, 1);
  assert.equal(passed.hand.length, EMPIRE_RULES.underdogCards);

  const tied = stateOf(
    [player("p1", "FR"), player("p2", "JP")],
    { FR: "p1", DE: "p1", JP: "p2", KR: "p2" }
  );
  const tiedPassed = ok(actions.applyAction(tied, "p1", { type: "pass" }, 10, deps));
  assert.equal(tiedPassed.hand.length, EMPIRE_RULES.cardsDealt);
});

test("reaching winPoints on your own turn ends the game with you as the winner", () => {
  const deps = makeDeps(13);
  const group = bfsChain("FR", 14);
  const owners: Record<string, string> = { JP: "p2" };
  for (const c of group) owners[c] = "p1";
  const start = stateOf([player("p1", "FR"), player("p2", "JP")], owners, { hand: [WILD, WILD] });
  const frontier = [...neighbourhood(group)].find((c) => owners[c] === undefined)!;
  let s = ok(actions.applyAction(start, "p1", { type: "pick", index: 0 }, 10, deps));
  s = ok(actions.applyAction(s, "p1", { type: "claim", code: frontier }, 10, deps));
  assert.equal(s.finished, true);
  assert.deepEqual(s.winnerIds, ["p1"]);
  assert.ok(scoresOf(s).p1.total >= winPoints);
});

test("round-cap winners: highest total, then most countries, else shared", () => {
  const score = (total: number, countries: number): ScoreBreakdown => ({
    countries, goldRush: 0, empireSize: 0, empire: 0, sets: [], majorities: [], total
  });
  const scores = { a: score(6, 4), b: score(6, 3), c: score(5, 5) };
  assert.deepEqual(scoring.winners(scores, "cap"), ["a"]);
  assert.deepEqual(scoring.winners({ a: score(6, 4), b: score(6, 4) }, "cap").sort(), ["a", "b"]);
  assert.deepEqual(scoring.winners({ a: score(7, 2), b: score(6, 6) }, "cap"), ["a"]);
});

test("fortify: two forts, never a capital, never a country you do not own, and forts protect", () => {
  const deps = makeDeps(14);
  const owners = { FR: "p1", DE: "p1", BE: "p1", IT: "p1", JP: "p2", PL: "p2" };
  const p1Turn = (forts: string[] = []) => stateOf(
    [player("p1", "FR", startTokens, forts), player("p2", "JP")],
    owners,
    { hand: [WILD, WILD] }
  );
  rejected(actions.applyAction(p1Turn(), "p1", { type: "fortify", code: "FR" }, 10, deps), 409);
  rejected(actions.applyAction(p1Turn(), "p1", { type: "fortify", code: "ES" }, 10, deps), 409);

  const once = ok(actions.applyAction(p1Turn(), "p1", { type: "fortify", code: "DE" }, 10, deps));
  assert.deepEqual(once.players[0].forts, ["DE"]);
  rejected(actions.applyAction(p1Turn(["DE"]), "p1", { type: "fortify", code: "DE" }, 10, deps), 409);
  const twice = ok(actions.applyAction(p1Turn(["DE"]), "p1", { type: "fortify", code: "BE" }, 10, deps));
  assert.deepEqual(twice.players[0].forts, ["DE", "BE"]);
  rejected(actions.applyAction(p1Turn(["DE", "BE"]), "p1", { type: "fortify", code: "IT" }, 10, deps), 409);

  // A fortified country cannot be stolen. p2 borders DE through PL.
  const attack = stateOf(
    [player("p1", "FR", startTokens, ["DE"]), player("p2", "JP")],
    owners,
    { seat: 1, hand: [WILD, WILD] }
  );
  const picked = ok(actions.applyAction(attack, "p2", { type: "pick", index: 0 }, 10, deps));
  const err = rejected(actions.applyAction(picked, "p2", { type: "steal", code: "DE", capital: "Berlin" }, 10, deps), 409);
  assert.match(err.error, /protected/i);
});

test("ceasefire, missing tokens, free steals and wrong capitals", () => {
  const deps = makeDeps(15);
  // p2 owns DE and JP; p1 owns FR only, so p2 (2) >= p1 (1) and p1 borders DE.
  const owners = { FR: "p1", JP: "p2", DE: "p2" };
  const turn = (tokens: number, event: EmpireState["event"] = null) => stateOf(
    [player("p1", "FR", tokens), player("p2", "JP")],
    owners,
    { event, hand: [WILD, WILD] }
  );

  const cease = ok(actions.applyAction(turn(2, { kind: "ceasefire" }), "p1", { type: "pick", index: 0 }, 10, deps));
  rejected(actions.applyAction(cease, "p1", { type: "steal", code: "DE", capital: "Berlin" }, 10, deps), 409);
  const claimed = ok(actions.applyAction(cease, "p1", { type: "claim", code: "IT" }, 10, deps));
  assert.equal(claimed.owners.IT, "p1", "claims still work during a ceasefire");

  const broke = ok(actions.applyAction(turn(0), "p1", { type: "pick", index: 0 }, 10, deps));
  const noToken = rejected(actions.applyAction(broke, "p1", { type: "steal", code: "DE", capital: "Berlin" }, 10, deps), 409);
  assert.match(noToken.error, /token/i);

  const free = ok(actions.applyAction(turn(0, { kind: "freeSteals" }), "p1", { type: "pick", index: 0 }, 10, deps));
  const freed = ok(actions.applyAction(free, "p1", { type: "steal", code: "DE", capital: "Berlin" }, 10, deps));
  assert.equal(freed.owners.DE, "p1");
  assert.equal(freed.players[0].stealTokens, 0, "a free steal spends no token (and none was there to spend)");

  const wrong = ok(actions.applyAction(turn(2), "p1", { type: "pick", index: 0 }, 10, deps));
  const missed = ok(actions.applyAction(wrong, "p1", { type: "steal", code: "DE", capital: "Atlantis" }, 10, deps));
  assert.equal(missed.owners.DE, "p2", "wrong capital keeps the country with its owner");
  assert.equal(missed.players[0].stealTokens, 2, "wrong capital spends no token");
  assert.equal(missed.seat, 1, "wrong capital ends the turn");
  assert.equal(missed.log[missed.log.length - 1].kind, "pass");
});

test("applyAction never mutates its input state", () => {
  const deps = makeDeps(16);
  const start = stateOf([player("p1", "FR"), player("p2", "JP")], { FR: "p1", JP: "p2", DE: "p2" });
  const before = JSON.stringify(start);
  ok(actions.applyAction(start, "p1", { type: "pick", index: 0 }, 10, deps));
  ok(actions.applyAction(start, "p1", { type: "pass" }, 10, deps));
  assert.equal(JSON.stringify(start), before);
});

test("every dealt hand has distinct cards", { todo: "BUG: cards.dealHand can return two identical wild cards when about 5 or fewer countries are unclaimed (fallback path pushes a second wild)" }, () => {
  // Small unclaimed pools force the sampler to fall back. A hand should never repeat a card.
  let repeated: string | null = null;
  for (let seed = 1; seed <= 500 && repeated === null; seed += 1) {
    const rng = mulberry32(seed);
    const pool = ALL.filter(() => rng() < 0.02);
    if (pool.length === 0) continue;
    const hand = cards.dealHand(2, {
      ownedByMe: new Set(["FR"]),
      neighbours: (c) => geo.neighbours(c),
      unclaimed: pool,
      event: null,
      rng: mulberry32(seed + 1000)
    });
    assert.equal(hand.length, 2, `seed ${seed}: wrong hand size`);
    const keys = hand.map((card) => JSON.stringify(card));
    if (new Set(keys).size !== keys.length) repeated = `seed ${seed}: ${keys.join(" and ")}`;
  }
  assert.equal(repeated, null, `a hand repeated a card (${repeated})`);
});
