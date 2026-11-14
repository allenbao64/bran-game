import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { NextRequest } from "next/server";
import type { Redis } from "@upstash/redis";
import { POST as roomPost, GET as roomGet } from "@/app/api/room/route";
import { POST as guessPost } from "@/app/api/guess/route";
import { setRedisForTests } from "@/lib/redis";
import { setTurnRngForTests, commitTurnRoom, loadTurnRoom, applyClaim, initialTurnState, normalizeTurnRoom, type TurnRoom } from "@/lib/turn-room";
import { allCodes, cardFits, fittingCodes, type Card } from "@/lib/turn-rules";
import { MemoryRedis } from "./memory-redis";

type Session = { code: string; token: string; playerId: string; mode?: string; status: string; players: { id: string; name: string }[] };
const json = async (response: Response) => response.json() as Promise<Record<string, any>>;
const realNow = Date.now;
let store: MemoryRedis;
let clock = 1_800_000_000_000;

beforeEach(() => {
  store = new MemoryRedis();
  setRedisForTests(store as unknown as Redis);
  clock = 1_800_000_000_000;
  Date.now = () => clock;
  let seed = 11;
  setTurnRngForTests(() => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; });
});
afterEach(() => { setRedisForTests(null); setTurnRngForTests(null); Date.now = realNow; });

const postRoom = (body: Record<string, unknown>) => roomPost(new NextRequest("http://localhost/api/room", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
}));
const getRoom = async (session: Session) => json(await roomGet(new NextRequest(`http://localhost/api/room?code=${session.code}`, {
  headers: { authorization: `Bearer ${session.token}` }
})));
const claim = (session: Session, code: string) => guessPost(new NextRequest("http://localhost/api/guess", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: session.code, token: session.token, answerCode: code })
}));
const pass = (session: Session) => postRoom({ action: "pass", code: session.code, token: session.token, name: "x" });

async function turnsGame(players = 2, mode: "turns" | "live" = "turns", extra: Record<string, unknown> = {}) {
  const host = await json(await postRoom({ action: "create", name: "Host", mode, ...extra })) as Session;
  const sessions = [host];
  for (const name of ["Brian", "Casey"].slice(0, players - 1)) sessions.push(await json(await postRoom({ action: "join", code: host.code, name })) as Session);
  const started = await postRoom({ action: "start", code: host.code, token: host.token, name: "Host" });
  assert.equal(started.status, 200);
  return sessions;
}
/** A turns room saved before the round count existed: it runs 12 rounds. */
async function legacyGame(players = 2) {
  const host = await json(await postRoom({ action: "create", name: "Host", mode: "turns" })) as Session;
  const sessions = [host];
  for (const name of ["Brian", "Casey"].slice(0, players - 1)) sessions.push(await json(await postRoom({ action: "join", code: host.code, name })) as Session);
  const key = `bran:room:${host.code}`;
  const saved = (await store.get<Record<string, unknown>>(key))!;
  delete saved.rounds;
  await store.set(key, saved);
  assert.equal((await postRoom({ action: "start", code: host.code, token: host.token, name: "Host" })).status, 200);
  return sessions;
}
const whoseTurn = (view: Record<string, any>, sessions: Session[]) => sessions.find((s) => s.playerId === view.turn.currentPlayerId)!;
/** The cards of the current turn, as the server describes them. */
const cardsOf = (view: Record<string, any>): Card[] => (view.turn.cards ?? []) as Card[];
const hasWild = (cards: Card[]) => cards.some((card) => card.kind === "wild");
/** A free country for the current deal: "any" fits at least one card, "one" exactly one, "both" every card of a pair. */
function pickFitOrUndefined(view: Record<string, any>, mode: "any" | "one" | "both"): string | undefined {
  const cards = cardsOf(view);
  const taken = new Set(Object.keys(view.countryClaims));
  return allCodes().find((code) => {
    if (taken.has(code)) return false;
    const fits = cards.filter((card) => cardFits(card, code)).length;
    if (mode === "one") return fits === 1;
    if (mode === "both") return cards.length >= 2 && fits === cards.length;
    return fits >= 1;
  });
}
function pickFitting(view: Record<string, any>, mode: "any" | "one" | "both" = "any"): string {
  const code = pickFitOrUndefined(view, mode);
  if (!code) throw new Error(`no free country fits this deal (${mode})`);
  return code;
}
const pickBoth = (view: Record<string, any>) => pickFitOrUndefined(view, "both");
/** A free country that fits no card of the current deal. */
const misfitOf = (view: Record<string, any>): string => allCodes().find((code) => cardsOf(view).every((card) => !cardFits(card, code)) && !(code in view.countryClaims))!;
/** Passes until the current deal is two cards with no wild (wild draws are rare, so this is quick). */
async function passUntilClean(sessions: Session[], view: Record<string, any>) {
  for (let i = 0; i < 60 && (cardsOf(view).length !== 2 || hasWild(cardsOf(view))); i++) {
    assert.equal((await pass(whoseTurn(view, sessions))).status, 200);
    view = await getRoom(sessions[0]);
  }
  return view;
}
/** Adds claims straight into the stored room (test setup for scores and boards). Each claim is worth 1 point. */
async function seedClaims(session: Session, claims: { code: string; playerId: string }[]) {
  const key = `bran:room:${session.code}`;
  const room = (await loadTurnRoom(store as unknown as Redis, key))!;
  room.claims = [...(room.claims ?? []), ...claims.map(({ code, playerId }) => ({ code, playerId, points: 1, round: 1, turn: 0, at: clock }))];
  assert.equal(await commitTurnRoom(store as unknown as Redis, key, room.turn!.number, room), true);
}
/** Passes `count` turns in a row, returning the fresh view. */
async function passTurns(sessions: Session[], count: number) {
  let view = await getRoom(sessions[0]);
  for (let turn = 0; turn < count; turn++) {
    assert.equal((await pass(whoseTurn(view, sessions))).status, 200, `pass ${turn}`);
    view = await getRoom(sessions[0]);
  }
  return view;
}
const lastClaim = (view: Record<string, any>) => view.claimLog.at(-1);

