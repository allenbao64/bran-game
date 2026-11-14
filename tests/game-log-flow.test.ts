import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { NextRequest } from "next/server";
import type { Redis } from "@upstash/redis";
import { POST as roomPost, GET as roomGet } from "@/app/api/room/route";
import { POST as guessPost } from "@/app/api/guess/route";
import { GET as logGet } from "@/app/api/room/log/route";
import { LOG_TTL_SECONDS, setRedisForTests } from "@/lib/redis";
import { LOG_INDEX_KEY, logIdOf, logKey, parseGameLog, queueLog, buildWrongEvent, setLogTimeoutForTests, type GameLog } from "@/lib/game-log";
import { commitTurnRoom, loadTurnRoom, setTurnRngForTests } from "@/lib/turn-room";
import { allCodes, cardFits, fittingCodes, cardLabel, type Card } from "@/lib/turn-rules";
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
afterEach(() => {
  setRedisForTests(null);
  setTurnRngForTests(null);
  Date.now = realNow;
  delete process.env.GAME_LOGGING;
  setLogTimeoutForTests(null);
  mock.restoreAll();
});

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
const end = (session: Session) => postRoom({ action: "end", code: session.code, token: session.token, name: "x" });

async function turnsGame(players = 2, mode: "turns" | "live" | "empire" = "turns", extra: Record<string, unknown> = {}) {
  const host = await json(await postRoom({ action: "create", name: "Host", mode, ...extra })) as Session;
  const sessions = [host];
  for (const name of ["Brian", "Casey"].slice(0, players - 1)) sessions.push(await json(await postRoom({ action: "join", code: host.code, name })) as Session);
  const started = await postRoom({ action: "start", code: host.code, token: host.token, name: "Host" });
  assert.equal(started.status, 200);
  return sessions;
}
const whoseTurn = (view: Record<string, any>, sessions: Session[]) => sessions.find((s) => s.playerId === view.turn.currentPlayerId)!;
const cardsOf = (view: Record<string, any>): Card[] => (view.turn.cards ?? []) as Card[];
const hasWild = (cards: Card[]) => cards.some((card) => card.kind === "wild");
/** A free country for the current deal: "any" fits at least one card, "both" every card of a pair. */
function pickFitOrUndefined(view: Record<string, any>, mode: "any" | "both"): string | undefined {
  const cards = cardsOf(view);
  const taken = new Set(Object.keys(view.countryClaims));
  return allCodes().find((code) => {
    if (taken.has(code)) return false;
    const fits = cards.filter((card) => cardFits(card, code)).length;
    return mode === "both" ? cards.length >= 2 && fits === cards.length : fits >= 1;
  });
}
function pickFitting(view: Record<string, any>, mode: "any" | "both" = "any"): string {
  const code = pickFitOrUndefined(view, mode);
  if (!code) throw new Error(`no free country fits this deal (${mode})`);
  return code;
}
/** A free country that fits no card of the current deal. */
const misfitOf = (view: Record<string, any>): string => allCodes().find((code) => cardsOf(view).every((card) => !cardFits(card, code)) && !(code in view.countryClaims))!;
/** Passes `count` turns in a row, returning the fresh view. */
async function passTurns(sessions: Session[], count: number) {
  let view = await getRoom(sessions[0]);
  for (let turn = 0; turn < count; turn++) {
    assert.equal((await pass(whoseTurn(view, sessions))).status, 200, `pass ${turn}`);
    view = await getRoom(sessions[0]);
  }
  return view;
}

const roomKeyOf = (session: Session) => `bran:room:${session.code}`;
const startedAtOf = async (session: Session) => (await store.get<{ startedAt: number }>(roomKeyOf(session)))!.startedAt!;
const logIdFor = async (session: Session) => logIdOf(session.code, await startedAtOf(session));
/** The game's log, parsed as the read API does. */
const logOf = async (session: Session): Promise<GameLog> => {
  const logId = await logIdFor(session);
  return parseGameLog(logId, (await store.hgetall<Record<string, unknown>>(logKey(logId))) ?? {});
};
/** Every write the log makes (game keys and the index). */
const logWrites = () => store.writes.filter((write) => write.key.startsWith("bran:glog:"));
/** Only the HSET writes: one per request that logged something, plus the start. */
const hsets = () => logWrites().filter((write) => write.cmd === "hset");
const clearWrites = () => { store.writes.length = 0; };

