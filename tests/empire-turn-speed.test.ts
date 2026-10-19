import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { NextRequest } from "next/server";
import type { Redis } from "@upstash/redis";
import { POST as roomPost, GET as roomGet } from "@/app/api/room/route";
import { setRedisForTests } from "@/lib/redis";
import { empireSnapshot, setEmpireRngForTests, type EmpireRoom } from "@/lib/empire-room";
import { actions } from "@/lib/empire/actions";
import { cards } from "@/lib/empire/cards";
import { geo } from "@/lib/empire/geo";
import { largestEmpireGroups, scoring } from "@/lib/empire/scoring";
import { DEFAULT_EMPIRE_TURN_SECONDS, EMPIRE_RULES, EMPIRE_TURN_SPEEDS, isEmpireTurnSeconds, type EmpireState } from "@/lib/empire/types";
import { MemoryRedis } from "./memory-redis";

type Session = { code: string; token: string; playerId: string; mode?: string; turnSeconds?: number };
type View = Record<string, any>;
const json = async (response: Response) => response.json() as Promise<View>;
const realNow = Date.now;
let store: MemoryRedis;
let clock = 1_800_000_000_000;

beforeEach(() => {
  store = new MemoryRedis();
  setRedisForTests(store as unknown as Redis);
  clock = 1_800_000_000_000;
  Date.now = () => clock;
  let seed = 9;
  setEmpireRngForTests(() => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; });
});
afterEach(() => { setRedisForTests(null); setEmpireRngForTests(null); Date.now = realNow; });

const postRoom = (body: Record<string, unknown>) => roomPost(new NextRequest("http://localhost/api/room", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
}));
const getRoom = async (session: Session) => json(await roomGet(new NextRequest(`http://localhost/api/room?code=${session.code}`, {
  headers: { authorization: `Bearer ${session.token}` }
})));
async function empireGame(extra: Record<string, unknown> = {}) {
  const host = await json(await postRoom({ action: "create", name: "Host", mode: "empire", ...extra })) as Session;
  const guest = await json(await postRoom({ action: "join", code: host.code, name: "Brian" })) as Session;
  const started = await json(await postRoom({ action: "start", code: host.code, token: host.token, name: "Host" }));
  return { host, guest, started };
}

test("Empire speeds are Blitz 15s, Standard 20s (the default) and Relaxed 30s", () => {
  assert.deepEqual(EMPIRE_TURN_SPEEDS.map((s) => [s.label, s.seconds]), [["Blitz", 15], ["Standard", 20], ["Relaxed", 30]]);
  assert.equal(DEFAULT_EMPIRE_TURN_SECONDS * 1000, EMPIRE_RULES.turnMs);
  assert.ok(isEmpireTurnSeconds(15) && isEmpireTurnSeconds(20) && isEmpireTurnSeconds(30));
  assert.ok(!isEmpireTurnSeconds(10) && !isEmpireTurnSeconds(25) && !isEmpireTurnSeconds("20"));
});

test("the host's Empire speed is validated, stored, shared with joiners and shown in every snapshot", async () => {
  const blitz = await json(await postRoom({ action: "create", name: "Host", mode: "empire", turnSeconds: 15 })) as Session;
  assert.equal(blitz.turnSeconds, 15);
  assert.equal(((await store.get<Record<string, unknown>>(`bran:room:${blitz.code}`))!).turnSeconds, 15);
  assert.equal((await json(await postRoom({ action: "join", code: blitz.code, name: "Brian" }))).turnSeconds, 15);
  assert.equal((await getRoom(blitz)).turnSeconds, 15, "the waiting room snapshot carries the speed");
  const started = await json(await postRoom({ action: "start", code: blitz.code, token: blitz.token, name: "Host" }));
  assert.equal(started.turnSeconds, 15);
  const view = await getRoom(blitz);
  assert.equal(view.empire.turnMs, 15_000);

  assert.equal((await json(await postRoom({ action: "create", name: "Host", mode: "empire" }))).turnSeconds, 20, "standard is the default");
  for (const bad of [10, 25, 0, "20", 20.5, null]) {
    assert.equal((await postRoom({ action: "create", name: "Host", mode: "empire", turnSeconds: bad })).status, 400, `rejects ${JSON.stringify(bad)}`);
  }
  // Each mode keeps its own options.
  assert.equal((await postRoom({ action: "create", name: "Host", mode: "turns", turnSeconds: 30 })).status, 400);
  assert.equal((await postRoom({ action: "create", name: "Host", mode: "turns", turnSeconds: 25 })).status, 200);
  const live = await json(await postRoom({ action: "create", name: "Host", mode: "live", turnSeconds: 30 }));
  assert.equal("turnSeconds" in live, false, "live rooms ignore the speed");
});

