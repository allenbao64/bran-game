import assert from "node:assert/strict";
import { test } from "node:test";
import { geo } from "@/lib/empire/geo";
import { cards } from "@/lib/empire/cards";
import { scoring } from "@/lib/empire/scoring";
import { actions } from "@/lib/empire/actions";
import type { EmpireDeps, EmpireState } from "@/lib/empire/types";

/** Small seeded PRNG (mulberry32). */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const allCodes = geo.regionNames().flatMap((region) => geo.regionMembers(region));

/** One bot turn: pick a card, then (sometimes) steal with the right capital, else claim a random fitting free country, else pass. */
function botTurn(state: EmpireState, deps: EmpireDeps, rng: () => number, now: number): EmpireState {
  const me = state.players[state.seat].id;
  const run = (action: Parameters<typeof actions.applyAction>[2], from: EmpireState) => actions.applyAction(from, me, action, now, deps);
  const ok = (result: ReturnType<typeof run>): EmpireState | null => ("error" in result ? null : result);

  const picked = ok(run({ type: "pick", index: Math.floor(rng() * state.hand.length) }, state))!;
  const card = picked.hand[picked.chosen!];
  const mine = new Set(Object.keys(picked.owners).filter((code) => picked.owners[code] === me));
  const ctx = { ownedByMe: mine, neighbours: geo.neighbours };
  const closed = picked.event?.kind === "closedContinent" ? picked.event.continent : null;

  if (rng() < 0.3) {
    const targets = Object.keys(picked.owners).filter((code) => picked.owners[code] !== me && cards.cardFits(card, code, ctx));
    while (targets.length) {
      const code = targets.splice(Math.floor(rng() * targets.length), 1)[0];
      const stolen = ok(run({ type: "steal", code, capital: geo.capitalsOf(code)[0] }, picked));
      if (stolen) return stolen;
    }
  }
  const free = allCodes.filter((code) => picked.owners[code] === undefined && geo.continentOf(code) !== closed && cards.cardFits(card, code, ctx));
  if (free.length) {
    const claimed = ok(run({ type: "claim", code: free[Math.floor(rng() * free.length)] }, picked));
    if (claimed) return claimed;
  }
  return ok(run({ type: "pass" }, picked))!;
}

/** Plays one full game with seeded randomness; returns the winning seat indexes (ties share). */
export function playBotGame(playerCount: number, seed: number): number[] {
  const rng = seeded(seed);
  const deps: EmpireDeps = { geo, cards, scoring, rng };
  const ids = Array.from({ length: playerCount }, (_, i) => `p${i}`);
  let now = 1_000_000;
  let state = actions.initEmpire(ids, now, deps);
  const seatOf = new Map(state.players.map((p, i) => [p.id, i]));
  let guard = 0;
  while (!state.finished && guard++ < 1000) {
    now += 1000;
    state = botTurn(state, deps, rng, now);
  }
  assert.ok(state.finished, "game finishes");
  return state.winnerIds.map((id) => seatOf.get(id)!);
}

export function seatWinRates(playerCount: number, games: number): number[] {
  const wins = new Array<number>(playerCount).fill(0);
  for (let g = 0; g < games; g += 1) {
    const winners = playBotGame(playerCount, 1000 + g * 7919 + playerCount);
    for (const seat of winners) wins[seat] += 1 / winners.length;
  }
  return wins.map((w) => w / games);
}

const GAMES = 1500;

test(`fairness: 3-player win rate per seat is balanced over ${GAMES} seeded bot games`, () => {
  const rates = seatWinRates(3, GAMES);
  console.log("3-player seat win rates:", rates.map((r) => (r * 100).toFixed(1) + "%").join(" / "));
  rates.forEach((rate, seat) => assert.ok(rate >= 0.25 && rate <= 0.42, `seat ${seat + 1} won ${(rate * 100).toFixed(1)}%`));
});

test(`fairness: 2-player win rate per seat is balanced over ${GAMES} seeded bot games`, () => {
  const rates = seatWinRates(2, GAMES);
  console.log("2-player seat win rates:", rates.map((r) => (r * 100).toFixed(1) + "%").join(" / "));
  rates.forEach((rate, seat) => assert.ok(rate >= 0.4 && rate <= 0.6, `seat ${seat + 1} won ${(rate * 100).toFixed(1)}%`));
});
