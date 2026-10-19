import assert from "node:assert/strict";
import test from "node:test";
import { actions } from "@/lib/empire/actions";
import {
  EMPIRE_RULES,
  type ActionError,
  type CardContext,
  type DealContext,
  type EmpireCard,
  type EmpireDeps,
  type EmpireEvent,
  type EmpirePlayer,
  type EmpireState,
  type Rng,
  type ScoreBreakdown
} from "@/lib/empire/types";

// A tiny eight-country world: two regions, two continents.
//   A-B, B-C, C-D, A-D, D-E, E-F, F-G, G-H
const NEIGHBOURS: Record<string, string[]> = {
  A: ["B", "D"],
  B: ["A", "C"],
  C: ["B", "D"],
  D: ["A", "C", "E"],
  E: ["D", "F"],
  F: ["E", "G"],
  G: ["F", "H"],
  H: ["G"]
};
const REGION: Record<string, string> = { A: "North", B: "North", C: "North", D: "North", E: "South", F: "South", G: "South", H: "South" };
const CONTINENT: Record<string, string> = { A: "Europe", B: "Europe", C: "Europe", D: "Europe", E: "Asia", F: "Asia", G: "Asia", H: "Asia" };
const CODES = Object.keys(REGION);
const CONTINENTS = ["Africa", "Americas", "Asia", "Europe", "Oceania"];
const WILD: EmpireCard = { kind: "wild" };

/** Owners where p1 holds the north and p2 the south, with capitals A (p1) and H (p2). */
const SPLIT: Record<string, string> = { A: "p1", B: "p1", E: "p2", H: "p2" };
/** Every country owned, p1 north (4) and p2 south (4). Used for steal tests. */
const STEAL_BOARD: Record<string, string> = { A: "p1", B: "p1", C: "p1", D: "p1", E: "p2", F: "p2", G: "p2", H: "p2" };

type FakeOptions = {
  capitals?: string[];
  events?: EmpireEvent[];
  bonus?: Record<string, number>;
  rng?: Rng;
};

function fakeDeps(options: FakeOptions = {}) {
  const dealt: { count: number; ctx: DealContext }[] = [];
  const drawn: string[][] = [];
  const queue = [...(options.events ?? [])];
  const bonus = options.bonus ?? {};
  const deps: EmpireDeps = {
    geo: {
      neighbours: (code) => NEIGHBOURS[code] ?? [],
      seaRoutes: () => [],
      regionOf: (code) => REGION[code],
      regionMembers: (region) => CODES.filter((code) => REGION[code] === region),
      regionNames: () => ["North", "South"],
      continentOf: (code) => CONTINENT[code],
      capitalsOf: (code) => [`city-${code}`],
      isCapitalOf: (code, answer) => answer === `city-${code}`,
      startingCapitals: (n) => (options.capitals ?? ["A", "H", "C", "E"]).slice(0, n)
    },
    cards: {
      cardFits: (card: EmpireCard, code: string, ctx: CardContext) => {
        switch (card.kind) {
          case "wild":
            return true;
          case "letter":
            return code === card.letter;
          case "region":
            return REGION[code] === card.region;
          case "bordersYou":
            return ctx.neighbours(code).some((n) => ctx.ownedByMe.has(n));
          default:
            return false;
        }
      },
      cardLabel: (card) => card.kind,
      dealHand: (count, ctx) => {
        dealt.push({ count, ctx });
        return Array.from({ length: count }, () => ({ ...WILD }));
      },
      drawEvent: (_rng, continents) => {
        drawn.push(continents);
        return queue.shift() ?? { kind: "wildRound" };
      },
      eventLabel: (event) => event.kind
    },
    scoring: {
      scoreEmpire: (state) => {
        const scores: Record<string, ScoreBreakdown> = {};
        for (const p of state.players) {
          const countries = Object.keys(state.owners).filter((c) => state.owners[c] === p.id).length;
          const goldRush = state.log.reduce(
            (sum, e) => sum + (e.kind === "claim" && e.playerId === p.id ? (e.points ?? 1) - 1 : 0),
            0
          );
          scores[p.id] = {
            countries,
            goldRush,
            empireSize: 0,
            empire: 0,
            sets: [],
            majorities: [],
            total: countries + goldRush + (bonus[p.id] ?? 0)
          };
        }
        return { scores, empireHolder: state.empireHolder };
      },
      protectedCodes: (state) => {
        const codes = state.players.map((p) => p.capital);
        for (const p of state.players) codes.push(...p.forts);
        return new Set(codes);
      },
      winners: (scores) => {
        const top = Math.max(...Object.values(scores).map((s) => s.total));
        return Object.keys(scores).filter((id) => scores[id].total === top);
      }
    },
    rng: options.rng ?? (() => 0.9)
  };
  return { deps, dealt, drawn };
}

