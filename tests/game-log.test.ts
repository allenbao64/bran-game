import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import type { Redis } from "@upstash/redis";
import { LOG_TTL_SECONDS } from "@/lib/redis";
import {
  buildEndRecord, buildStartRecord, buildTurnEvent, buildWrongEvent, endsRound, fieldOf, flushQueuedLog, isGameLoggingEnabled, logIdOf, logKey,
  LOG_ID_PATTERN, parseGameLog, queueLog, setLogTimeoutForTests, takeQueued, turnField, wrongField, type LogRecord
} from "@/lib/game-log";
import { allCodes, cardFits, cardLabel, fittingAll, fittingCodes, type Card, type Deal, type Score } from "@/lib/turn-rules";
import type { TurnState } from "@/lib/turns";

const turnOf = (over: Partial<TurnState<Deal>> = {}): TurnState<Deal> => ({
  number: 2, order: ["a", "b"], startedAt: 1_000, turnMs: 15_000, totalRounds: 3, deal: [], finished: false, ...over
});

const SCORE = (total: number): Score => ({ points: total - 1, bonuses: [], bonusTotal: 1, total, territory: 0 });

const LETTER_S: Card = { kind: "letter", letter: "S" };
const LANDLOCKED: Card = { kind: "landlocked" };

afterEach(() => {
  delete process.env.GAME_LOGGING;
  setLogTimeoutForTests(null);
  mock.restoreAll();
});

/** A fake client that records what the writers send. `hset` and `pipeline` can be replaced per test. */
function fakeRedis(overrides: { hset?: (key: string, fields: Record<string, unknown>) => Promise<unknown> } = {}) {
  const calls: { cmd: string; args?: unknown[] }[] = [];
  const pipe = {
    hset(key: string, fields: Record<string, unknown>) { calls.push({ cmd: "pipe.hset", args: [key, fields] }); return pipe; },
    expire(key: string, seconds: number) { calls.push({ cmd: "pipe.expire", args: [key, seconds] }); return pipe; },
    exec: async () => { calls.push({ cmd: "exec" }); return []; },
  };
  const redis = {
    hset: async (key: string, fields: Record<string, unknown>) => {
      calls.push({ cmd: "hset", args: [key, fields] });
      return overrides.hset ? overrides.hset(key, fields) : 1;
    },
    pipeline: () => pipe,
  } as unknown as Redis;
  return { calls, redis };
}

test("kill switch: on by default, off for off/0/false/no in any case and with spaces", () => {
  assert.equal(isGameLoggingEnabled({}), true);
  for (const value of ["OFF", " 0 ", "false", "No"]) assert.equal(isGameLoggingEnabled({ GAME_LOGGING: value }), false, value);
  for (const value of ["", "on", "1", "true"]) assert.equal(isGameLoggingEnabled({ GAME_LOGGING: value }), true, value);
});

test("keys and fields are stable and sortable", () => {
  const id = logIdOf("ABC234", 1_800_000_000_000);
  assert.equal(id, "ABC234-1800000000000");
  assert.equal(logKey(id), "bran:glog:ABC234-1800000000000");
  assert.equal(turnField(7), "t:0007");
  assert.equal(wrongField(7, 5, "FR"), "w:0007:5:FR");
  assert.equal(LOG_ID_PATTERN.test(id), true);
  assert.equal(LOG_ID_PATTERN.test("../x"), false);
});

test("endsRound: normal rounds with 2 and 3 players", () => {
  const two = [0, 1, 2, 3, 4, 5].map((n) => endsRound(turnOf({ number: n, order: ["a", "b"] })));
  assert.deepEqual(two, [false, true, false, true, false, true]);
  const three = [0, 1, 2, 3, 4, 5].map((n) => endsRound(turnOf({ number: n, order: ["a", "b", "c"] })));
  assert.deepEqual(three, [false, false, true, false, false, true]);
});

test("endsRound: sudden-death rounds", () => {
  const sudden = (order: string[]) => turnOf({ number: 30, sudden: { order, startNumber: 30, round: 1, maxRounds: 3 } });
  const two = sudden(["a", "b"]);
  assert.equal(endsRound(two), false);
  assert.equal(endsRound({ ...two, number: 31 }), true);
  const three = sudden(["a", "b", "c"]);
  assert.equal(endsRound({ ...three, number: 31 }), false);
  assert.equal(endsRound({ ...three, number: 32 }), true);
});

