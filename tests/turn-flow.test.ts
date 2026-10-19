import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { NextRequest } from "next/server";
import type { Redis } from "@upstash/redis";
import { POST as roomPost, GET as roomGet } from "@/app/api/room/route";
import { POST as guessPost } from "@/app/api/guess/route";
import { setRedisForTests } from "@/lib/redis";
import { setTurnRngForTests, commitTurnRoom, loadTurnRoom, applyClaim, initialTurnState, type TurnRoom } from "@/lib/turn-room";
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
const whoseTurn = (view: Record<string, any>, sessions: Session[]) => sessions.find((s) => s.playerId === view.turn.currentPlayerId)!;
/** A country that fits the current card and is still free. */
function pickFitting(view: Record<string, any>): string {
  const taken = new Set(Object.keys(view.countryClaims));
  return fittingCodes(view.turn.card as Card, allCodes().filter((code) => !taken.has(code)))[0];
}

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
  assert.equal(view.turn.totalRounds, 12);
  assert.equal(view.turn.doubleRound, false);
  assert.ok(view.turn.card && view.turn.cardLabel);
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
  assert.equal(Object.keys(view.countryClaims).length, 1);
});

test("the dealt card is enforced, and a wrong answer lets the player retry", async () => {
  const sessions = await turnsGame();
  const host = sessions[0];
  let view = await getRoom(host);
  // Find a turn whose card actually excludes some country (wild cards fit everything).
  for (let i = 0; i < 10 && view.turn.card.kind === "wild"; i++) { await pass(whoseTurn(view, sessions)); view = await getRoom(host); }
  const card = view.turn.card as Card;
  assert.notEqual(card.kind, "wild");
  const misfit = allCodes().find((code) => !cardFits(card, code))!;
  const bad = await claim(whoseTurn(view, sessions), misfit);
  assert.equal(bad.status, 400);
  assert.match((await json(bad)).error, /doesn't fit this card/);
  const unchanged = await getRoom(host);
  assert.equal(unchanged.turn.number, view.turn.number, "a failed answer does not end the turn");
  assert.equal((await claim(whoseTurn(view, sessions), pickFitting(view))).status, 200);
});

test("a country can only be claimed once and unknown answers are rejected", async () => {
  const [host, guest] = await turnsGame();
  const first = await getRoom(host);
  const code = pickFitting(first);
  assert.equal((await claim(host, code)).status, 200);
  let view = await getRoom(guest);
  // Walk turns until the guest's card also fits the taken country, then try to steal it.
  assert.equal((await claim(guest, "ZZ")).status, 400);
  if (cardFits(view.turn.card, code)) {
    const stolen = await claim(guest, code);
    assert.equal(stolen.status, 409);
    assert.match((await json(stolen)).error, /already claimed/);
  }
  view = await getRoom(guest);
  assert.equal(view.countryClaims[code], host.playerId);
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
  const fits = fittingCodes(view.turn.card as Card, allCodes());
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
  const sessions = await turnsGame(2);
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
  assert.deepEqual(view.claimLog.map((c: any) => c.points), view.claimLog.map((c: any) => (c.round >= 10 ? 2 : 1)));
  assert.equal(view.claimLog[0].order, 0);
  assert.ok(view.claimLog.every((c: any, i: number) => i === 0 || c.at >= view.claimLog[i - 1].at));

  const hostResult = view.results.find((r: any) => r.playerId === sessions[0].playerId);
  const guestResult = view.results.find((r: any) => r.playerId === sessions[1].playerId);
  assert.equal(hostResult.points, 9 + 6, "9 single-point claims and 3 double-point claims");
  assert.equal(guestResult.points, 8 + 6, "one pass in round 1");
  for (const r of view.results) {
    assert.equal(r.total, r.points + r.bonusTotal);
    assert.equal(r.guesses.length, view.claimLog.filter((c: any) => c.playerId === r.playerId).length);
  }
  assert.ok(view.results[0].total >= view.results[1].total, "results are ranked by final score");
  assert.ok(view.awards.some((a: any) => a.id === "first" && a.playerId === sessions[0].playerId));
  assert.equal((await claim(sessions[0], "FR")).status, 409, "no claims once the game is over");
  assert.equal((await pass(sessions[0])).status, 409);
});

test("timeouts alone end the game after 12 rounds", async () => {
  const sessions = await turnsGame(2);
  clock += 15_000 * 24 - 1;
  assert.equal((await getRoom(sessions[1])).status, "playing");
  clock += 1;
  const view = await getRoom(sessions[1]);
  assert.equal(view.status, "ended");
  assert.equal(view.results.length, 2);
  assert.deepEqual(view.results.map((r: any) => r.total), [0, 0]);
  assert.deepEqual(view.awards, []);
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
    turn: { ...initialTurnState(["p1", "p2"], 0), card: { kind: "continent", region: "Oceania" } },
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
  const blitz = await turnsGame(2, "turns", { turnSeconds: 10 });
  clock += 9_999;
  assert.equal((await getRoom(blitz[0])).turn.currentPlayerId, blitz[0].playerId, "10 seconds have not passed yet");
  clock += 1;
  const view = await getRoom(blitz[0]);
  assert.equal(view.turn.currentPlayerId, blitz[1].playerId);
  assert.equal(view.turn.startedAt, 1_800_000_000_000 + 10_000);
  clock += 10_000 * 23 - 1;
  assert.equal((await getRoom(blitz[0])).status, "playing");
  clock += 1;
  assert.equal((await getRoom(blitz[0])).status, "ended", "24 turns of 10s end the game");

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