/** mulberry32: a small seeded generator for deterministic shuffles. */
function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds a mid-game state for p1 (seat 0 by default) without going through initEmpire. */
function game(
  owners: Record<string, string>,
  o: {
    tokens?: [number, number];
    forts?: [string[], string[]];
    event?: EmpireEvent | null;
    hand?: EmpireCard[];
    chosen?: number | null;
    seat?: number;
    round?: number;
    lateTokenGiven?: string;
    finished?: boolean;
  } = {}
): EmpireState {
  const [t1, t2] = o.tokens ?? [2, 2];
  const [f1, f2] = o.forts ?? [[], []];
  const players: EmpirePlayer[] = [
    { id: "p1", capital: "A", stealTokens: t1, forts: f1, ...(o.lateTokenGiven === "p1" ? { lateTokenGiven: true } : {}) },
    { id: "p2", capital: "H", stealTokens: t2, forts: f2, ...(o.lateTokenGiven === "p2" ? { lateTokenGiven: true } : {}) }
  ];
  return {
    players,
    owners: { ...owners },
    round: o.round ?? 1,
    seat: o.seat ?? 0,
    turnStartedAt: 1000,
    empireHolder: null,
    event: o.event ?? null,
    hand: o.hand ?? [{ ...WILD }, { ...WILD }, { ...WILD }],
    chosen: o.chosen ?? null,
    log: [],
    finished: o.finished ?? false,
    winnerIds: []
  };
}

function ok(result: EmpireState | ActionError): EmpireState {
  if ("error" in result) assert.fail(`expected success, got "${result.error}"`);
  return result;
}

function fails(result: EmpireState | ActionError, status: number, error: string): void {
  if (!("error" in result)) assert.fail("expected an error");
  assert.deepEqual({ status: result.status, error: result.error }, { status, error });
}

function passAs(state: EmpireState, at: number, deps: EmpireDeps): EmpireState {
  return ok(actions.applyAction(state, state.players[state.seat].id, { type: "pass" }, at, deps));
}

function deepFreeze(value: unknown): void {
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
}

test("init shuffles seats, places capitals in seat order, and deals the first hand", () => {
  const { deps, dealt } = fakeDeps();
  const state = actions.initEmpire(["p1", "p2"], 5000, deps);

  assert.deepEqual(state.players, [
    { id: "p1", capital: "A", stealTokens: EMPIRE_RULES.startTokens, forts: [] },
    { id: "p2", capital: "H", stealTokens: EMPIRE_RULES.startTokens, forts: [] }
  ]);
  assert.deepEqual(state.owners, { A: "p1", H: "p2" });
  assert.equal(state.round, 1);
  assert.equal(state.seat, 0);
  assert.equal(state.turnStartedAt, 5000);
  assert.equal(state.empireHolder, null);
  assert.equal(state.event, null);
  assert.deepEqual(state.log, []);
  assert.equal(state.finished, false);
  assert.deepEqual(state.winnerIds, []);
  assert.equal(state.chosen, null);

  // Tied on total at the start, so nobody is an underdog: two cards.
  assert.equal(state.hand.length, 2);
  assert.equal(dealt.length, 1);
  assert.equal(dealt[0].count, EMPIRE_RULES.cardsDealt);
  assert.deepEqual([...dealt[0].ctx.ownedByMe], ["A"]);
  assert.equal(dealt[0].ctx.unclaimed.length, CODES.length - 2);
  assert.ok(!dealt[0].ctx.unclaimed.includes("A"));
  assert.ok(!dealt[0].ctx.unclaimed.includes("H"));
  assert.equal(dealt[0].ctx.event, null);
});