test("buildTurnEvent: a claim fitting both cards", () => {
  const deal: Deal = [LETTER_S, LANDLOCKED];
  const unclaimed = allCodes().slice(5);
  const code = unclaimed.find((c) => cardFits(LETTER_S, c) && cardFits(LANDLOCKED, c));
  assert.ok(code, "a country fitting both test cards must exist");
  const turn = turnOf({ deal, startedAt: 10_000 });
  const event = buildTurnEvent({ turn, deal, playerId: "a", outcome: "claim", at: 14_200, unclaimed, claim: { code, points: 3 } });
  assert.equal(event.deal![0].fit, fittingCodes(LETTER_S, unclaimed).length);
  assert.equal(event.deal![1].fit, fittingCodes(LANDLOCKED, unclaimed).length);
  assert.equal(event.fitBoth, fittingAll(deal, unclaimed).length);
  assert.equal(event.claim!.both, true);
  assert.deepEqual(event.claim!.hit, [0, 1]);
  assert.equal(event.claim!.fit, 2);
  assert.equal(event.ms, 4_200);
  assert.equal(event.at, 14_200);
  assert.equal(event.unclaimed, unclaimed.length);
  assert.deepEqual(event.deal!.map((card) => card.label), [cardLabel(LETTER_S), cardLabel(LANDLOCKED)]);
  assert.deepEqual(event.deal!.map((card) => card.kind), ["letter", "landlocked"]);
});

test("buildTurnEvent: a claim fitting one card, a pass, a timeout", () => {
  const deal: Deal = [LETTER_S, LANDLOCKED];
  const unclaimed = allCodes();
  const code = unclaimed.find((c) => cardFits(LETTER_S, c) && !cardFits(LANDLOCKED, c));
  assert.ok(code);
  const turn = turnOf({ deal, startedAt: 1_000, turnMs: 15_000 });
  const oneCard = buildTurnEvent({ turn, deal, playerId: "a", outcome: "claim", at: 3_000, unclaimed, claim: { code, points: 1 } });
  assert.equal(oneCard.claim!.hit.length, 1);
  assert.equal(oneCard.claim!.both, false);

  const pass = buildTurnEvent({ turn, deal, playerId: "a", outcome: "pass", at: 3_500, unclaimed });
  assert.equal("claim" in pass, false);
  assert.deepEqual(Object.keys(pass).sort(), ["at", "deal", "fitBoth", "ms", "n", "outcome", "pid", "round", "sudden", "t", "unclaimed"]);
  assert.equal(pass.ms, 2_500);

  const timeout = buildTurnEvent({ turn, deal, playerId: "a", outcome: "timeout", at: 16_000, unclaimed });
  assert.equal("claim" in timeout, false);
  assert.equal(timeout.ms, turn.turnMs);
  assert.equal(Object.values(timeout).every((value) => value !== undefined), true);
});

test("buildTurnEvent: no deal means null deal and null fitBoth", () => {
  const turn = turnOf();
  const unclaimed = allCodes();
  assert.equal(buildTurnEvent({ turn, deal: null, playerId: "a", outcome: "timeout", at: 1, unclaimed }).deal, null);
  const empty = buildTurnEvent({ turn, deal: [], playerId: "a", outcome: "timeout", at: 1, unclaimed });
  assert.equal(empty.deal, null);
  assert.equal(empty.fitBoth, null);
  const oneCard = buildTurnEvent({ turn, deal: [LETTER_S], playerId: "a", outcome: "pass", at: 1, unclaimed });
  assert.equal(oneCard.fitBoth, null);
  assert.equal(oneCard.deal!.length, 1);
});

test("buildTurnEvent: totals only when given; sudden turn uses totalRounds + sudden round", () => {
  const turn = turnOf({ number: 6, sudden: { order: ["a", "b"], startNumber: 6, round: 2, maxRounds: 3 } });
  const withTotals = buildTurnEvent({ turn, deal: null, playerId: "a", outcome: "pass", at: 1_500, unclaimed: [], totals: { a: 3, b: 4 } });
  assert.equal(withTotals.round, turn.totalRounds + turn.sudden!.round);
  assert.equal(withTotals.sudden, true);
  assert.deepEqual(withTotals.totals, { a: 3, b: 4 });
  const without = buildTurnEvent({ turn, deal: null, playerId: "a", outcome: "pass", at: 1_500, unclaimed: [] });
  assert.equal("totals" in without, false);
});