test("the host's mode is stored on create, shared with joiners and shown in snapshots", async () => {
  const turns = await json(await postRoom({ action: "create", name: "Host", mode: "turns" })) as Session;
  assert.equal(turns.mode, "turns");
  assert.equal(((await json(await postRoom({ action: "join", code: turns.code, name: "Brian" }))) as Session).mode, "turns");
  assert.equal((await getRoom(turns)).mode, "turns");
  assert.equal(((await store.get<Record<string, unknown>>(`bran:room:${turns.code}`))!).mode, "turns");

  assert.equal((await json(await postRoom({ action: "create", name: "Host" }))).mode, "live", "live is the default");
  assert.equal((await json(await postRoom({ action: "create", name: "Host", mode: "turns", gameId: "champions" }))).mode, "live", "other games ignore the mode");
  assert.equal((await postRoom({ action: "create", name: "Host", mode: "bogus" })).status, 400);
});

test("starting a turns room deals the first card to the first player", async () => {
  const [host, guest] = await turnsGame();
  const view = await getRoom(guest);
  assert.equal(view.status, "playing");
  assert.equal(view.mode, "turns");
  assert.equal(view.turn.currentPlayerId, host.playerId, "players act in join order");
  assert.equal(view.turn.round, 1);
  assert.equal(view.turn.totalRounds, 20, "20 rounds is the default");
  assert.equal(view.turn.doubleRound, false);
  assert.equal(view.turn.cards.length, 2, "every turn deals two cards");
  assert.ok(view.turn.cards.every((card: { label?: string }) => card.label));
  assert.deepEqual(view.turn.card, view.turn.cards[0], "the legacy card field is the first card");
  assert.equal(view.turn.cardLabel, `${view.turn.cards[0].label} or ${view.turn.cards[1].label}`, "the legacy label joins both cards");
  assert.equal(view.turn.turnMs, 15000);
  assert.equal(view.turn.startedAt, clock);
  assert.ok(!JSON.stringify(view).includes(host.token), "tokens never leak");
});

test("turn order is enforced and a wrong-turn request is rejected with 409", async () => {
  const [host, guest] = await turnsGame();
  let view = await getRoom(host);
  const early = await claim(guest, pickFitting(view));
  assert.equal(early.status, 409);
  assert.match((await json(early)).error, /not your turn.*Host/);
  const earlyPass = await pass(guest);
  assert.equal(earlyPass.status, 409);

  assert.equal((await claim(host, pickFitting(view))).status, 200);
  view = await getRoom(guest);
  assert.equal(view.turn.currentPlayerId, guest.playerId);
  assert.equal(view.turn.number, 1);
  assert.equal((await claim(host, pickFitting(view))).status, 409, "the host cannot go twice in a row");
  assert.equal(view.claimLog.length, 1, "starting countries are not in the claim log");
});