test("seat order is a deterministic permutation of the seeded rng", () => {
  const ids = ["p1", "p2", "p3", "p4"];
  const seatsFor = (seed: number) => {
    const { deps } = fakeDeps({ rng: seeded(seed) });
    const state = actions.initEmpire(ids, 0, deps);
    state.players.forEach((p, i) => assert.equal(state.owners[p.capital], p.id, `capital owner for seat ${i}`));
    return state.players.map((p) => p.id);
  };
  const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
  for (const seed of seeds) {
    const first = seatsFor(seed);
    assert.deepEqual(seatsFor(seed), first, `seed ${seed} is repeatable`);
    assert.deepEqual([...first].sort(), [...ids].sort(), `seed ${seed} is a permutation`);
  }
  const distinct = new Set(seeds.map((seed) => seatsFor(seed).join(",")));
  assert.ok(distinct.size > 1, "different seeds give different seat orders");
});

test("only the current player may act, and a finished game accepts nothing", () => {
  const { deps } = fakeDeps();
  const s = game(SPLIT);
  fails(actions.applyAction(s, "p2", { type: "pass" }, 2000, deps), 409, "It's not your turn.");
  fails(actions.applyAction(s, "nobody", { type: "pass" }, 2000, deps), 409, "It's not your turn.");
  fails(actions.applyAction({ ...s, finished: true }, "p1", { type: "pass" }, 2000, deps), 409, "The game is over.");
});

test("pick requires a valid index, keeps the turn, and can be changed before an action", () => {
  const { deps } = fakeDeps();
  const s = game(SPLIT);
  const picked = ok(actions.applyAction(s, "p1", { type: "pick", index: 1 }, 1500, deps));
  assert.equal(picked.chosen, 1);
  assert.equal(picked.seat, 0);
  assert.equal(picked.turnStartedAt, 1000);
  assert.equal(picked.round, 1);

  const changed = ok(actions.applyAction(picked, "p1", { type: "pick", index: 2 }, 1600, deps));
  assert.equal(changed.chosen, 2);

  fails(actions.applyAction(s, "p1", { type: "pick", index: 3 }, 1500, deps), 400, "Pick a card from your hand.");
  fails(actions.applyAction(s, "p1", { type: "pick", index: -1 }, 1500, deps), 400, "Pick a card from your hand.");
  fails(actions.applyAction(s, "p1", { type: "pick", index: 1.5 }, 1500, deps), 400, "Pick a card from your hand.");
});

test("claim requires a picked card and a known, unowned, fitting country", () => {
  const { deps } = fakeDeps();
  fails(actions.applyAction(game(SPLIT), "p1", { type: "claim", code: "C" }, 2000, deps), 400, "Pick a card first.");

  const picked = game(SPLIT, { chosen: 0 });
  fails(actions.applyAction(picked, "p1", { type: "claim", code: "ZZ" }, 2000, deps), 400, "Unknown country.");
  fails(actions.applyAction(picked, "p1", { type: "claim", code: "A" }, 2000, deps), 409, "You already own that country.");
  fails(
    actions.applyAction(picked, "p1", { type: "claim", code: "E" }, 2000, deps),
    409,
    "That country belongs to another player. Try a steal."
  );

  const wrongCard = game(SPLIT, { chosen: 0, hand: [{ kind: "letter", letter: "Z" }] });
  fails(actions.applyAction(wrongCard, "p1", { type: "claim", code: "C" }, 2000, deps), 400, "That doesn't fit your card.");
});