/** Plays a whole turns game: a both-cards claim when possible, else any fit, a pass every `passEvery` turns, and a wrong guess every `wrongEvery` turns. */
async function playToEnd(sessions: Session[], { passEvery = 5, wrongEvery = 0 } = {}) {
  let view = await getRoom(sessions[0]);
  let turns = 0;
  let passes = 0;
  let wrongs = 0;
  while (view.status !== "ended" && turns < 400) {
    clock += 1_000;
    const current = whoseTurn(view, sessions);
    if (wrongEvery && turns % wrongEvery === wrongEvery - 1 && !hasWild(cardsOf(view))) {
      if ((await claim(current, misfitOf(view))).status === 400) wrongs++;
    }
    const code = turns % passEvery === passEvery - 1 ? undefined : (pickFitOrUndefined(view, "both") ?? pickFitOrUndefined(view, "any"));
    if (code) assert.equal((await claim(current, code)).status, 200);
    else {
      assert.equal((await pass(current)).status, 200);
      passes++;
    }
    turns++;
    view = await getRoom(sessions[0]);
  }
  return { view, turns, passes, wrongs };
}

test("starting a turns room writes the start record, the index entry and a 30-day TTL", async () => {
  const [host, guest] = await turnsGame();
  const view = await getRoom(host);
  const logId = await logIdFor(host);
  const raw = (await store.hgetall<Record<string, unknown>>(logKey(logId)))!;
  const log = await logOf(host);
  assert.ok(log.start);
  assert.equal(log.start.logId, logId);
  assert.equal(log.start.room, host.code);
  assert.deepEqual(log.start.players.map((player) => player.name), ["Host", "Brian"]);
  assert.equal(log.start.turnSeconds, 15);
  assert.equal(log.start.rounds, 20);
  assert.deepEqual(log.start.startCountries, (await store.get<{ startCountries: Record<string, string> }>(roomKeyOf(host)))!.startCountries);
  assert.equal(Object.keys(log.start.startCountries).length, 2);
  assert.ok(!JSON.stringify(raw).includes(host.token) && !JSON.stringify(raw).includes(guest.token), "no token in the stored log");
  assert.deepEqual(await store.zrange(LOG_INDEX_KEY, 0, -1), [logId]);
  assert.equal(store.ttlOf(logKey(logId)), 2_592_000);
  assert.deepEqual(logWrites().map((write) => write.cmd), ["hset", "expire", "zadd", "zremrangebyscore"]);
  assert.equal(view.turn.number, 0);
});

test("a claim writes exactly one hset holding one turn event", async () => {
  const [host] = await turnsGame();
  const view = await getRoom(host);
  const code = pickFitting(view, "both");
  const cards = cardsOf(view);
  clearWrites();
  clock += 4_200;
  const body = (await json(await claim(host, code))).claim;
  assert.equal(hsets().length, 1);
  assert.deepEqual(hsets()[0].fields, ["t:0000"]);
  const event = (await logOf(host)).turns[0];
  assert.equal(event.n, 0);
  assert.equal(event.pid, host.playerId);
  assert.equal(event.outcome, "claim");
  assert.equal(event.ms, 4_200);
  assert.equal(event.at, clock);
  assert.equal(event.unclaimed, allCodes().length - Object.keys(view.countryClaims).length);
  const unclaimed = allCodes().filter((c) => !(c in view.countryClaims));
  assert.deepEqual(event.deal!.map((card) => card.kind), cards.map((card) => card.kind));
  assert.deepEqual(event.deal!.map((card) => card.label), cards.map((card) => cardLabel(card)));
  event.deal!.forEach((card, i) => assert.equal(card.fit, fittingCodes(cards[i], unclaimed).length));
  assert.equal(event.fitBoth, unclaimed.filter((c) => cards.every((card) => cardFits(card, c))).length);
  assert.equal(event.claim!.code, body.code);
  assert.equal(event.claim!.points, body.points);
  assert.equal(event.claim!.fit, body.fit);
  assert.equal(event.claim!.both, body.both);
  assert.deepEqual(event.claim!.hit, cards.flatMap((card, i) => (cardFits(card, code) ? [i] : [])));
});