test("buildWrongEvent: kinds, ms and why", () => {
  const turn = turnOf({ startedAt: 5_000 });
  const deal: Deal = [LETTER_S, LANDLOCKED];
  const event = buildWrongEvent({ turn, deal, playerId: "a", code: "FR", why: "no_fit", at: 8_000 });
  assert.deepEqual(event.kinds, ["letter", "landlocked"]);
  assert.equal(event.ms, 3_000);
  assert.equal(event.why, "no_fit");
  assert.equal(event.code, "FR");
  const early = buildWrongEvent({ turn, deal: null, playerId: "a", code: "FR", why: "taken", at: 4_000 });
  assert.equal(early.ms, 0);
  assert.deepEqual(early.kinds, []);
});

test("buildStartRecord copies only id, name and host", () => {
  const players = [{ id: "a", name: "Ann", host: true, token: "SECRET" } as { id: string; name: string; host: boolean }];
  const record = buildStartRecord({ logId: "ABC234-1", room: "ABC234", startedAt: 1, turnSeconds: 15, rounds: 20, players, startCountries: { a: "FR" } });
  assert.equal(JSON.stringify(record).includes("SECRET"), false);
  assert.equal(record.v, 1);
  assert.equal(record.mode, "turns");
  assert.deepEqual(record.players, [{ id: "a", name: "Ann", host: true }]);
});

test("buildEndRecord: scores shape, winners, durationMs and sudden rounds", () => {
  const turn = turnOf({ number: 9, sudden: { order: ["a", "b"], startNumber: 8, round: 2, maxRounds: 3 } });
  const record = buildEndRecord({ reason: "turns_played", turn, scores: { a: SCORE(7), b: SCORE(9) }, winners: ["b"], startedAt: 1_000, endedAt: 61_000 });
  assert.equal(record.t, "end");
  assert.equal(record.turnsPlayed, 9);
  assert.equal(record.suddenRounds, 2);
  assert.deepEqual(record.winners, ["b"]);
  assert.deepEqual(record.scores.b, { points: 8, bonus: 1, total: 9, territory: 0 });
  assert.equal(record.durationMs, 60_000);
  const plain = buildEndRecord({ reason: "host_ended", turn: turnOf(), scores: {}, winners: [], startedAt: 5, endedAt: 1 });
  assert.equal(plain.suddenRounds, 0);
  assert.equal(plain.durationMs, 0);
});

test("queueLog and takeQueued: take empties the queue, owners are isolated", () => {
  const ownerA = {};
  const ownerB = {};
  const event = buildWrongEvent({ turn: turnOf(), deal: null, playerId: "a", code: "FR", why: "own", at: 1_100 });
  queueLog(ownerA, event);
  queueLog(ownerA, buildWrongEvent({ turn: turnOf(), deal: null, playerId: "a", code: "DE", why: "taken", at: 1_200 }));
  assert.equal(takeQueued(ownerB).length, 0);
  assert.equal(takeQueued(ownerA).length, 2);
  assert.equal(takeQueued(ownerA).length, 0);
  assert.deepEqual(takeQueued(ownerA), []);
});

test("parseGameLog accepts JSON strings and parsed objects, sorts, and counts bad fields", () => {
  const turn = (n: number) => ({ t: "turn", n, round: 1, sudden: false, pid: "a", outcome: "pass", ms: 1, at: n, unclaimed: 1, deal: null, fitBoth: null });
  const wrong = { t: "wrong", n: 1, round: 1, sudden: false, pid: "a", code: "FR", why: "no_fit", kinds: [], ms: 1, at: 900 };
  const hash: Record<string, unknown> = {
    "t:0002": JSON.stringify(turn(2)),
    "t:0000": turn(0),
    "t:0001": JSON.stringify(turn(1)),
    "w:0001:900:FR": JSON.stringify(wrong),
    "t:0003": "{not json",
    "x:1": { anything: true },
  };
  const log = parseGameLog("ABC234-1", hash);
  assert.equal(log.badFields, 2);
  assert.deepEqual(log.turns.map((t) => t.n), [0, 1, 2]);
  assert.equal(log.wrong.length, 1);
  assert.equal(log.start, null);
  assert.equal(log.end, null);
  assert.equal(log.logId, "ABC234-1");
});