test("the dealt cards are enforced, and a wrong answer lets the player retry", async () => {
  const sessions = await turnsGame();
  const host = sessions[0];
  const view = await passUntilClean(sessions, await getRoom(host));
  const misfit = misfitOf(view);
  const current = whoseTurn(view, sessions);
  const bad = await claim(current, misfit);
  assert.equal(bad.status, 400);
  assert.match((await json(bad)).error, /doesn't fit either card/);
  const unchanged = await getRoom(host);
  assert.equal(unchanged.turn.number, view.turn.number, "a failed answer does not end the turn");
  assert.equal((await claim(current, pickFitting(view))).status, 200);
});

test("a country can only be claimed once and unknown answers are rejected", async () => {
  const [host, guest] = await turnsGame();
  const code = pickFitting(await getRoom(host));
  assert.equal((await claim(host, code)).status, 200);
  assert.equal((await claim(guest, "ZZ")).status, 400);
  const stolen = await claim(guest, code);
  assert.equal(stolen.status, 409, "a taken country is refused before the card is checked");
  assert.match((await json(stolen)).error, /already claimed/);
  assert.equal((await getRoom(guest)).countryClaims[code], host.playerId);
});

test("passing ends the turn and moves to the next player and round", async () => {
  const [host, guest] = await turnsGame();
  assert.equal((await pass(host)).status, 200);
  let view = await getRoom(guest);
  assert.equal(view.turn.currentPlayerId, guest.playerId);
  assert.equal(view.turn.round, 1);
  assert.equal((await pass(guest)).status, 200);
  view = await getRoom(host);
  assert.equal(view.turn.currentPlayerId, host.playerId);
  assert.equal(view.turn.round, 2);
  assert.equal(view.claimLog.length, 0);
});

test("running out the clock counts as a pass, even across several expired turns", async () => {
  const [host, guest, third] = await turnsGame(3);
  clock += 14_999;
  assert.equal((await getRoom(host)).turn.currentPlayerId, host.playerId, "15 seconds have not passed yet");
  clock += 1;
  assert.equal((await getRoom(host)).turn.currentPlayerId, guest.playerId);

  clock += 15_000 * 3 + 4_000;   // three more turns expire while nobody polls
  const view = await getRoom(third);
  assert.equal(view.turn.number, 4);
  assert.equal(view.turn.currentPlayerId, guest.playerId, "turn 4 of 3 players is the second player");
  assert.equal(view.turn.round, 2);
  assert.equal(view.turn.startedAt, 1_800_000_000_000 + 15_000 * 4, "the clock keeps its 15s cadence");
  assert.equal((await claim(host, pickFitting(view))).status, 409, "an expired turn cannot claim");
  assert.equal((await claim(guest, pickFitting(view))).status, 200);
});

test("a claim after the clock ran out is rejected for the player whose turn expired", async () => {
  const [host, guest] = await turnsGame();
  const view = await getRoom(host);
  clock += 15_000;
  const late = await claim(host, pickFitting(view));
  assert.equal(late.status, 409);
  assert.equal((await getRoom(guest)).turn.currentPlayerId, guest.playerId);
});

test("two simultaneous claims for one turn cannot both succeed", async () => {
  const [host, guest] = await turnsGame();
  const view = await getRoom(host);
  const fits = allCodes().filter((code) => !(code in view.countryClaims) && cardsOf(view).some((card) => cardFits(card, code)));
  const [a, b] = await Promise.all([claim(host, fits[0]), claim(host, fits[1])]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const after = await getRoom(guest);
  assert.equal(after.claimLog.length, 1);
  assert.equal(after.turn.number, 1);
  // A claim and a pass racing for the same turn: also exactly one wins.
  const [c, d] = await Promise.all([claim(guest, pickFitting(after)), pass(guest)]);
  assert.deepEqual([c.status, d.status].sort(), [200, 409]);
  assert.equal((await getRoom(guest)).turn.number, 2);
});

test("the compare-and-set write rejects a stale turn number", async () => {
  const [host] = await turnsGame();
  const key = `bran:room:${host.code}`;
  const room = (await loadTurnRoom(store as unknown as Redis, key))!;
  const stale = structuredClone(room);
  room.turn!.number = 1;
  assert.equal(await commitTurnRoom(store as unknown as Redis, key, 0, room), true);
  assert.equal(await commitTurnRoom(store as unknown as Redis, key, 0, stale), false, "turn 0 is no longer current");
  assert.equal((await loadTurnRoom(store as unknown as Redis, key))!.turn!.number, 1);
});

test("a full game lasts 12 rounds, doubles points in the last three and reports final scores", async () => {
  const sessions = await legacyGame(2);
  let view = await getRoom(sessions[0]);
  for (let turn = 0; turn < 24; turn++) {
    assert.equal(view.status, "playing", `still playing before turn ${turn}`);
    assert.equal(view.turn.round, Math.floor(turn / 2) + 1);
    assert.equal(view.turn.doubleRound, view.turn.round >= 10);
    const actor = whoseTurn(view, sessions);
    // Player 2 passes on their first turn so the two scores differ.
    if (turn === 1) assert.equal((await pass(actor)).status, 200);
    else assert.equal((await claim(actor, pickFitting(view))).status, 200, `turn ${turn} claim`);
    view = await getRoom(sessions[0]);
  }
  assert.equal(view.status, "ended");
  assert.equal(view.turn.finished, true);
  assert.equal(view.claimLog.length, 23);
  // A claim is worth 1 for one card, 3 for both, doubled in the last three rounds.
  assert.deepEqual(view.claimLog.map((c: any) => c.points), view.claimLog.map((c: any) => (c.fit === 2 ? 3 : 1) * (c.round >= 10 ? 2 : 1)));
  assert.equal(view.claimLog[0].order, 0);
  assert.ok(view.claimLog.every((c: any, i: number) => i === 0 || c.at >= view.claimLog[i - 1].at));

  const hostResult = view.results.find((r: any) => r.playerId === sessions[0].playerId);
  const guestResult = view.results.find((r: any) => r.playerId === sessions[1].playerId);
  const pointsOf = (playerId: string) => view.claimLog.filter((c: any) => c.playerId === playerId).reduce((sum: number, c: any) => sum + c.points, 0);
  assert.equal(hostResult.points, pointsOf(sessions[0].playerId), "host: the sum of their claim points");
  assert.equal(guestResult.points, pointsOf(sessions[1].playerId), "guest: the sum of their claim points");
  assert.equal(view.claimLog.filter((c: any) => c.playerId === sessions[1].playerId).length, 11, "one pass in round 1");
  for (const r of view.results) {
    assert.equal(r.total, r.points + r.bonusTotal);
    assert.equal(r.guesses.length, view.claimLog.filter((c: any) => c.playerId === r.playerId).length);
  }
  assert.ok(view.results[0].total >= view.results[1].total, "results are ranked by final score");
  assert.ok(view.awards.some((a: any) => a.id === "first" && a.playerId === sessions[0].playerId));
  assert.equal((await claim(sessions[0], "FR")).status, 409, "no claims once the game is over");
  assert.equal((await pass(sessions[0])).status, 409);
});

test("timeouts alone end the game after 12 rounds, but a tie for first goes to sudden death first", async () => {
  const sessions = await legacyGame(2);
  clock += 15_000 * 24;
  let view = await getRoom(sessions[1]);
  assert.equal(view.status, "playing", "a 0-0 tie after the last normal turn starts sudden death");
  assert.deepEqual(view.turn.sudden.playerIds, sessions.map((s) => s.playerId));
  assert.equal(view.turn.round, 12);
  assert.equal(view.turn.doubleRound, false);
  clock += 15_000 * 6 - 1;
  assert.equal((await getRoom(sessions[1])).status, "playing", "three sudden-death rounds of two turns are not over yet");
  clock += 1;
  view = await getRoom(sessions[1]);
  assert.equal(view.status, "ended");
  assert.equal(view.results.length, 2);
  assert.deepEqual(view.results.map((r: any) => r.total), [0, 0]);
  assert.deepEqual(view.awards, []);
  assert.deepEqual([...view.winners].sort(), sessions.map((s) => s.playerId).sort(), "still tied after three rounds: they share the win");
});

test("live rooms are untouched: no turn state, any player can claim, pass is refused", async () => {
  const [host, guest] = await turnsGame(2, "live");
  const view = await getRoom(guest);
  assert.equal(view.mode, "live");
  assert.equal("turn" in view, false);
  assert.equal((await claim(guest, "CA")).status, 200, "live players claim whenever they like");
  assert.equal((await claim(host, "US")).status, 200);
  assert.equal((await pass(host)).status, 409);
  assert.equal((await getRoom(host)).status, "playing");
});

test("naming a taken country says it is taken even when it also fails the card", () => {
  const room: TurnRoom = {
    code: "ABC234", status: "playing", startedAt: 0, mode: "turns",
    players: [{ id: "p1", token: "t1", name: "Host", host: true }, { id: "p2", token: "t2", name: "Brian", host: false }],
    turn: { ...initialTurnState(["p1", "p2"], 0), deal: [{ kind: "continent", region: "Oceania" }] },
    claims: [{ code: "FR", playerId: "p2", points: 1, round: 1, turn: 0, at: 0 }]
  };
  const stolen = applyClaim(room, "p1", "FR", 1);
  assert.equal(stolen?.status, 409);
  assert.match(stolen!.error, /France is already claimed/);
  room.claims!.push({ code: "DE", playerId: "p1", points: 1, round: 1, turn: 0, at: 0 });
  assert.match(applyClaim(room, "p1", "DE", 1)!.error, /You already claimed that country/);
  const misfit = applyClaim(room, "p1", "ES", 1);
  assert.equal(misfit?.status, 400);
  assert.match(misfit!.error, /doesn't fit this card/);
});

test("the host's turn speed is validated, stored, shared with joiners and shown in every snapshot", async () => {
  const blitz = await json(await postRoom({ action: "create", name: "Host", mode: "turns", turnSeconds: 10 })) as Session & { turnSeconds: number };
  assert.equal(blitz.turnSeconds, 10);
  assert.equal(((await store.get<Record<string, unknown>>(`bran:room:${blitz.code}`))!).turnSeconds, 10);
  assert.equal((await json(await postRoom({ action: "join", code: blitz.code, name: "Brian" }))).turnSeconds, 10);
  assert.equal((await getRoom(blitz)).turnSeconds, 10, "the waiting-room snapshot carries the speed");
  const started = await json(await postRoom({ action: "start", code: blitz.code, token: blitz.token, name: "Host" }));
  assert.equal(started.turnSeconds, 10);
  const view = await getRoom(blitz);
  assert.equal(view.turnSeconds, 10);
  assert.equal(view.turn.turnMs, 10_000);

  assert.equal((await json(await postRoom({ action: "create", name: "Host", mode: "turns" }))).turnSeconds, 15, "standard is the default");
  for (const bad of [20, 0, -5, "15", 15.5, null, true]) {
    assert.equal((await postRoom({ action: "create", name: "Host", mode: "turns", turnSeconds: bad })).status, 400, `rejects ${JSON.stringify(bad)}`);
  }
  // Live rooms and other games ignore a valid speed.
  const live = await json(await postRoom({ action: "create", name: "Host", mode: "live", turnSeconds: 25 }));
  assert.equal("turnSeconds" in live, false);
  assert.equal(((await store.get<Record<string, unknown>>(`bran:room:${live.code}`))!).turnSeconds, undefined);
  const other = await json(await postRoom({ action: "create", name: "Host", mode: "turns", gameId: "champions", turnSeconds: 25 }));
  assert.equal("turnSeconds" in other, false);
});

test("timeouts follow the chosen speed: Blitz 10s and Relaxed 25s", async () => {
  const blitz = await turnsGame(2, "turns", { turnSeconds: 10, rounds: 15 });
  clock += 9_999;
  assert.equal((await getRoom(blitz[0])).turn.currentPlayerId, blitz[0].playerId, "10 seconds have not passed yet");
  clock += 1;
  const view = await getRoom(blitz[0]);
  assert.equal(view.turn.currentPlayerId, blitz[1].playerId);
  assert.equal(view.turn.startedAt, 1_800_000_000_000 + 10_000);
  clock += 10_000 * 29 - 1;
  assert.equal((await getRoom(blitz[0])).status, "playing");
  clock += 1;
  const tied = await getRoom(blitz[0]);
  assert.equal(tied.status, "playing", "30 turns of 10s end the normal rounds in a tie, so sudden death starts");
  assert.equal(tied.turn.sudden.playerIds.length, 2);
  clock += 10_000 * 6 - 1;
  assert.equal((await getRoom(blitz[0])).status, "playing");
  clock += 1;
  assert.equal((await getRoom(blitz[0])).status, "ended", "six sudden-death turns of 10s end the game");

  clock = 1_800_000_000_000;
  const relaxed = await turnsGame(2, "turns", { turnSeconds: 25 });
  clock += 24_999;
  assert.equal((await getRoom(relaxed[0])).turn.number, 0);
  clock += 1;
  assert.equal((await getRoom(relaxed[0])).turn.number, 1);
  assert.equal((await getRoom(relaxed[0])).turn.turnMs, 25_000);
});

test("the snapshot outlines each player's largest connected group", async () => {
  const [host, guest] = await turnsGame();
  const key = `bran:room:${host.code}`;
  const room = (await loadTurnRoom(store as unknown as Redis, key))!;
  const claimOf = (code: string, playerId: string) => ({ code, playerId, points: 1, round: 1, turn: 0, at: clock });
  room.claims = [claimOf("FR", host.playerId), claimOf("DE", host.playerId), claimOf("BE", host.playerId), claimOf("JP", host.playerId), claimOf("ES", guest.playerId)];
  assert.equal(await commitTurnRoom(store as unknown as Redis, key, 0, room), true);
  const view = await getRoom(guest);
  assert.deepEqual(view.largestGroups[host.playerId], ["BE", "DE", "FR"]);
  assert.deepEqual(view.largestGroups[guest.playerId], ["ES"]);
});

test("the host's round count is validated, stored, shared and used to end the game", async () => {
  const short = await json(await postRoom({ action: "create", name: "Host", mode: "turns", rounds: 15 })) as Session & { rounds: number };
  assert.equal(short.rounds, 15);
  assert.equal(((await store.get<Record<string, unknown>>(`bran:room:${short.code}`))!).rounds, 15);
  assert.equal((await json(await postRoom({ action: "join", code: short.code, name: "Brian" }))).rounds, 15);
  assert.equal((await getRoom(short)).rounds, 15, "the waiting-room snapshot carries the rounds");
  const started = await json(await postRoom({ action: "start", code: short.code, token: short.token, name: "Host" }));
  assert.equal(started.rounds, 15);
  assert.equal((await getRoom(short)).turn.totalRounds, 15);

  assert.equal((await json(await postRoom({ action: "create", name: "Host", mode: "turns" }))).rounds, 20, "20 is the default");
  for (const bad of [12, 0, 25, "20", 20.5, null, true]) {
    assert.equal((await postRoom({ action: "create", name: "Host", mode: "turns", rounds: bad })).status, 400, `rejects ${JSON.stringify(bad)}`);
  }
  const live = await json(await postRoom({ action: "create", name: "Host", mode: "live", rounds: 30 }));
  assert.equal("rounds" in live, false, "live rooms ignore rounds");

  // 15 rounds x 2 players x 15 s: round 13 is the first double round. Nobody claims, so the last turn is a tie.
  clock += 15_000 * 24;
  const late = await getRoom(short);
  assert.equal(late.turn.round, 13);
  assert.equal(late.turn.doubleRound, true, "round 13 of 15 is the first double round");
  clock += 15_000 * 6;
  const tied = await getRoom(short);
  assert.equal(tied.status, "playing", "a 0-0 tie after the last turn plays sudden death");
  assert.equal(tied.turn.sudden.round, 1);
  clock += 15_000 * 6;
  assert.equal((await getRoom(short)).status, "ended");
});

test("a 30-round game runs 60 turns for two players, then a tie plays sudden death", async () => {
  const [host] = await turnsGame(2, "turns", { rounds: 30 });
  clock += 15_000 * 59;
  let view = await getRoom(host);
  assert.equal(view.status, "playing");
  assert.equal(view.turn.round, 30);
  assert.equal(view.turn.totalRounds, 30);
  clock += 15_000;
  view = await getRoom(host);
  assert.equal(view.status, "playing", "nobody scored, so the tie is played out in sudden death");
  assert.equal(view.turn.sudden.playerIds.length, 2);
  clock += 15_000 * 6;
  assert.equal((await getRoom(host)).status, "ended");
});

test("rooms saved without a round count still start with 12 rounds", async () => {
  const host = await json(await postRoom({ action: "create", name: "Host", mode: "turns" })) as Session;
  await postRoom({ action: "join", code: host.code, name: "Brian" });
  const key = `bran:room:${host.code}`;
  const saved = (await store.get<Record<string, unknown>>(key))!;
  delete saved.rounds;
  await store.set(key, saved);
  assert.equal((await getRoom(host)).rounds, 12, "waiting snapshot defaults to 12");
  await postRoom({ action: "start", code: host.code, token: host.token, name: "Host" });
  assert.equal((await getRoom(host)).turn.totalRounds, 12);
});

test("each player starts with their own country, which scores nothing and cannot be claimed", async () => {
  const [host, guest, third] = await turnsGame(3);
  const view = await getRoom(host);
  const starts = view.startCountries as Record<string, string>;
  assert.deepEqual(Object.keys(starts).sort(), [host.playerId, guest.playerId, third.playerId].sort());
  assert.equal(new Set(Object.values(starts)).size, 3);
  for (const [playerId, code] of Object.entries(starts)) assert.equal(view.countryClaims[code], playerId, "the start is on the map in its owner's name");
  assert.equal(view.claimLog.length, 0, "starts are not in the claim log");
  assert.deepEqual(view.myGuesses, []);
  for (const id of [host.playerId, guest.playerId, third.playerId]) assert.equal(view.scores[id].points, 0);
  assert.ok(!cardFits({ kind: "wild" }, "ZZ"));
  const taken = Object.values(starts)[1];
  const stolen = await claim(host, taken);
  assert.equal(stolen.status, 409, "a starting country is taken, whatever the cards");
  assert.match((await json(stolen)).error, /already claimed/);
});

test("legacy turns rooms have no starts and no guess log", async () => {
  const [host] = await legacyGame();
  const key = `bran:room:${host.code}`;
  const saved = (await store.get<Record<string, any>>(key))!;
  delete saved.startCountries; delete saved.recentGuesses; delete saved.recentCards;
  saved.claims = [];
  await store.set(key, saved);
  let view = await getRoom(host);
  assert.deepEqual(view.startCountries, {});
  assert.deepEqual(view.recentGuesses, []);
  assert.equal((await pass(host)).status, 200, "dealing still works without a card history");
  view = await getRoom(host);
  assert.equal(view.recentGuesses.length, 1);
  assert.deepEqual(view.recentGuesses[0], { playerId: host.playerId, kind: "passed", code: null, text: "passed", points: 0, at: clock });
});

test("the guess log records claims, wrong guesses, passes and timeouts, newest first, up to 12", async () => {
  const [host, guest] = await turnsGame();
  const sessions = [host, guest];
  const initial = await getRoom(host);
  assert.deepEqual(initial.recentGuesses, []);
  const view = await passUntilClean(sessions, initial);
  const log = () => getRoom(host).then((room) => room.recentGuesses as Record<string, any>[]);
  const before = (await log()).length;
  const player = whoseTurn(view, sessions);
  const misfit = misfitOf(view);
  assert.equal((await claim(player, misfit)).status, 400);
  assert.equal((await claim(player, "ZZ")).status, 400, "not a country: not logged");
  let entries = await log();
  assert.equal(entries.length, before + 1, "a wrong guess is logged even though it is rejected");
  assert.deepEqual(entries[0], { playerId: player.playerId, kind: "wrong", code: misfit, text: "doesn't fit", points: 0, at: clock });
  assert.equal((await getRoom(host)).turn.number, view.turn.number, "the turn did not advance");

  const good = pickFitting(view, "one");
  clock += 1000;
  assert.equal((await claim(player, good)).status, 200);
  entries = await log();
  assert.equal(entries[0].kind, "claimed");
  assert.equal(entries[0].code, good);
  assert.equal(entries[0].points, 1);
  assert.equal("both" in entries[0], false, "a one-card claim is not marked both");
  assert.match(entries[0].text, /\w/);
  assert.equal(entries[1].kind, "wrong");

  // Naming a country another player owns says whose it is.
  const next = await getRoom(host);
  const other = whoseTurn(next, sessions);
  const ownerName = player.playerId === host.playerId ? "Host" : "Brian";
  assert.equal((await claim(other, good)).status, 409);
  assert.equal((await log())[0].text, `already ${ownerName}'s`);

  clock += 1000;
  assert.equal((await pass(other)).status, 200);
  assert.deepEqual((await log())[0], { playerId: other.playerId, kind: "passed", code: null, text: "passed", points: 0, at: clock });

  // Three expired turns are logged against the players whose turns they were, oldest first in time.
  const now = await getRoom(host);
  const first = now.turn.currentPlayerId;
  const start = now.turn.startedAt;
  clock = start + 15_000 * 3 + 100;
  entries = await log();
  assert.deepEqual(entries.slice(0, 3).map((entry) => [entry.kind, entry.text, entry.code, entry.points]), Array(3).fill(["timeout", "ran out of time", null, 0]));
  assert.equal(entries[2].playerId, first);
  assert.equal(entries[2].at, start + 15_000);
  assert.equal(entries[0].at, start + 15_000 * 3);

  // The log keeps only the newest 12.
  for (let i = 0; i < 10; i++) { const room = await getRoom(host); await pass(whoseTurn(room, sessions)); }
  entries = await log();
  assert.equal(entries.length, 12);
  assert.ok(entries.every((entry, i) => i === 0 || entry.at <= entries[i - 1].at), "newest first");
});

test("variety: no card of a deal shares a kind with the previous deal, and the two cards differ", async () => {
  const sessions = await turnsGame();
  let view = await getRoom(sessions[0]);
  let previous = cardsOf(view);
  for (let i = 0; i < 25; i++) {
    assert.equal((await pass(whoseTurn(view, sessions))).status, 200);
    view = await getRoom(sessions[0]);
    const cards = cardsOf(view);
    if (cards.length === 2) assert.notEqual(cards[0].kind, cards[1].kind, `turn ${i}: ${view.turn.cards.map((c: { label: string }) => c.label).join(" / ")}`);
    if (!hasWild(previous) && !hasWild(cards)) {
      const kinds = new Set(previous.map((card) => card.kind));
      for (const card of cards) assert.ok(!kinds.has(card.kind), `turn ${i}: ${card.kind} repeats the previous deal`);
    }
    previous = cards;
  }
});

test("every turn deals two cards and the view says what they are worth", async () => {
  const sessions = await turnsGame();
  const view = await getRoom(sessions[0]);
  assert.equal(view.turn.pointsOne, 1);
  assert.equal(view.turn.pointsBoth, 3);
  assert.ok(view.turn.cards.every((card: { kind: string; label: string }) => typeof card.kind === "string" && card.label.length > 0));
  const next = await passUntilClean(sessions, view);
  assert.equal(next.turn.cards.length, 2);
  assert.equal(next.turn.pointsOne, 1);
});

test("fitting both cards scores 3, fitting one scores 1, fitting neither is rejected", async () => {
  const sessions = await turnsGame();
  let view = await passUntilClean(sessions, await getRoom(sessions[0]));
  const both = pickBoth(view);
  assert.ok(both, "a clean pair has a free country that fits both cards");
  assert.equal((await claim(whoseTurn(view, sessions), both)).status, 200);
  let entry = lastClaim(await getRoom(sessions[0]));
  assert.equal(entry.points, 3);
  assert.equal(entry.fit, 2);

  view = await passUntilClean(sessions, await getRoom(sessions[0]));
  assert.equal((await claim(whoseTurn(view, sessions), pickFitting(view, "one"))).status, 200);
  entry = lastClaim(await getRoom(sessions[0]));
  assert.equal(entry.points, 1);
  assert.equal(entry.fit, 1);

  view = await passUntilClean(sessions, await getRoom(sessions[0]));
  const before = view.turn.number;
  const bad = await claim(whoseTurn(view, sessions), misfitOf(view));
  assert.equal(bad.status, 400);
  assert.match((await json(bad)).error, /doesn't fit either card/);
  const after = await getRoom(sessions[0]);
  assert.equal(after.turn.number, before, "the turn did not advance");
  assert.equal(after.recentGuesses[0].kind, "wrong");
});

test("a claim that fits only the second card is accepted", async () => {
  const sessions = await turnsGame();
  const view = await passUntilClean(sessions, await getRoom(sessions[0]));
  const [first, second] = cardsOf(view) as Card[];
  const taken = new Set(Object.keys(view.countryClaims));
  const code = allCodes().find((c) => !taken.has(c) && cardFits(second, c) && !cardFits(first, c));
  assert.ok(code, "a free country fits only the second card");
  assert.equal((await claim(whoseTurn(view, sessions), code!)).status, 200);
  const entry = lastClaim(await getRoom(sessions[0]));
  assert.equal(entry.fit, 1);
  assert.equal(entry.points, 1);
});

test("the last three rounds double both scores: 6 for both, 2 for one", async () => {
  const sessions = await legacyGame(2);
  const view = await passTurns(sessions, 18);
  assert.equal(view.turn.round, 10);
  assert.equal(view.turn.doubleRound, true);
  assert.equal(view.turn.pointsOne, 2);
  assert.equal(view.turn.pointsBoth, 6);
  const clean = await passUntilClean(sessions, view);
  assert.equal((await claim(whoseTurn(clean, sessions), pickFitting(clean, "both"))).status, 200);
  let entry = lastClaim(await getRoom(sessions[0]));
  assert.equal(entry.points, 6);
  assert.equal(entry.fit, 2);
  const next = await passUntilClean(sessions, await getRoom(sessions[0]));
  assert.equal((await claim(whoseTurn(next, sessions), pickFitting(next, "one"))).status, 200);
  entry = lastClaim(await getRoom(sessions[0]));
  assert.equal(entry.points, 2);
  assert.equal(entry.fit, 1);
});

test("claim response reports points, fit and both", async () => {
  const sessions = await turnsGame();
  const view = await passUntilClean(sessions, await getRoom(sessions[0]));
  const both = pickBoth(view)!;
  const response = await claim(whoseTurn(view, sessions), both);
  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), { ok: true, claim: { code: both, points: 3, fit: 2, cards: 2, both: true, sudden: false } });
  const next = await getRoom(sessions[0]);
  const one = pickFitting(next, "one");
  assert.deepEqual(await json(await claim(whoseTurn(next, sessions), one)), { ok: true, claim: { code: one, points: 1, fit: 1, cards: 2, both: false, sudden: false } });
});

test("a tie after the last normal turn starts sudden death for the tied players only", async () => {
  const sessions = await turnsGame(3, "turns", { rounds: 15 });
  const [host, guest, third] = sessions;
  await seedClaims(host, [{ code: "FR", playerId: host.playerId }, { code: "ES", playerId: guest.playerId }]);
  const view = await passTurns(sessions, 45);
  assert.equal(view.status, "playing");
  assert.deepEqual(view.turn.sudden, { round: 1, maxRounds: 3, playerIds: [host.playerId, guest.playerId] });
  assert.equal(view.turn.currentPlayerId, host.playerId);
  assert.equal(view.turn.doubleRound, false);
  assert.equal(view.turn.round, 15);
  const denied = await claim(third, pickFitting(view));
  assert.equal(denied.status, 409);
  assert.equal((await json(denied)).error, "Sudden death: only Host and Brian play.");
});

test("sudden-death turns score normally, never doubled, and end the game when one player leads after a full round", async () => {
  const sessions = await turnsGame(2, "turns", { rounds: 15 });
  const [host, guest] = sessions;
  await seedClaims(host, [{ code: "FR", playerId: host.playerId }, { code: "ES", playerId: guest.playerId }]);
  let view = await passTurns(sessions, 30);
  assert.equal(view.turn.sudden.round, 1);
  assert.equal((await claim(host, pickBoth(view) ?? pickFitting(view))).status, 200);
  assert.equal((await pass(guest)).status, 200);
  view = await getRoom(host);
  assert.equal(view.status, "ended");
  assert.deepEqual(view.winners, [host.playerId]);
  const entry = lastClaim(view);
  assert.equal(entry.sudden, true);
  assert.equal(entry.round, 16, "totalRounds + 1");
  assert.equal(entry.points, entry.fit === 2 ? 3 : 1, "never doubled");
  assert.equal(view.scores[host.playerId].points, 1 + entry.points);
  assert.equal(view.turn.doubleRound, false);
  assert.equal(view.turn.round, 15);
});

test("still tied after a full round plays another round with the leaders only, up to 3 rounds, then they share the win", async () => {
  const sessions = await turnsGame(2, "turns", { rounds: 15 });
  const rounds: number[] = [];
  let view = await getRoom(sessions[0]);
  for (let turn = 0; turn < 36; turn++) {
    assert.equal((await pass(whoseTurn(view, sessions))).status, 200, `turn ${turn}`);
    view = await getRoom(sessions[0]);
    if (view.turn.sudden && rounds.at(-1) !== view.turn.sudden.round) rounds.push(view.turn.sudden.round);
  }
  assert.deepEqual(rounds, [1, 2, 3]);
  assert.equal(view.status, "ended");
  assert.equal(view.turn.number, 36, "30 normal turns and 3 sudden rounds of 2");
  assert.deepEqual([...view.winners].sort(), sessions.map((s) => s.playerId).sort(), "they share the win");
});

test("contenders shrink: after a sudden round only the players still tied for first play the next", async () => {
  const sessions = await turnsGame(3, "turns", { rounds: 15 });
  const [host, guest, third] = sessions;
  let view = await passTurns(sessions, 45);
  assert.equal(view.turn.sudden.playerIds.length, 3, "a three-way 0-0 tie plays round 1 with everyone");
  // Round 1: host and Brian each claim one country (1 point each); Casey passes.
  assert.equal((await claim(host, pickFitting(view, "one"))).status, 200);
  view = await getRoom(host);
  assert.equal((await claim(guest, pickFitting(view, "one"))).status, 200);
  view = await getRoom(host);
  assert.equal((await pass(third)).status, 200);
  view = await getRoom(host);
  assert.equal(view.status, "playing");
  assert.equal(view.turn.sudden.round, 2);
  assert.deepEqual(view.turn.sudden.playerIds, [host.playerId, guest.playerId]);
  assert.equal(view.turn.currentPlayerId, host.playerId);
  assert.equal((await claim(third, pickFitting(view))).status, 409, "Casey has dropped out");
});

test("all sudden-death players time out: one jump ends the game, and only contenders are logged", async () => {
  const sessions = await turnsGame(3, "turns", { rounds: 15 });
  const [host, guest, third] = sessions;
  await seedClaims(host, [{ code: "FR", playerId: host.playerId }, { code: "ES", playerId: guest.playerId }]);
  // 45 normal turns, then 2 contenders x 3 sudden-death rounds = 51 turns, all timed out in one lazy catch-up.
  clock += 15_000 * 51;
  const view = await getRoom(third);
  assert.equal(view.status, "ended");
  assert.deepEqual([...view.winners].sort(), [host.playerId, guest.playerId].sort());
  const newest = view.recentGuesses.slice(0, 6);
  assert.ok(newest.every((entry: { kind: string }) => entry.kind === "timeout"));
  assert.ok(newest.every((entry: { playerId: string }) => entry.playerId === host.playerId || entry.playerId === guest.playerId), "sudden-death turns are contenders only");
});

test("board exhausted during sudden death ends the game at once", async () => {
  const sessions = await turnsGame(2, "turns", { rounds: 15 });
  const [host, guest] = sessions;
  let view = await passTurns(sessions, 30);
  assert.equal(view.turn.sudden.round, 1);
  // Everything but one country is claimed; the free one fits the current deal.
  const free = pickFitting(view);
  const others = allCodes().filter((code) => code !== free && !(code in view.countryClaims));
  await seedClaims(host, others.map((code, i) => ({ code, playerId: i % 2 ? guest.playerId : host.playerId })));
  view = await getRoom(host);
  assert.equal(Object.keys(view.countryClaims).length, allCodes().length - 1);
  assert.equal((await claim(host, free)).status, 200);
  view = await getRoom(host);
  assert.equal(view.status, "ended", "the last country ends the game even mid-round");
  assert.ok(view.turn.sudden, "the sudden phase stays on the turn");
  assert.ok(view.winners.length >= 1);
  assert.equal(view.turn.currentPlayerId, null);
});

test("a host can end the game during sudden death", async () => {
  const sessions = await turnsGame(2, "turns", { rounds: 15 });
  const [host, guest] = sessions;
  await passTurns(sessions, 30);
  const ended = await postRoom({ action: "end", code: host.code, token: host.token, name: "Host" });
  assert.equal(ended.status, 200);
  const view = await getRoom(guest);
  assert.equal(view.status, "ended");
  assert.equal(view.turn.sudden.round, 1, "the tie-break stays on the results");
  assert.equal(view.winners.length, 2, "0-0: tied, nobody wins outright");
  assert.equal((await claim(guest, "FR")).status, 409);
});

test("rooms damaged by Lua's empty-array encoding still load", async () => {
  const [host, guest] = await turnsGame();
  const key = `bran:room:${host.code}`;
  const saved = (await store.get<Record<string, any>>(key))!;
  saved.claims = {};
  saved.recentGuesses = {};
  saved.recentCards = {};
  saved.startCountries = [];
  await store.set(key, saved);
  const loaded = (await loadTurnRoom(store as unknown as Redis, key))!;
  assert.deepEqual(loaded.claims, []);
  assert.deepEqual(loaded.recentGuesses, []);
  assert.deepEqual(loaded.recentCards, []);
  assert.deepEqual(loaded.startCountries, {});
  assert.equal(loaded.turn!.deal!.length, 2);
  const view = await getRoom(guest);
  assert.equal(view.status, "playing");
  assert.deepEqual(view.claimLog, []);

  // A finished room whose deal came back as {} has no cards and a null deal.
  saved.status = "ended";
  saved.turn.finished = true;
  saved.turn.deal = {};
  await store.set(key, saved);
  const done = (await loadTurnRoom(store as unknown as Redis, key))!;
  assert.equal(done.turn!.deal, null);
  assert.ok(Array.isArray(done.turn!.order));
  const doneView = await getRoom(guest);
  assert.equal(doneView.status, "ended");
  assert.deepEqual(doneView.turn.cards, []);
});

test("normalizeTurnRoom turns legacy and Lua-damaged shapes into arrays and a null deal", () => {
  const base = { code: "ABC234", status: "playing", startedAt: 0, players: [] } as unknown as TurnRoom;
  const damaged = normalizeTurnRoom({
    ...base, claims: {} as never,
    turn: { number: 3, order: {} as never, deal: {} as never, startedAt: 0, turnMs: 15000, totalRounds: 15, finished: false, sudden: { order: {} as never, startNumber: 3, round: 1, maxRounds: 3 } }
  } as TurnRoom);
  assert.deepEqual(damaged.claims, []);
  assert.equal(damaged.turn!.deal, null);
  assert.deepEqual(damaged.turn!.order, []);
  assert.deepEqual(damaged.turn!.sudden!.order, []);
  const legacy = normalizeTurnRoom({ ...base, turn: { number: 0, order: ["a"], card: { kind: "landlocked" }, startedAt: 0, turnMs: 15000, totalRounds: 1, finished: false } } as unknown as TurnRoom);
  assert.deepEqual(legacy.turn!.deal, [{ kind: "landlocked" }]);
  assert.equal("card" in legacy.turn!, false);
  assert.deepEqual(normalizeTurnRoom(structuredClone(legacy)).turn!.deal, [{ kind: "landlocked" }], "idempotent");
});

test("a host-ended game keeps turn.finished false while a played-out game sets it", async () => {
  const sessions = await turnsGame(2);
  const [host] = sessions;
  let view = await getRoom(host);
  assert.equal((await claim(whoseTurn(view, sessions), pickFitting(view))).status, 200);
  const ended = await postRoom({ action: "end", code: host.code, token: host.token, name: "Host" });
  assert.equal(ended.status, 200);
  view = await getRoom(host);
  assert.equal(view.status, "ended");
  assert.equal(view.turn.finished, false, "the host ended it early, so the turn was not finished");
  assert.ok(Array.isArray(view.winners), "winners are present once the game has ended");

  const playedSessions = await legacyGame(2);
  clock += 15_000 * 24 + 15_000 * 6;
  view = await getRoom(playedSessions[1]);
  assert.equal(view.status, "ended");
  assert.equal(view.turn.finished, true, "a game played out to its end sets turn.finished");
});

test("snapshot keeps the legacy single card fields for tabs on the old client", async () => {
  const [host, guest] = await turnsGame();
  let view = await getRoom(host);
  assert.equal(view.turn.cards.length, 2);
  assert.equal(view.turn.cardLabel, `${view.turn.cards[0].label} or ${view.turn.cards[1].label}`);
  assert.deepEqual(view.turn.card, view.turn.cards[0]);
  assert.ok("kind" in view.turn.card);

  const key = `bran:room:${host.code}`;
  const saved = (await store.get<Record<string, any>>(key))!;
  saved.turn.card = saved.turn.deal[0];
  delete saved.turn.deal;
  delete saved.recentCards;
  await store.set(key, saved);
  view = await getRoom(guest);
  assert.equal(view.turn.cards.length, 1, "a legacy single card");
  assert.equal(view.turn.cardLabel, view.turn.cards[0].label);
  assert.doesNotMatch(view.turn.cardLabel, / or /);

  const finished = await legacyGame(2);
  clock += 15_000 * 24 + 15_000 * 6;
  view = await getRoom(finished[1]);
  assert.equal(view.status, "ended");
  assert.equal(view.turn.card, null);
  assert.equal(view.turn.cardLabel, null);
});

test("a legacy room with a single turn.card keeps working", async () => {
  const [host, guest] = await turnsGame();
  const key = `bran:room:${host.code}`;
  const saved = (await store.get<Record<string, any>>(key))!;
  saved.turn.card = saved.turn.deal[0];
  delete saved.turn.deal;
  delete saved.recentCards;
  await store.set(key, saved);
  let view = await getRoom(host);
  assert.equal(view.turn.cards.length, 1, "one card");
  const card = view.turn.cards[0] as Card;
  assert.notEqual(card.kind, "wild", "this seeded deal has no wild");
  const misfit = allCodes().find((code) => !cardFits(card, code) && !(code in view.countryClaims))!;
  const bad = await claim(host, misfit);
  assert.equal(bad.status, 400);
  assert.match((await json(bad)).error, /doesn't fit this card/);
  const fitting = allCodes().find((code) => cardFits(card, code) && !(code in view.countryClaims))!;
  assert.equal((await claim(host, fitting)).status, 200);
  assert.equal(lastClaim(await getRoom(host)).points, 1, "a single card is worth one point");
  view = await getRoom(guest);
  assert.equal(view.turn.cards.length, 2, "the next turn is a pair");
});

test("a legacy room that reaches its last turn tied goes to sudden death instead of crashing", async () => {
  const sessions = await legacyGame(2);
  let view = await passTurns(sessions, 24);
  assert.equal(view.status, "playing");
  assert.equal(view.turn.sudden.round, 1);
  assert.equal(view.turn.totalRounds, 12);
  view = await passTurns(sessions, 6);
  assert.equal(view.status, "ended");
  assert.equal(view.winners.length, 2);
});

test("compare-and-set still guards sudden-death turns", async () => {
  const sessions = await turnsGame(2, "turns", { rounds: 15 });
  const [host, guest] = sessions;
  const view = await passTurns(sessions, 30);
  const fits = allCodes().filter((code) => !(code in view.countryClaims) && cardsOf(view).some((card) => cardFits(card, code)));
  const [a, b] = await Promise.all([claim(host, fits[0]), claim(host, fits[1])]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const after = await getRoom(guest);
  assert.equal(after.turn.number, 31);
  assert.equal(lastClaim(after).sudden, true);
});

test("the snapshot exposes winners only after the game ended", async () => {
  const sessions = await turnsGame();
  const [host, guest] = sessions;
  assert.equal("winners" in (await getRoom(guest)), false);
  assert.equal((await postRoom({ action: "end", code: host.code, token: host.token, name: "Host" })).status, 200);
  const view = await getRoom(guest);
  assert.equal(view.status, "ended");
  assert.equal(view.winners.length, 2);
});