test("a turn flush after a failed start write still sets the TTL", async () => {
  const errors = mock.method(console, "error", () => {});
  const realPipeline = store.pipeline.bind(store);
  let startFailed = false;
  store.pipeline = () => {
    // Only the start write's pipeline fails; every later pipeline is real.
    if (!startFailed) { startFailed = true; throw new Error("redis down"); }
    return realPipeline();
  };
  const [host] = await turnsGame();
  const logId = await logIdFor(host);
  assert.equal(await store.hgetall(logKey(logId)), null, "the start write failed: no hash yet");
  assert.equal(store.ttlOf(logKey(logId)), undefined);
  assert.equal(errors.mock.callCount(), 1);

  const view = await getRoom(host);
  assert.equal((await claim(host, pickFitting(view))).status, 200, "turn 0 (n % 5 === 0) heals");
  assert.equal(store.ttlOf(logKey(logId)), LOG_TTL_SECONDS);
  assert.equal(logWrites().find((write) => write.cmd === "expire")!.option, "NX");
  assert.equal((await logOf(host)).turns.length, 1);
});

test("a turn flush after a failed start write also adds the game to the index", async () => {
  mock.method(console, "error", () => {});
  const realPipeline = store.pipeline.bind(store);
  let startFailed = false;
  store.pipeline = () => {
    if (!startFailed) { startFailed = true; throw new Error("redis down"); }
    return realPipeline();
  };
  const [host] = await turnsGame();
  const logId = await logIdFor(host);
  assert.deepEqual(await store.zrange(LOG_INDEX_KEY, 0, -1), []);
  clearWrites();
  assert.equal((await claim(host, pickFitting(await getRoom(host)))).status, 200);
  assert.deepEqual(await store.zrange(LOG_INDEX_KEY, 0, -1), [logId]);
  assert.equal(logWrites().find((write) => write.cmd === "zadd")!.option, "NX");
});

test("flushes that do not hit n % 5 add no expire", async () => {
  const sessions = await turnsGame();
  const [host] = sessions;
  assert.equal((await claim(host, pickFitting(await getRoom(host)))).status, 200, "turn 0 heals");
  clearWrites();
  clock += 1_000;
  const view = await getRoom(host);
  assert.equal(view.turn.number, 1);
  assert.equal((await claim(whoseTurn(view, sessions), pickFitting(view))).status, 200);
  assert.deepEqual(logWrites().map((write) => write.cmd), ["hset"]);
  assert.deepEqual(hsets()[0].fields, ["t:0001"]);
});

test("pass and timeout are logged with their own outcome and time", async () => {
  const [host, guest] = await turnsGame();
  clock += 2_500;
  assert.equal((await pass(host)).status, 200);
  const passed = (await logOf(host)).turns[0];
  assert.equal(passed.outcome, "pass");
  assert.equal(passed.ms, 2_500);
  const turnStart = clock;
  clock += 15_001;
  const view = await getRoom(guest);
  assert.equal(view.turn.number, 2, "the guest's turn timed out");
  const log = await logOf(guest);
  assert.equal(log.turns.length, 2);
  const timeout = log.turns[1];
  assert.equal(timeout.n, 1);
  assert.equal(timeout.outcome, "timeout");
  assert.equal(timeout.ms, 15_000);
  assert.equal(timeout.at, turnStart + 15_000);
  assert.ok(timeout.deal && timeout.deal.length === 2);
});

test("wrong guesses are logged as their own events and do not end the turn", async () => {
  const [host, guest] = await turnsGame();
  const view = await getRoom(host);
  clock += 1_000;
  const misfit = misfitOf(view);
  clearWrites();
  const wrongCall = await claim(host, misfit);
  assert.equal(wrongCall.status, 400);
  let log = await logOf(host);
  assert.equal(log.wrong.length, 1);
  const wrongEvent = log.wrong[0];
  assert.equal(wrongEvent.why, "no_fit");
  assert.equal(wrongEvent.code, misfit);
  assert.deepEqual(wrongEvent.kinds, cardsOf(view).map((card) => card.kind));
  assert.equal(wrongEvent.ms, 1_000);
  assert.equal(wrongEvent.n, 0);
  assert.equal(hsets().length, 1);
  assert.equal(hsets()[0].fields![0], `w:0000:${clock}:${misfit}`);

  const guestStart = view.startCountries[guest.playerId];
  assert.equal((await claim(host, guestStart)).status, 409);
  log = await logOf(host);
  assert.equal(log.wrong.find((w) => w.code === guestStart)!.why, "taken");
  assert.equal((await claim(host, view.startCountries[host.playerId])).status, 409);
  log = await logOf(host);
  assert.equal(log.wrong.find((w) => w.code === view.startCountries[host.playerId])!.why, "own");
  assert.equal(log.turns.length, 0, "wrong guesses end no turn");

  assert.equal((await claim(host, pickFitting(view))).status, 200);
  log = await logOf(host);
  assert.equal(log.turns.length, 1);
  assert.equal(log.turns[0].outcome, "claim");
  assert.equal("why" in log.turns[0], false);
  assert.equal("code" in log.turns[0], false);
  assert.equal((await getRoom(host)).turn.number, 1);
});