test("a successful claim owns the country, logs it, and ends the turn", () => {
  const { deps, dealt } = fakeDeps();
  const s = game(SPLIT, { chosen: 0 });
  const after = ok(actions.applyAction(s, "p1", { type: "claim", code: "C" }, 2000, deps));

  assert.equal(after.owners.C, "p1");
  assert.deepEqual(after.log, [{ kind: "claim", playerId: "p1", code: "C", points: 1, round: 1, at: 2000 }]);
  assert.equal(after.seat, 1);
  assert.equal(after.turnStartedAt, 2000);
  assert.equal(after.chosen, null);

  // After the claim p1 has 3 and p2 has 2, so p2 is the underdog and gets three cards.
  assert.equal(dealt[dealt.length - 1].count, EMPIRE_RULES.underdogCards);
  assert.equal(after.hand.length, EMPIRE_RULES.underdogCards);
  assert.deepEqual([...dealt[dealt.length - 1].ctx.ownedByMe].sort(), ["E", "H"]);
  assert.deepEqual(dealt[dealt.length - 1].ctx.unclaimed, ["D", "F", "G"]);
});

test("gold rush doubles claim points", () => {
  const { deps } = fakeDeps();
  const s = game(SPLIT, { chosen: 0, event: { kind: "goldRush" } });
  const after = ok(actions.applyAction(s, "p1", { type: "claim", code: "C" }, 2000, deps));
  assert.equal(after.log[0].points, 2);
});

test("a closed continent blocks claims there but not elsewhere", () => {
  const { deps } = fakeDeps();
  const s = game(SPLIT, { chosen: 0, event: { kind: "closedContinent", continent: "Asia" } });
  fails(actions.applyAction(s, "p1", { type: "claim", code: "F" }, 2000, deps), 409, "That continent is closed this round.");
  const ok1 = ok(actions.applyAction(s, "p1", { type: "claim", code: "D" }, 2000, deps));
  assert.equal(ok1.owners.D, "p1");
});

test("steal requires a picked card and is blocked by a ceasefire", () => {
  const { deps } = fakeDeps();
  fails(
    actions.applyAction(game(STEAL_BOARD), "p1", { type: "steal", code: "E", capital: "city-E" }, 2000, deps),
    400,
    "Pick a card first."
  );
  const ceasefire = game(STEAL_BOARD, { chosen: 0, event: { kind: "ceasefire" } });
  fails(
    actions.applyAction(ceasefire, "p1", { type: "steal", code: "E", capital: "city-E" }, 2000, deps),
    409,
    "A ceasefire is on this round."
  );
});

test("steal target must be owned by another player", () => {
  const { deps } = fakeDeps();
  const picked = game(STEAL_BOARD, { chosen: 0 });
  fails(
    actions.applyAction(picked, "p1", { type: "steal", code: "D", capital: "city-D" }, 2000, deps),
    409,
    "You can only steal a country owned by another player."
  );
  const unclaimed = game({ A: "p1", B: "p1", C: "p1", D: "p1", E: "p2", G: "p2", H: "p2" }, { chosen: 0 });
  fails(
    actions.applyAction(unclaimed, "p1", { type: "steal", code: "F", capital: "city-F" }, 2000, deps),
    409,
    "You can only steal a country owned by another player."
  );
});

test("steal target must border one of your countries", () => {
  const { deps } = fakeDeps();
  // p2 holds H and its neighbour G; p1 only touches the north. H borders only G.
  const s = game({ A: "p1", B: "p1", E: "p2", F: "p2", G: "p2", H: "p2" }, { chosen: 0 });
  fails(
    actions.applyAction(s, "p1", { type: "steal", code: "H", capital: "city-H" }, 2000, deps),
    409,
    "You can only steal a country that borders one of yours."
  );
});

test("steal cannot punch down at a lower score", () => {
  const { deps } = fakeDeps();
  // p1 has 4 countries, p2 has 2. E borders D (p1's), so the border check passes.
  const s = game({ A: "p1", B: "p1", C: "p1", D: "p1", E: "p2", H: "p2" }, { chosen: 0 });
  fails(
    actions.applyAction(s, "p1", { type: "steal", code: "E", capital: "city-E" }, 2000, deps),
    409,
    "You can only steal from players at or above your score."
  );
});