test("flushQueuedLog writes one hset with every queued field and nothing when the queue is empty", async () => {
  const { calls, redis } = fakeRedis();
  const owner = {};
  const key = logKey("ABC234-1800000000000");
  await flushQueuedLog(redis, owner, "ABC234-1800000000000");
  assert.equal(calls.length, 0);

  queueLog(owner, buildTurnEvent({ turn: turnOf({ number: 0 }), deal: null, playerId: "a", outcome: "pass", at: 1_500, unclaimed: [] }));
  queueLog(owner, buildTurnEvent({ turn: turnOf({ number: 1 }), deal: null, playerId: "b", outcome: "timeout", at: 16_000, unclaimed: [] }));
  await flushQueuedLog(redis, owner, "ABC234-1800000000000");
  assert.deepEqual(calls.map((c) => c.cmd), ["hset"]);
  assert.equal(calls[0].args![0], key);
  assert.deepEqual(Object.keys(calls[0].args![1] as object), ["t:0000", "t:0001"]);

  const endOwner = {};
  const { calls: endCalls, redis: endRedis } = fakeRedis();
  queueLog(endOwner, buildEndRecord({ reason: "turns_played", turn: turnOf(), scores: {}, winners: [], startedAt: 1, endedAt: 2 }));
  await flushQueuedLog(endRedis, endOwner, "ABC234-1800000000000");
  assert.deepEqual(endCalls.map((c) => c.cmd), ["pipe.hset", "pipe.expire", "exec"]);
  assert.deepEqual(endCalls[1].args, [key, LOG_TTL_SECONDS]);
});

test("flushQueuedLog swallows a failing write, reports it, and does not write twice", async () => {
  const errors = mock.method(console, "error", () => {});
  const { calls, redis } = fakeRedis({ hset: async () => { throw new Error("boom"); } });
  const owner = {};
  queueLog(owner, buildWrongEvent({ turn: turnOf(), deal: null, playerId: "a", code: "FR", why: "own", at: 1_100 }));
  await assert.doesNotReject(flushQueuedLog(redis, owner, "ABC234-1800000000000"));
  assert.equal(errors.mock.callCount(), 1);
  assert.match(String(errors.mock.calls[0].arguments[0]), /Game log/);
  await flushQueuedLog(redis, owner, "ABC234-1800000000000");
  assert.equal(calls.filter((c) => c.cmd === "hset").length, 1);
});

test("flushQueuedLog gives up on a write that never finishes", async () => {
  const errors = mock.method(console, "error", () => {});
  const { redis } = fakeRedis({ hset: () => new Promise<never>(() => {}) });
  setLogTimeoutForTests(30);
  const owner = {};
  queueLog(owner, buildWrongEvent({ turn: turnOf(), deal: null, playerId: "a", code: "FR", why: "own", at: 1_100 }));
  const started = Date.now();
  await flushQueuedLog(redis, owner, "ABC234-1800000000000");
  assert.ok(Date.now() - started < 1_000);
  assert.equal(errors.mock.callCount(), 1);
});

test("flushQueuedLog does nothing when logging is off", async () => {
  process.env.GAME_LOGGING = "off";
  const { calls, redis } = fakeRedis();
  const owner = {};
  queueLog(owner, buildWrongEvent({ turn: turnOf(), deal: null, playerId: "a", code: "FR", why: "own", at: 1_100 }));
  await flushQueuedLog(redis, owner, "ABC234-1800000000000");
  assert.equal(calls.length, 0);
});

test("record fields are derived from the record", () => {
  const record: LogRecord = buildWrongEvent({ turn: turnOf({ number: 7 }), deal: null, playerId: "a", code: "FR", why: "no_fit", at: 5 });
  assert.equal(fieldOf(record), "w:0007:5:FR");
});