test("a played game yields exactly one event per turn", async () => {
  const sessions = await turnsGame(2, "turns", { rounds: 15 });
  const { view, turns, passes, wrongs } = await playToEnd(sessions, { passEvery: 5, wrongEvery: 7 });
  assert.equal(view.status, "ended");
  const log = await logOf(sessions[0]);
  const n = view.turn.number;
  assert.equal(n, turns);
  assert.deepEqual(log.turns.map((t) => t.n), Array.from({ length: n }, (_, i) => i), "one event per turn, no gap, no duplicate");
  assert.equal(log.wrong.length, wrongs);
  assert.equal(wrongs, 4);

  const claimEvents = log.turns.filter((t) => t.outcome === "claim").map((t) => ({ code: t.claim!.code, points: t.claim!.points, pid: t.pid }));
  assert.deepEqual(claimEvents, view.claimLog.map((c: any) => ({ code: c.code, points: c.points, pid: c.playerId })));
  assert.equal(log.turns.filter((t) => t.outcome === "pass").length, passes);
  assert.equal(log.turns.filter((t) => t.outcome === "timeout").length, 0);

  const normal = log.turns.filter((t) => !t.sudden);
  normal.forEach((t) => assert.equal(Boolean(t.totals), t.n % 2 === 1, `totals on round ends only (n=${t.n})`));
  const lastTotals = log.turns.filter((t) => t.totals).at(-1)!;
  assert.ok(log.end);
  for (const id of Object.keys(view.scores)) assert.equal(lastTotals.totals![id], log.end.scores[id].total, `final total of ${id}`);

  assert.equal(log.end.reason, "turns_played");
  assert.deepEqual(log.end.winners, view.winners);
  assert.equal(log.end.turnsPlayed, view.turn.number);
  assert.ok(log.end.durationMs > 0);
  for (const id of Object.keys(view.scores)) {
    const s = view.scores[id];
    assert.deepEqual(log.end.scores[id], { points: s.points, bonus: s.bonusTotal, total: s.total, territory: s.territory });
  }

  // One hset per request that logged: the start write, then one per turn or wrong guess. The end rides in the last turn's write.
  assert.equal(hsets().length, 1 + turns + wrongs);
  const endWrite = hsets().find((write) => write.fields!.includes("end"))!;
  const index = store.writes.indexOf(endWrite);
  assert.equal(store.writes[index + 1].cmd, "expire");
  assert.equal(store.writes[index + 1].key, endWrite.key);
});