test("protected countries (forts and capitals) cannot be stolen", () => {
  const { deps } = fakeDeps();
  const fort = game(STEAL_BOARD, { chosen: 0, forts: [[], ["E"]] });
  fails(actions.applyAction(fort, "p1", { type: "steal", code: "E", capital: "city-E" }, 2000, deps), 409, "That country is protected.");
  // H is p2's capital and borders G, which p1 owns. p2 (5) is not below p1 (3), so only protection applies.
  const capital = game({ A: "p1", B: "p1", G: "p1", C: "p2", D: "p2", E: "p2", F: "p2", H: "p2" }, { chosen: 0 });
  fails(actions.applyAction(capital, "p1", { type: "steal", code: "H", capital: "city-H" }, 2000, deps), 409, "That country is protected.");
});

test("steal needs a card that fits and a token unless steals are free", () => {
  const { deps } = fakeDeps();
  const misfit = game(STEAL_BOARD, { chosen: 0, hand: [{ kind: "letter", letter: "Z" }] });
  fails(actions.applyAction(misfit, "p1", { type: "steal", code: "E", capital: "city-E" }, 2000, deps), 400, "That doesn't fit your card.");

  const broke = game(STEAL_BOARD, { chosen: 0, tokens: [0, 2] });
  fails(actions.applyAction(broke, "p1", { type: "steal", code: "E", capital: "city-E" }, 2000, deps), 409, "You have no steal tokens left.");

  const free = game(STEAL_BOARD, { chosen: 0, tokens: [0, 2], event: { kind: "freeSteals" } });
  const after = ok(actions.applyAction(free, "p1", { type: "steal", code: "E", capital: "city-E" }, 2000, deps));
  assert.equal(after.owners.E, "p1");
  assert.equal(after.players[0].stealTokens, 0, "free steals spend no token");
});

test("a wrong capital passes the turn without spending a token or changing ownership", () => {
  const { deps } = fakeDeps();
  const s = game(STEAL_BOARD, { chosen: 0 });
  const after = ok(actions.applyAction(s, "p1", { type: "steal", code: "E", capital: "nowhere" }, 2000, deps));
  assert.equal(after.owners.E, "p2");
  assert.equal(after.players[0].stealTokens, 2);
  assert.deepEqual(after.log, [{ kind: "pass", playerId: "p1", code: "E", round: 1, at: 2000 }]);
  assert.equal(after.seat, 1);
  assert.equal(after.turnStartedAt, 2000);
});

test("a correct capital transfers the country, spends a token, and logs the previous owner", () => {
  const { deps } = fakeDeps();
  const s = game(STEAL_BOARD, { chosen: 0 });
  const after = ok(actions.applyAction(s, "p1", { type: "steal", code: "E", capital: "city-E" }, 2000, deps));
  assert.equal(after.owners.E, "p1");
  assert.equal(after.players[0].stealTokens, 1);
  assert.deepEqual(after.log, [{ kind: "steal", playerId: "p1", code: "E", from: "p2", round: 1, at: 2000 }]);
  assert.equal(after.seat, 1);
});

test("a correct steal under free steals keeps the token", () => {
  const { deps } = fakeDeps();
  const s = game(STEAL_BOARD, { chosen: 0, event: { kind: "freeSteals" } });
  const after = ok(actions.applyAction(s, "p1", { type: "steal", code: "E", capital: "city-E" }, 2000, deps));
  assert.equal(after.players[0].stealTokens, 2);
});

test("fortify needs ownership, rejects capitals and repeats, and respects the fort limit", () => {
  const { deps } = fakeDeps();
  fails(actions.applyAction(game(SPLIT), "p1", { type: "fortify", code: "E" }, 2000, deps), 409, "You can only fortify a country you own.");
  fails(actions.applyAction(game(SPLIT), "p1", { type: "fortify", code: "A" }, 2000, deps), 409, "Capitals can't be fortified.");
  fails(
    actions.applyAction(game(SPLIT, { forts: [["B"], []] }), "p1", { type: "fortify", code: "B" }, 2000, deps),
    409,
    "That country is already fortified."
  );
  fails(
    actions.applyAction(game({ ...SPLIT, C: "p1", D: "p1" }, { forts: [["B", "C"], []] }), "p1", { type: "fortify", code: "D" }, 2000, deps),
    409,
    "You have no forts left."
  );

  const after = ok(actions.applyAction(game(SPLIT), "p1", { type: "fortify", code: "B" }, 2000, deps));
  assert.deepEqual(after.players[0].forts, ["B"]);
  assert.deepEqual(after.log, [{ kind: "fortify", playerId: "p1", code: "B", round: 1, at: 2000 }]);
  assert.equal(after.seat, 1);
});