test("Empire timeouts follow the chosen speed and the default stays 20 seconds", async () => {
  const { host } = await empireGame({ turnSeconds: 15 });
  const first = (await getRoom(host)).empire.currentPlayerId;
  clock += 14_999;
  assert.equal((await getRoom(host)).empire.currentPlayerId, first, "15 seconds have not passed yet");
  clock += 1;
  const view = await getRoom(host);
  assert.notEqual(view.empire.currentPlayerId, first);
  assert.equal(view.empire.turnStartedAt, 1_800_000_000_000 + 15_000, "the clock keeps its 15s cadence");
  assert.equal(view.empire.turnMs, 15_000);

  clock = 1_800_000_000_000;
  const relaxed = await empireGame({ turnSeconds: 30 });
  const rFirst = (await getRoom(relaxed.host)).empire.currentPlayerId;
  clock += 29_999;
  assert.equal((await getRoom(relaxed.host)).empire.currentPlayerId, rFirst);
  clock += 1;
  assert.notEqual((await getRoom(relaxed.host)).empire.currentPlayerId, rFirst);

  clock = 1_800_000_000_000;
  const standard = await empireGame();
  const sFirst = (await getRoom(standard.host)).empire.currentPlayerId;
  clock += 19_999;
  assert.equal((await getRoom(standard.host)).empire.currentPlayerId, sFirst);
  clock += 1;
  const sView = await getRoom(standard.host);
  assert.notEqual(sView.empire.currentPlayerId, sFirst);
  assert.equal(sView.empire.turnMs, EMPIRE_RULES.turnMs);
});

const fakeDeps = () => ({ geo, cards, scoring, rng: () => 0.5 });

test("advanceTimeouts uses state.turnMs, falling back to the rule default for older saved games", () => {
  const deps = fakeDeps();
  const fast = actions.initEmpire(["p1", "p2"], 1000, deps, 5_000);
  assert.equal(fast.turnMs, 5_000);
  assert.equal(actions.advanceTimeouts(fast, 1000 + 4_999, deps), fast, "not expired yet");
  const moved = actions.advanceTimeouts(fast, 1000 + 5_000, deps);
  assert.notEqual(moved.seat, fast.seat);
  assert.equal(moved.turnStartedAt, 1000 + 5_000);

  const plain = actions.initEmpire(["p1", "p2"], 1000, deps);
  assert.equal("turnMs" in plain, false, "no turnMs is stored unless one is chosen");
  assert.equal(actions.advanceTimeouts(plain, 1000 + EMPIRE_RULES.turnMs - 1, deps), plain);
  assert.notEqual(actions.advanceTimeouts(plain, 1000 + EMPIRE_RULES.turnMs, deps).seat, plain.seat);
});

test("largestEmpireGroups finds each player's biggest connected group over land borders and sea routes", () => {
  const [seaA, seaB] = geo.seaRoutes()[0];
  const owners: Record<string, string> = { FR: "p1", DE: "p1", BE: "p1", ES: "p2", PT: "p2", [seaA]: "p3", [seaB]: "p3" };
  const players = ["p1", "p2", "p3"].map((id) => ({ id, capital: "", stealTokens: 0, forts: [] }));
  const groups = largestEmpireGroups({ players, owners }, geo);
  assert.deepEqual(groups.p1, ["BE", "DE", "FR"]);
  assert.deepEqual(groups.p2, ["ES", "PT"]);
  assert.deepEqual(groups.p3, [seaA, seaB].sort(), "a sea route links island countries");
  assert.deepEqual(largestEmpireGroups({ players: [...players, { id: "p4", capital: "", stealTokens: 0, forts: [] }], owners }, geo).p4, []);
  // The group size is the one the largest-empire bonus uses.
  const result = scoring.scoreEmpire({ players, owners, empireHolder: null, log: [] }, geo);
  for (const id of ["p1", "p2", "p3"]) assert.equal(result.scores[id].empireSize, groups[id].length);
});

test("the Empire snapshot includes each player's largest empire for the map outline", () => {
  const empire: EmpireState = actions.initEmpire(["a", "b"], 1000, fakeDeps());
  empire.owners = { FR: "a", DE: "a", BE: "a", JP: "a", ES: "b" };
  const room: EmpireRoom = {
    code: "ABCDEF", gameId: "countries", mode: "empire", status: "playing", startedAt: 1000,
    players: ["a", "b"].map((id) => ({ id, token: "x".repeat(40), name: id, host: id === "a" })), empire
  };
  const view = empireSnapshot(room, 2000).empire!;
  assert.deepEqual(view.largestGroups!.a, ["BE", "DE", "FR"]);
  assert.deepEqual(view.largestGroups!.b, ["ES"]);
  assert.equal(view.turnMs, EMPIRE_RULES.turnMs);
  room.empire = { ...empire, turnMs: 30_000 };
  assert.equal(empireSnapshot(room, 2000).empire!.turnMs, 30_000);
});