test("two simultaneous claims for one turn log the turn once", async () => {
  const [host, guest] = await turnsGame();
  const view = await getRoom(host);
  const fits = allCodes().filter((code) => !(code in view.countryClaims) && cardsOf(view).some((card) => cardFits(card, code)));
  clearWrites();
  const [a, b] = await Promise.all([claim(host, fits[0]), claim(host, fits[1])]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const log = await logOf(guest);
  assert.equal(log.turns.length, 1);
  assert.equal(log.turns[0].n, 0);
  assert.equal(log.turns[0].outcome, "claim");
  assert.equal(hsets().filter((write) => write.fields!.includes("t:0000")).length, 1);
  assert.equal(hsets().length, 1);
});

test("a claim racing a pass for the same turn logs exactly one turn event", async () => {
  const [host, guest] = await turnsGame();
  assert.equal((await claim(host, pickFitting(await getRoom(host)))).status, 200);
  const after = await getRoom(guest);
  assert.equal(after.turn.number, 1);
  const [c, d] = await Promise.all([claim(guest, pickFitting(after)), pass(guest)]);
  assert.deepEqual([c.status, d.status].sort(), [200, 409]);
  const log = await logOf(guest);
  const events = log.turns.filter((t) => t.n === 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, c.status === 200 ? "claim" : "pass");
});

test("five clients polling together after a timeout log it once", async () => {
  const [host] = await turnsGame();
  clearWrites();
  clock += 15_001;
  const views = await Promise.all(Array.from({ length: 5 }, () => getRoom(host)));
  assert.ok(views.every((view) => view.turn.number === 1));
  const log = await logOf(host);
  assert.equal(log.turns.length, 1);
  assert.equal(log.turns[0].outcome, "timeout");
  assert.equal(hsets().filter((write) => write.fields!.includes("t:0000")).length, 1);
  assert.equal(hsets().length, 1);
});

test("timeout catch-up across several turns logs each turn once in a single write", async () => {
  const [host, guest] = await turnsGame();
  clearWrites();
  const started = clock;
  clock += 15_000 * 5 + 1;
  await getRoom(host);
  assert.equal(hsets().length, 1);
  assert.deepEqual(hsets()[0].fields, ["t:0000", "t:0001", "t:0002", "t:0003", "t:0004"]);
  const log = await logOf(host);
  assert.deepEqual(log.turns.map((t) => t.n), [0, 1, 2, 3, 4]);
  assert.ok(log.turns.every((t) => t.outcome === "timeout" && t.ms === 15_000));
  assert.ok(log.turns[0].deal && log.turns[0].deal.length === 2);
  for (const t of log.turns.slice(1)) {
    assert.equal(t.deal, null);
    assert.equal(t.fitBoth, null);
  }
  assert.deepEqual(log.turns.map((t) => t.at), [1, 2, 3, 4, 5].map((k) => started + 15_000 * k));

  clearWrites();
  await getRoom(guest);
  assert.equal(hsets().length, 0, "a second look writes nothing");

  const view = await getRoom(guest);
  assert.equal(view.turn.number, 5);
  assert.equal(view.turn.currentPlayerId, guest.playerId);
  assert.equal((await claim(guest, pickFitting(view))).status, 200);
  assert.equal(hsets().length, 1);
  assert.deepEqual(hsets()[0].fields, ["t:0005"]);
  assert.equal((await logOf(host)).turns.length, 6);
});

test("the request that loses the compare-and-set writes nothing", async () => {
  const [host] = await turnsGame();
  const view = await getRoom(host);
  const code = pickFitting(view);
  const realEval = store.eval.bind(store);
  let injected = false;
  store.eval = (async (script: string, keys: string[], args: string[]) => {
    if (!injected && script.includes("tonumber(room.turn.number) ~= tonumber(ARGV[1])")) {
      injected = true;
      // A competing pass by the same player advances the turn first, so the claim's commit is stale.
      assert.equal((await pass(host)).status, 200);
    }
    return realEval(script, keys, args);
  }) as typeof store.eval;
  clearWrites();
  const response = await claim(host, code);
  assert.equal(response.status, 409);
  const log = await logOf(host);
  assert.equal(log.turns.length, 1);
  assert.equal(log.turns[0].n, 0);
  assert.equal(log.turns[0].outcome, "pass");
  assert.equal(hsets().filter((write) => write.fields!.includes("t:0000")).length, 1);
  assert.equal(hsets().length, 1, "only the competing pass wrote");
});

test("a stale commit writes nothing", async () => {
  const [host] = await turnsGame();
  const key = roomKeyOf(host);
  const redis = store as unknown as Redis;
  const room = (await loadTurnRoom(redis, key))!;
  queueLog(room, buildWrongEvent({ turn: room.turn!, deal: null, playerId: host.playerId, code: "FR", why: "own", at: clock }));
  const bumped = (await loadTurnRoom(redis, key))!;
  bumped.turn!.number = 1;
  assert.equal(await commitTurnRoom(redis, key, 0, bumped), true);
  clearWrites();
  assert.equal(await commitTurnRoom(redis, key, 0, room), false);
  assert.equal(hsets().length, 0);
});

test("an all-timeout game goes through sudden death in one write", async () => {
  const sessions = await turnsGame(2, "turns", { rounds: 15 });
  clearWrites();
  clock += 15_000 * 36;
  const view = await getRoom(sessions[0]);
  assert.equal(view.status, "ended");
  const log = await logOf(sessions[0]);
  assert.deepEqual(log.turns.map((t) => t.n), Array.from({ length: 36 }, (_, i) => i));
  assert.ok(log.turns.every((t) => t.outcome === "timeout" && t.ms === 15_000));
  assert.ok(log.turns[0].deal);
  assert.ok(log.turns.slice(1).every((t) => t.deal === null));
  assert.deepEqual(log.turns.slice(30).map((t) => [t.sudden, t.round]), [[true, 16], [true, 16], [true, 17], [true, 17], [true, 18], [true, 18]]);
  for (const t of log.turns) assert.equal(Boolean(t.totals), t.n % 2 === 1);
  assert.ok(log.end);
  assert.equal(log.end.reason, "turns_played");
  assert.equal(log.end.suddenRounds, 3);
  assert.equal(log.end.winners.length, 2);
  assert.equal(hsets().length, 1);
  assert.deepEqual(hsets()[0].fields!.length, 37);
  assert.deepEqual(logWrites().map((write) => write.cmd), ["hset", "expire"]);
});

test("board exhausted is recorded as such", async () => {
  const [host] = await turnsGame();
  const key = roomKeyOf(host);
  const redis = store as unknown as Redis;
  const room = (await loadTurnRoom(redis, key))!;
  room.claims = [...(room.claims ?? []), ...allCodes().map((code) => ({ code, playerId: host.playerId, points: 0, round: 1, turn: 0, at: clock }))];
  assert.equal(await commitTurnRoom(redis, key, room.turn!.number, room), true);
  assert.equal((await pass(host)).status, 200);
  const log = await logOf(host);
  assert.ok(log.end);
  assert.equal(log.end.reason, "board_exhausted");
  assert.equal(log.end.turnsPlayed, 1);
});

test("host ending early writes one host_ended record", async () => {
  const sessions = await turnsGame();
  await passTurns(sessions, 3);
  assert.equal((await end(sessions[0])).status, 200);
  const log = await logOf(sessions[0]);
  assert.ok(log.end);
  assert.equal(log.end.reason, "host_ended");
  assert.equal(log.end.turnsPlayed, 3);
  assert.ok(Array.isArray(log.end.winners) && log.end.winners.length >= 1);
  assert.deepEqual(log.turns.map((t) => t.n), [0, 1, 2], "the interrupted turn has no event");
  clearWrites();
  assert.notEqual((await end(sessions[0])).status, 200);
  assert.equal(logWrites().length, 0, "a second end writes nothing");
});

test("a logging failure does not fail the request", async () => {
  const errors = mock.method(console, "error", () => {});
  const sessions = await turnsGame();
  const [host, guest] = sessions;
  store.hset = async () => { throw new Error("redis down"); };
  store.pipeline = () => { throw new Error("redis down"); };
  let view = await getRoom(host);
  const code = pickFitting(view);
  assert.equal((await claim(host, code)).status, 200);
  view = await getRoom(host);
  assert.equal(view.turn.number, 1);
  const misfit = misfitOf(view);
  assert.equal((await claim(guest, misfit)).status, 400);
  assert.equal((await pass(guest)).status, 200);
  clock += 15_001;
  view = await getRoom(host);
  assert.equal(view.turn.number, 3, "the timeout was applied");
  assert.equal(view.status, "playing");
  assert.equal((await end(host)).status, 200);
  const final = await getRoom(host);
  assert.equal(final.status, "ended");
  assert.equal(final.turn.number, 3);
  assert.equal(final.claimLog.length, 1);
  assert.ok(errors.mock.callCount() > 0);
  assert.ok(errors.mock.calls.every((call) => String(call.arguments[0]).startsWith("Game log")));
});

test("a hanging log write does not hold the request", async () => {
  const errors = mock.method(console, "error", () => {});
  const [host] = await turnsGame();
  store.hset = () => new Promise<never>(() => {});
  setLogTimeoutForTests(30);
  const view = await getRoom(host);
  const started = realNow();
  const response = await claim(host, pickFitting(view));
  assert.equal(response.status, 200);
  assert.ok(realNow() - started < 1_000, "the request waited on the log write");
  assert.equal((await getRoom(host)).turn.number, 1);
  assert.equal(errors.mock.callCount(), 1);
});

test("the kill switch writes nothing", async () => {
  for (const value of ["off", "0"]) {
    process.env.GAME_LOGGING = value;
    const sessions = await turnsGame();
    const [host] = sessions;
    const view = await getRoom(host);
    assert.equal((await claim(host, pickFitting(view))).status, 200);
    assert.equal((await claim(sessions[1], misfitOf(await getRoom(sessions[1])))).status, 400);
    assert.equal((await pass(sessions[1])).status, 200);
    clock += 15_001;
    await getRoom(host);
    assert.equal((await end(host)).status, 200);
    assert.equal(logWrites().length, 0, `GAME_LOGGING=${value}`);
    assert.deepEqual(await store.zrange(LOG_INDEX_KEY, 0, -1), []);
    assert.equal(await store.hgetall(logKey(await logIdFor(host))), null);
  }
  delete process.env.GAME_LOGGING;
  const [host] = await turnsGame();
  assert.ok(logWrites().length > 0, "back on: the start is logged");
  clearWrites();
  assert.equal((await claim(host, pickFitting(await getRoom(host)))).status, 200);
  assert.equal(hsets().length, 1);
});

test("live and Empire rooms write nothing", async () => {
  const live = await turnsGame(2, "live");
  assert.equal((await claim(live[1], "CA")).status, 200);
  assert.equal((await claim(live[0], "US")).status, 200);
  assert.equal((await end(live[0])).status, 200);

  const empire = await turnsGame(2, "empire");
  const view = await getRoom(empire[1]);
  assert.equal(view.mode, "empire");
  assert.equal((await end(empire[0])).status, 200);

  assert.equal(logWrites().length, 0);
});

test("no token or private field is ever stored in a log", async () => {
  const sessions = await turnsGame(2, "turns", { rounds: 15 });
  await playToEnd(sessions, { passEvery: 4, wrongEvery: 6 });
  const logId = await logIdFor(sessions[0]);
  const raw = (await store.hgetall<Record<string, unknown>>(logKey(logId)))!;
  const keysSeen = new Set<string>();
  const collectKeys = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(collectKeys);
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) { keysSeen.add(k); collectKeys(v); }
  };
  for (const value of Object.values(raw)) {
    const text = String(value);
    for (const session of sessions) assert.equal(text.includes(session.token), false, "a token is stored");
    collectKeys(JSON.parse(text));
  }
  for (const forbidden of ["token", "ip", "userAgent"]) assert.equal(keysSeen.has(forbidden), false, forbidden);
});