test("pass logs the turn and moves on without a picked card", () => {
  const { deps, dealt } = fakeDeps();
  const after = ok(actions.applyAction(game(SPLIT), "p1", { type: "pass" }, 2000, deps));
  assert.deepEqual(after.log, [{ kind: "pass", playerId: "p1", round: 1, at: 2000 }]);
  assert.equal(after.seat, 1);
  assert.equal(after.turnStartedAt, 2000);
  // Tied at 2 each, so p2 is not an underdog.
  assert.equal(dealt[dealt.length - 1].count, EMPIRE_RULES.cardsDealt);
});

test("rounds wrap after the last seat, and every third round reveals an event for the next", () => {
  const { deps, drawn, dealt } = fakeDeps({ events: [{ kind: "freeSteals" }] });
  let s = game(SPLIT);
  s = passAs(s, 2000, deps);
  assert.equal(s.round, 1);
  assert.equal(s.seat, 1);

  s = passAs(s, 3000, deps);
  assert.equal(s.round, 2);
  assert.equal(s.seat, 0);
  assert.equal(s.event, null);
  assert.equal(s.turnStartedAt, 3000);

  s = passAs(s, 4000, deps);
  s = passAs(s, 5000, deps);
  assert.equal(s.round, 3);
  assert.equal(s.event, null);
  assert.equal(drawn.length, 0);

  s = passAs(s, 6000, deps);
  s = passAs(s, 7000, deps);
  assert.equal(s.round, 4);
  assert.deepEqual(s.event, { kind: "freeSteals" });
  assert.deepEqual(drawn, [CONTINENTS]);
  assert.deepEqual(dealt[dealt.length - 1].ctx.event, { kind: "freeSteals" }, "the new hand sees the event");

  s = passAs(s, 8000, deps);
  s = passAs(s, 9000, deps);
  assert.equal(s.round, 5);
  assert.equal(s.event, null);
  assert.equal(drawn.length, 1);
});

test("the strictly lowest player is dealt three cards and others two", () => {
  const { deps, dealt } = fakeDeps();
  let s = game({ A: "p1", B: "p1", C: "p1", H: "p2" });
  s = passAs(s, 2000, deps);
  assert.equal(dealt[0].count, 3, "p2 is strictly last on 1 against 3");
  s = passAs(s, 3000, deps);
  assert.deepEqual(dealt.map((d) => d.count), [3, 2], "p1 is no longer last after round 1");
});

test("the strictly last player gets one late steal token after round 8, and only once", () => {
  const { deps } = fakeDeps();

  const lastGetsIt = passAs(game({ A: "p1", B: "p1", C: "p1", H: "p2" }, { round: 8, seat: 1 }), 2000, deps);
  assert.equal(lastGetsIt.round, 9);
  assert.deepEqual(lastGetsIt.players[1], { id: "p2", capital: "H", stealTokens: 3, forts: [], lateTokenGiven: true });
  assert.equal(lastGetsIt.players[0].stealTokens, 2);

  const tieGetsNothing = passAs(game({ A: "p1", H: "p2" }, { round: 8, seat: 1 }), 2000, deps);
  assert.equal(tieGetsNothing.players[1].stealTokens, 2);
  assert.equal(tieGetsNothing.players[1].lateTokenGiven, undefined);

  const otherRound = passAs(game({ A: "p1", B: "p1", C: "p1", H: "p2" }, { round: 7, seat: 1 }), 2000, deps);
  assert.equal(otherRound.players[1].stealTokens, 2);

  const alreadyGiven = passAs(
    game({ A: "p1", B: "p1", C: "p1", H: "p2" }, { round: 8, seat: 1, lateTokenGiven: "p1" }),
    2000,
    deps
  );
  assert.equal(alreadyGiven.players[1].stealTokens, 2, "the late token is given once per game");
  assert.equal(alreadyGiven.players[0].lateTokenGiven, true);
});