const logRequest = (code: string, token?: string) => logGet(new NextRequest(`http://localhost/api/room/log?code=${code}`, {
  headers: token === undefined ? {} : { authorization: `Bearer ${token}` }
}));

test("the log API returns the game to its players", async () => {
  const sessions = await turnsGame(2, "turns", { rounds: 15 });
  await playToEnd(sessions, { passEvery: 4, wrongEvery: 6 });
  for (const session of sessions) {
    const response = await logRequest(session.code, session.token);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const text = await response.text();
    const body = JSON.parse(text) as GameLog;
    assert.equal(body.logId, await logIdFor(session));
    assert.ok(body.start);
    assert.ok(body.end, "works after the game ended");
    assert.equal(body.badFields, 0);
    assert.deepEqual(body.turns.map((t) => t.n), body.turns.map((t) => t.n).slice().sort((a, b) => a - b));
    assert.equal(body.turns.length, body.end.turnsPlayed);
    for (const other of sessions) assert.equal(text.includes(other.token), false, "no token in the response");
  }
});

test("the log API refuses outsiders and non-turns rooms", async () => {
  const [host] = await turnsGame();
  assert.equal((await logRequest(host.code, "short")).status, 401);
  assert.equal((await logRequest(host.code)).status, 401);
  const [other] = await turnsGame();
  assert.equal((await logRequest(host.code, other.token)).status, 403);
  assert.equal((await logRequest("AAAAAA", host.token)).status, 404);
  const [liveHost] = await turnsGame(2, "live");
  assert.equal((await logRequest(liveHost.code, liveHost.token)).status, 404);
  process.env.GAME_LOGGING = "off";
  const [quiet] = await turnsGame();
  assert.equal((await logRequest(quiet.code, quiet.token)).status, 404);
});