test("reaching the points target on your own turn ends the game for the winner", () => {
  const { deps } = fakeDeps({ bonus: { p1: 17 } });
  // p1 has 2 countries plus 17 bonus; claiming C makes 20.
  const s = game({ A: "p1", B: "p1", H: "p2" }, { chosen: 0 });
  const after = ok(actions.applyAction(s, "p1", { type: "claim", code: "C" }, 2000, deps));
  assert.equal(after.finished, true);
  assert.deepEqual(after.winnerIds, ["p1"]);
  fails(actions.applyAction(after, "p2", { type: "pass" }, 2100, deps), 409, "The game is over.");
});

test("another player reaching the target does not end the game on someone else's turn", () => {
  const { deps } = fakeDeps({ bonus: { p2: 20 } });
  const after = passAs(game({ A: "p1", B: "p1", H: "p2" }), 2000, deps);
  assert.equal(after.finished, false);
  assert.equal(after.seat, 1);
});

test("the game ends after round 15 and the highest total wins", () => {
  const { deps, drawn } = fakeDeps({ bonus: { p1: 5 } });
  const after = passAs(game(SPLIT, { round: 15, seat: 1 }), 2000, deps);
  assert.equal(after.finished, true);
  assert.deepEqual(after.winnerIds, ["p1"]);
  assert.equal(drawn.length, 0, "no event is drawn past the cap");
});

test("timeouts pass expired turns without a player action", () => {
  const { deps } = fakeDeps();
  const s = game(SPLIT);

  assert.equal(actions.advanceTimeouts(s, 1000 + EMPIRE_RULES.turnMs - 1, deps), s, "nothing expired returns the same object");

  const one = actions.advanceTimeouts(s, 1000 + EMPIRE_RULES.turnMs, deps);
  assert.deepEqual(one.log, [{ kind: "pass", playerId: "p1", round: 1, at: 21000 }]);
  assert.equal(one.seat, 1);
  assert.equal(one.turnStartedAt, 21000, "next turn starts exactly when the last expired");

  const several = actions.advanceTimeouts(s, 1000 + 3 * EMPIRE_RULES.turnMs + 5000, deps);
  assert.deepEqual(
    several.log.map((e) => [e.playerId, e.at, e.kind]),
    [
      ["p1", 21000, "pass"],
      ["p2", 41000, "pass"],
      ["p1", 61000, "pass"]
    ]
  );
  assert.equal(several.round, 2);
  assert.equal(several.seat, 1);
  assert.equal(several.turnStartedAt, 61000);
});

test("timeouts stop once the game is finished", () => {
  const { deps } = fakeDeps();
  const finished = game(SPLIT, { finished: true });
  assert.equal(actions.advanceTimeouts(finished, 10_000_000, deps), finished);
});

test("applyAction and advanceTimeouts never mutate their input", () => {
  const { deps } = fakeDeps({ bonus: { p1: 17 } });
  const cases: [string, EmpireState, (s: EmpireState) => unknown][] = [
    ["pick", game(SPLIT), (s) => actions.applyAction(s, "p1", { type: "pick", index: 1 }, 2000, deps)],
    ["claim", game(SPLIT, { chosen: 0 }), (s) => actions.applyAction(s, "p1", { type: "claim", code: "C" }, 2000, deps)],
    ["steal", game(STEAL_BOARD, { chosen: 0 }), (s) => actions.applyAction(s, "p1", { type: "steal", code: "E", capital: "city-E" }, 2000, deps)],
    ["fortify", game(SPLIT), (s) => actions.applyAction(s, "p1", { type: "fortify", code: "B" }, 2000, deps)],
    ["pass", game(SPLIT), (s) => actions.applyAction(s, "p1", { type: "pass" }, 2000, deps)],
    ["timeout", game(SPLIT), (s) => actions.advanceTimeouts(s, 100_000, deps)]
  ];
  for (const [name, state, run] of cases) {
    deepFreeze(state);
    const before = JSON.stringify(state);
    const result = run(state);
    assert.equal(JSON.stringify(state), before, `${name} left the input unchanged`);
    assert.notEqual(result, state, `${name} returned a new object`);
  }
});
