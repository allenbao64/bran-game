import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { NextRequest } from "next/server";
import type { Redis } from "@upstash/redis";
import { POST as roomPost, GET as roomGet } from "@/app/api/room/route";
import { POST as empire2Post, GET as empire2Get } from "@/app/api/empire2/route";
import { setRedisForTests } from "@/lib/redis";
import { EMPIRE2_CAS_SCRIPT, loadSyncedEmpire2Room, normalizeEmpire2State, setEmpire2RngForTests } from "@/lib/empire2-room";
import { empire2Geo, type EmpireState } from "@/lib/empire2";
import { MemoryRedis } from "./memory-redis";

type Session = { code: string; token: string; playerId: string; name: string };
type View = Record<string, any>;
const json = async (response: Response) => response.json() as Promise<View>;
const realNow = Date.now;
const CLOCK_START = 1_800_000_000_000;
/** A seed under which the naive move policy below wins on points (see the test of the same name). */
const FULL_GAME_SEED = 42;
let store: MemoryRedis;
let clock = CLOCK_START;

/** mulberry32: a small seeded generator, so each seed plays out the same way every run. */
function seedRng(seed: number) {
  let state = seed >>> 0;
  setEmpire2RngForTests(() => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
}

beforeEach(() => {
  store = new MemoryRedis();
  setRedisForTests(store as unknown as Redis);
  clock = CLOCK_START;
  Date.now = () => clock;
  seedRng(FULL_GAME_SEED);
});
afterEach(() => {
  setRedisForTests(null);
  setEmpire2RngForTests(null);
  Date.now = realNow;
});

const postRoom = (body: Record<string, unknown>) => roomPost(new NextRequest("http://localhost/api/room", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
}));
const getRoom = async (session: Session) => json(await roomGet(new NextRequest(`http://localhost/api/room?code=${session.code}`, {
  headers: { authorization: `Bearer ${session.token}` },
})));
const viewOf = async (session: Session) => (await getRoom(session)).empire2 as View;
const act = (session: Session, action: Record<string, unknown>) => empire2Post(new NextRequest("http://localhost/api/empire2", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: session.code, token: session.token, action }),
}));
const getLog = (session: Session) => empire2Get(new NextRequest(`http://localhost/api/empire2?code=${session.code}`, {
  headers: { authorization: `Bearer ${session.token}` },
}));
const roomKey = (code: string) => `bran:room:${code}`;
const other = (sessions: Session[], session: Session) => sessions.find((s) => s !== session)!;
const sessionFor = (sessions: Session[], playerId: string | null) => sessions.find((s) => s.playerId === playerId)!;
const capitalOf = (code: string) => empire2Geo.capitalsOf(code)[0];

/** Creates an Empire 2.0 room, joins the other players, and starts it. The host is the first session. */
async function empire2Game(players = 2, options: Record<string, unknown> = {}) {
  const host = await json(await postRoom({ action: "create", name: "Host", mode: "empire2", ...options })) as Session;
  const sessions: Session[] = [host];
  for (const name of ["Brian", "Casey", "Dana"].slice(0, players - 1)) {
    sessions.push(await json(await postRoom({ action: "join", code: host.code, name })) as Session);
  }
  assert.equal((await postRoom({ action: "start", code: host.code, token: host.token, name: "Host" })).status, 200);
  return sessions;
}

/** The naive move policy: first expand, then city, then colonize, else end the turn. Picks the first offer and footholds. */
function chooseMove(view: View): Record<string, unknown> {
  if (view.phase === "capital") return { type: "pickCapital", code: view.setup.offers[0] };
  if (view.phase === "foothold") return { type: "pickFoothold", code: view.setup.footholds[0] };
  if (view.legal?.expand.length) return { type: "expand", code: view.legal.expand[0] };
  if (view.legal?.city.length) return { type: "city", code: view.legal.city[0], capital: capitalOf(view.legal.city[0]) };
  if (view.legal?.colonize.length) return { type: "colonize", code: view.legal.colonize[0] };
  return { type: "endTurn" };
}

/** Picks through the setup with the naive policy until the game is out of setup (playing, or boom pick). */
async function finishSetup(sessions: Session[]): Promise<View> {
  for (let step = 0; step < 20; step++) {
    const view = await viewOf(sessions[0]);
    if (view.phase !== "capital" && view.phase !== "foothold") return view;
    const picker = sessionFor(sessions, view.currentPlayerId);
    const mine = await viewOf(picker);
    assert.equal((await act(picker, chooseMove(mine))).status, 200);
  }
  throw new Error("setup did not finish");
}

/** Plays the naive policy until the current player's view satisfies the predicate. */
async function playUntil(sessions: Session[], predicate: (view: View) => boolean): Promise<{ session: Session; view: View }> {
  for (let step = 0; step < 400; step++) {
    const view = await viewOf(sessions[0]);
    assert.notEqual(view.phase, "ended", "the game ended before the predicate held");
    const session = sessionFor(sessions, view.currentPlayerId);
    const mine = await viewOf(session);
    if (predicate(mine)) return { session, view: mine };
    assert.equal((await act(session, chooseMove(mine))).status, 200);
  }
  throw new Error("the predicate never held");
}

/** Lua's JSON encoder turns empty arrays into {}: the same change a host end makes to the stored room. */
function luaEncoded(value: unknown): unknown {
  if (Array.isArray(value)) return value.length === 0 ? {} : value.map(luaEncoded);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, luaEncoded(v)]));
  return value;
}

test("a 2-player empire2 game runs from setup to a points win through the API", async (t) => {
  const sessions = await empire2Game(2, { turnSeconds: 20 });
  let requests = 0;
  let view = await viewOf(sessions[0]);
  requests++;
  while (requests < 3000) {
    view = await viewOf(sessions[0]);
    requests++;
    if (view.phase === "ended") break;
    const session = sessionFor(sessions, view.currentPlayerId);
    const mine = await viewOf(session);
    requests++;
    let response = await act(session, chooseMove(mine));
    requests++;
    if (response.status !== 200) {
      response = await act(session, { type: "endTurn" });
      requests++;
      assert.equal(response.status, 200, JSON.stringify(await json(response)));
    }
  }
  view = await viewOf(sessions[0]);
  assert.equal(view.phase, "ended", `the game did not end within ${requests} requests`);
  assert.equal(view.result.reason, "points");
  assert.equal(view.result.winnerIds.length, 1);
  const winner = view.players.find((p: View) => p.id === view.result.winnerIds[0]);
  assert.ok(winner.vp.total >= 16, `winner has ${winner.vp.total} points`);
  const size = JSON.stringify(await store.get(roomKey(sessions[0].code))).length;
  t.diagnostic(`game ended in round ${view.round} after ${requests} requests; room JSON ${size} bytes`);
  assert.ok(size < 200_000, `room JSON is ${size} bytes`);
});

test("a 3-player setup picks capitals in seat order and footholds in reverse", async () => {
  const sessions = await empire2Game(3);
  await viewOf(sessions[0]);
  const room = (await store.get<View>(roomKey(sessions[0].code)))!;
  const seatOf = Object.fromEntries((room.empire2 as View).players.map((p: View) => [p.id, p.seat]));
  const capitalSeats: number[] = [];
  const footholdSeats: number[] = [];
  for (let step = 0; step < 6; step++) {
    const view = await viewOf(sessions[0]);
    if (view.phase !== "capital" && view.phase !== "foothold") break;
    const picker = sessionFor(sessions, view.currentPlayerId);
    for (const session of sessions) {
      const seen = await viewOf(session);
      if (session === picker) {
        assert.ok(seen.setup.offers !== null || seen.setup.footholds !== null, "the picker sees the choices");
      } else {
        assert.equal(seen.setup.offers, null, "offers are shown to the picker only");
        assert.equal(seen.setup.footholds, null, "footholds are shown to the picker only");
      }
    }
    if (view.phase === "capital") capitalSeats.push(seatOf[picker.playerId]);
    else footholdSeats.push(seatOf[picker.playerId]);
    const mine = await viewOf(picker);
    assert.equal((await act(picker, chooseMove(mine))).status, 200);
  }
  assert.deepEqual(capitalSeats, [0, 1, 2]);
  assert.deepEqual(footholdSeats, [2, 1, 0]);
});

test("a fourth player can join an empire2 room and a fifth cannot", async () => {
  const host = await json(await postRoom({ action: "create", name: "Host", mode: "empire2" })) as Session;
  for (const name of ["Brian", "Casey", "Dana"]) {
    assert.equal((await postRoom({ action: "join", code: host.code, name })).status, 200, `${name} joins`);
  }
  const fifth = await postRoom({ action: "join", code: host.code, name: "Eve" });
  assert.equal(fifth.status, 400);
  assert.equal((await json(fifth)).error, "This room is full.");
});

test("other modes still cap rooms at three players", async () => {
  for (const mode of ["turns", "empire", "live"]) {
    const host = await json(await postRoom({ action: "create", name: "Host", ...(mode === "live" ? {} : { mode }) })) as Session;
    for (const name of ["Brian", "Casey"]) assert.equal((await postRoom({ action: "join", code: host.code, name })).status, 200);
    const fourth = await postRoom({ action: "join", code: host.code, name: "Dana" });
    assert.equal(fourth.status, 400, `${mode} room`);
    assert.equal((await json(fourth)).error, "This room is full.");
    if (mode === "empire") {
      assert.equal((await postRoom({ action: "start", code: host.code, token: host.token, name: "Host" })).status, 200);
      const view = await getRoom(host);
      assert.equal("empire2" in view, false, "Empire 1 rooms never carry an empire2 view");
    }
  }
});

test("every action type is accepted when legal and rejected with the right status", async () => {
  const sessions = await empire2Game(2);
  const expectError = async (session: Session, action: Record<string, unknown>, status: number, message: string) => {
    const response = await act(session, action);
    const body = await json(response);
    assert.equal(response.status, status, `${JSON.stringify(action)}: ${JSON.stringify(body)}`);
    assert.equal(body.error, message);
  };

  // Setup: a wrong player, an unknown and an unoffered country, then the accepted capital.
  let view = await viewOf(sessions[0]);
  const first = sessionFor(sessions, view.currentPlayerId);
  const second = other(sessions, first);
  const offers = (await viewOf(first)).setup.offers as string[];
  await expectError(second, { type: "pickCapital", code: offers[0] }, 409, "It's not your turn.");
  await expectError(first, { type: "pickCapital", code: "ZZ" }, 400, "That isn't a country in the game.");
  const unoffered = empire2Geo.codes().find((code) => !offers.includes(code))!;
  await expectError(first, { type: "pickCapital", code: unoffered }, 400, "Pick one of the three offered countries.");
  assert.equal((await act(first, { type: "pickCapital", code: offers[0] })).status, 200, "pickCapital when offered");
  assert.equal((await act(second, { type: "pickCapital", code: (await viewOf(second)).setup.offers[0] })).status, 200);

  // Footholds: the last capital picker goes first. The waiting player is refused; a rival's country is taken.
  view = await viewOf(sessions[0]);
  const footholder = sessionFor(sessions, view.currentPlayerId);
  const waiter = other(sessions, footholder);
  const waiterCapital = (await viewOf(waiter)).players.find((p: View) => p.id === waiter.playerId).capital as string;
  await expectError(waiter, { type: "pickFoothold", code: waiterCapital }, 409, "It's not your turn.");
  await expectError(footholder, { type: "pickFoothold", code: waiterCapital }, 409, "That country is already taken.");
  await expectError(footholder, { type: "pickFoothold", code: "ZZ" }, 400, "That isn't a country in the game.");
  assert.equal((await act(footholder, chooseMove(await viewOf(footholder)))).status, 200, "pickFoothold when legal");
  assert.equal((await act(waiter, chooseMove(await viewOf(waiter)))).status, 200);

  // Round one: the turn player.
  view = await viewOf(sessions[0]);
  assert.equal(view.phase, "playing");
  const turnPlayer = sessionFor(sessions, view.currentPlayerId);
  const rival = other(sessions, turnPlayer);
  const mine = await viewOf(turnPlayer);
  await expectError(rival, { type: "expand", code: "FR" }, 409, "It's not your turn.");
  await expectError(turnPlayer, { type: "expand", code: "ZZ" }, 400, "That isn't a country in the game.");
  const notFrontier = empire2Geo.codes().find((code) => !mine.frontier.includes(code) && !mine.owners[code])!;
  await expectError(turnPlayer, { type: "expand", code: notFrontier }, 409, "That country doesn't touch your empire.");
  await expectError(turnPlayer, { type: "pickCapital", code: "FR" }, 409, "That can't be done right now.");
  await expectError(turnPlayer, { type: "nope" }, 400, "That action isn't valid.");
  assert.equal((await act(turnPlayer, { type: "expand", code: mine.legal.expand[0] })).status, 200, "the first expand is free");
  const afterFirst = await viewOf(turnPlayer);
  assert.equal((await act(turnPlayer, { type: "expand", code: afterFirst.legal.expand[0] })).status, 200, "the second expand costs 1");
  const afterSecond = await viewOf(turnPlayer);
  await expectError(turnPlayer, { type: "expand", code: afterSecond.frontier[0] }, 409, "You can only expand 2 times a turn.");

  // A country the player owns: the wrong capital is refused, the right one builds a city.
  const owned = Object.keys(afterSecond.owners).filter((code) => afterSecond.owners[code] === turnPlayer.playerId);
  const rivalOwned = Object.keys(afterSecond.owners).filter((code) => afterSecond.owners[code] === rival.playerId);
  assert.ok(owned.length > 0 && rivalOwned.length > 0);
  await expectError(turnPlayer, { type: "city", code: owned[0], capital: "Nowhere" }, 400, "That's not the capital city of that country.");
  await expectError(turnPlayer, { type: "city", code: rivalOwned[0], capital: capitalOf(rivalOwned[0]) }, 409, "You don't own that country.");
  await expectError(turnPlayer, { type: "annex", code: notFrontier, capital: "Nowhere" }, 409, "Name a country a rival owns.");
  assert.equal((await act(turnPlayer, { type: "city", code: owned[0], capital: capitalOf(owned[0]) })).status, 200, "city when legal");
  await expectError(turnPlayer, { type: "colonize", code: notFrontier }, 409, "Not enough influence.");
  assert.equal((await act(turnPlayer, { type: "endTurn" })).status, 200, "endTurn when it is the player's turn");

  // Later rounds: colonize and annex once they are legal. The naive policy reaches both within a few rounds.
  const colonizer = await playUntil(sessions, (v) => v.legal !== null && v.legal.colonize.length > 0);
  assert.equal((await act(colonizer.session, { type: "colonize", code: colonizer.view.legal.colonize[0] })).status, 200, "colonize when legal");
  const annexer = await playUntil(sessions, (v) => v.legal !== null && v.legal.annex.length > 0);
  const target = annexer.view.legal.annex[0];
  assert.equal((await act(annexer.session, { type: "annex", code: target, capital: capitalOf(target) })).status, 200, "annex when legal");

  // Boom pick: a separate room, where the picker's pickBoom is accepted.
  const boomSessions = await empire2Game(2, { underdogBoomPick: true });
  const boomView = await finishSetup(boomSessions);
  assert.equal(boomView.phase, "boomPick");
  const picker = sessionFor(boomSessions, boomView.boomPick.playerId);
  assert.equal((await act(picker, { type: "pickBoom", region: boomView.boomPick.regions[0] })).status, 200, "pickBoom when pending");
});

test("turn timeouts apply lazily on GET", async () => {
  const sessions = await empire2Game(2);
  await finishSetup(sessions);
  const before = await viewOf(sessions[0]);
  const first = before.currentPlayerId;
  clock += before.turnMs + 1;
  const after = await viewOf(sessions[0]);
  assert.notEqual(after.currentPlayerId, first, "the turn passed to the other player");
  assert.equal(after.turn.playerId, other(sessions, sessionFor(sessions, first)).playerId);
  assert.ok(after.log.some((line: string) => /time ran out/i.test(line)), after.log.join(" | "));
});

test("a waiting Empire 2.0 room returns underdogBoomPick to a joiner", async () => {
  for (const pick of [true, false]) {
    const host = await json(await postRoom({ action: "create", name: "Host", mode: "empire2", underdogBoomPick: pick })) as Session;
    const joiner = await json(await postRoom({ action: "join", code: host.code, name: "Brian" })) as Session;
    assert.equal((await getRoom(joiner)).underdogBoomPick, pick, `boom pick ${pick}`);
  }
  const live = await json(await postRoom({ action: "create", name: "Host" })) as Session;
  const liveRoom = await getRoom(live);
  assert.equal(Object.prototype.hasOwnProperty.call(liveRoom, "underdogBoomPick"), false, "a live-race room has no boom key");
});

test("a turn that runs out logs a Time ran out line", async () => {
  const sessions = await empire2Game(2);
  await finishSetup(sessions);
  const before = await viewOf(sessions[0]);
  clock += before.turnMs + 1;
  const after = await viewOf(sessions[0]);
  const line = after.log.find((entry: string) => entry.startsWith("Time ran out. "));
  assert.ok(line, after.log.join(" | "));
  assert.match(line, /'s turn ended\.$/);
});

test("a compare-and-set conflict is retried and the action applies once", async () => {
  const sessions = await empire2Game(2);
  await finishSetup(sessions);
  const player = sessionFor(sessions, (await viewOf(sessions[0])).currentPlayerId);
  const mine = await viewOf(player);
  const versionBefore = (await store.get<View>(roomKey(sessions[0].code)))!.empire2Version as number;
  const ownersBefore = Object.keys(mine.owners).length;
  let injected = false;
  const eval_ = store.eval.bind(store);
  store.eval = async (script: string, keys: string[], args: string[]) => {
    if (!injected && script.includes("room.empire2Version")) {
      // Another request wins the race: the stored version moves on by one, so this write must conflict.
      injected = true;
      const stored = (await store.get<View>(roomKey(sessions[0].code)))!;
      stored.empire2Version = (stored.empire2Version as number) + 1;
      await store.set(roomKey(sessions[0].code), stored);
      return { conflict: true };
    }
    return eval_(script, keys, args);
  };
  const response = await act(player, { type: "expand", code: mine.legal.expand[0] });
  store.eval = eval_;
  assert.equal(response.status, 200, JSON.stringify(await json(response)));
  assert.ok(injected, "the conflict was injected");
  const versionAfter = (await store.get<View>(roomKey(sessions[0].code)))!.empire2Version as number;
  assert.equal(versionAfter - versionBefore, 2, "one conflict, one success");
  assert.equal(Object.keys((await viewOf(player)).owners).length, ownersBefore + 1, "the expand happened once");
});

test("with the boom pick on, only the picker may act, and the pick sets the round's booms", async () => {
  const sessions = await empire2Game(2, { underdogBoomPick: true });
  const view = await finishSetup(sessions);
  assert.equal(view.phase, "boomPick");
  assert.equal(view.boomPick.by, null);
  const picker = sessionFor(sessions, view.boomPick.playerId);
  const waiter = other(sessions, picker);
  const region = view.boomPick.regions[0];
  const refused = await act(waiter, { type: "pickBoom", region });
  assert.equal(refused.status, 409);
  assert.equal((await json(refused)).error, "Only the player picking this round's boom can act now.");
  const first = await act(picker, { type: "expand", code: "FR" });
  assert.equal(first.status, 409);
  assert.equal((await json(first)).error, "Pick this round's boom region first.");
  assert.equal((await act(picker, { type: "pickBoom", region })).status, 200);
  const after = await viewOf(picker);
  assert.ok(after.booms.includes(region), "the picked region booms this round");
  assert.equal(after.phase, "playing");
});

test("with the boom pick on, a timed-out pick is made by the engine", async () => {
  const sessions = await empire2Game(2, { underdogBoomPick: true });
  const view = await finishSetup(sessions);
  clock += view.turnMs + 1;
  const after = await viewOf(sessions[0]);
  assert.equal(after.phase, "playing");
  assert.equal(after.boomPick.by, "timeout");
  assert.ok(after.log.some((line: string) => line.includes("Time ran out.")), after.log.join(" | "));
});

test("with the boom pick off, round one has no boom pick and draws booms at round start", async () => {
  const sessions = await empire2Game(2);
  const setup = await viewOf(sessions[0]);
  assert.equal(setup.phase, "capital");
  assert.equal(setup.boomPick, null);
  const playing = await finishSetup(sessions);
  assert.equal(playing.phase, "playing");
  assert.equal(playing.boomPick, null);
  assert.equal(playing.booms.length, 3);
});

test("the log endpoint is members-only", async () => {
  const sessions = await empire2Game(2);
  await finishSetup(sessions);
  const noToken = await empire2Get(new NextRequest(`http://localhost/api/empire2?code=${sessions[0].code}`));
  assert.equal(noToken.status, 401);
  const stranger = await empire2Game(2);
  const wrongRoom = await empire2Get(new NextRequest(`http://localhost/api/empire2?code=${sessions[0].code}`, {
    headers: { authorization: `Bearer ${stranger[0].token}` },
  }));
  assert.equal(wrongRoom.status, 403);
  const member = await getLog(sessions[1]);
  assert.equal(member.status, 200);
  const body = await json(member);
  assert.ok(Array.isArray(body.log));
  assert.ok(body.log.some((entry: View) => entry.type === "roundStart"));
  assert.equal(body.rules.winPoints, 16);
  assert.equal(body.rules.maxExpandsPerTurn, 2);
  assert.equal(body.rules.turnOrder, "leaderLast");
});

test("a host end freezes the game and shows hostEnded results", async () => {
  const sessions = await empire2Game(2);
  await finishSetup(sessions);
  const host = sessions[0];
  const ended = await postRoom({ action: "end", code: host.code, token: host.token, name: "Host" });
  assert.equal(ended.status, 200);
  const view = await viewOf(host);
  assert.equal(view.phase, "ended");
  assert.equal(view.result.reason, "hostEnded");
  assert.ok(view.result.winnerIds.length >= 1);
  const player = sessions[1];
  const response = await act(player, chooseMove(await viewOf(player)));
  assert.equal(response.status, 409);
  assert.equal((await json(response)).error, "The game is over.");
  const log = await json(await getLog(host));
  assert.equal(log.endedBy, "host");
  assert.equal(log.result, null);
});

test("the host end does not break array fields (R1)", async () => {
  const sessions = await empire2Game(2);
  await finishSetup(sessions);
  await viewOf(sessions[0]);
  await postRoom({ action: "end", code: sessions[0].code, token: sessions[0].token, name: "Host" });
  const key = roomKey(sessions[0].code);
  // The Lua scripts re-encode the room on end, so empty arrays come back as {}. Reproduce that on the stored room.
  await store.set(key, luaEncoded((await store.get<View>(key))!));
  const stored = (await store.get<View>(key))!.empire2 as View;
  assert.equal(Array.isArray(stored.cities), false, "the Lua encoding turned the empty cities list into an object");
  const log = await json(await getLog(sessions[0]));
  assert.ok(Array.isArray(log.log));
  assert.ok(Array.isArray(log.players));
  assert.ok(Array.isArray(log.roundVp));
  assert.ok(Array.isArray(log.finalState.cities));
  assert.ok(Array.isArray(log.finalState.booms));
  assert.ok(Array.isArray(log.finalState.players));
  assert.equal(typeof log.finalState.owners, "object");
  assert.equal(Array.isArray(log.finalState.owners), false);
  const view = await viewOf(sessions[1]);
  assert.ok(Array.isArray(view.cities));
  assert.ok(Array.isArray(view.booms));
  assert.ok(Array.isArray(view.players));
  assert.ok(Array.isArray(view.log));
});

test("the host end during setup does not break array fields (R1, setup)", async () => {
  const sessions = await empire2Game(2);
  const key = roomKey(sessions[0].code);
  assert.equal((await viewOf(sessions[0])).phase, "capital");
  assert.equal((await postRoom({ action: "end", code: sessions[0].code, token: sessions[0].token, name: "Host" })).status, 200);
  await store.set(key, luaEncoded((await store.get<View>(key))!));
  assert.equal(Array.isArray((await store.get<View>(key))!.empire2!.booms), false, "the Lua encoding turned the empty booms list into an object");
  const log = await json(await getLog(sessions[0]));
  assert.equal(log.endedBy, "host");
  assert.ok(Array.isArray(log.log));
  assert.ok(Array.isArray(log.roundVp));
  assert.ok(Array.isArray(log.finalState.booms));
  const view = await viewOf(sessions[1]);
  assert.equal(view.phase, "ended");
  assert.ok(Array.isArray(view.booms));
  assert.ok(Array.isArray(view.cities));
});

/** The array fields the engine reads, emptied, as the Lua encoder would receive them (every [] becomes {} after luaEncoded). */
function withEmptyArrays(state: View): View {
  const out: View = { ...state, waitingWin: [], booms: [], bounties: [], cities: [], log: [] };
  if (state.reliefUsed !== undefined) out.reliefUsed = [];
  if (state.setup) out.setup = { ...state.setup, order: [], offers: [] };
  if (state.turn) out.turn = { ...state.turn, actions: [] };
  if (state.result) out.result = { ...state.result, winners: [] };
  return out;
}

function assertNormalised(state: View, name: string) {
  for (const field of ["waitingWin", "booms", "bounties", "cities", "log"]) assert.ok(Array.isArray(state[field]), `${name}: ${field} is an array`);
  if (state.reliefUsed !== undefined) assert.ok(Array.isArray(state.reliefUsed), `${name}: reliefUsed is an array`);
  if (state.setup) for (const field of ["order", "offers"]) assert.ok(Array.isArray(state.setup[field]), `${name}: setup.${field} is an array`);
  if (state.turn) assert.ok(Array.isArray(state.turn.actions), `${name}: turn.actions is an array`);
  if (state.result) assert.ok(Array.isArray(state.result.winners), `${name}: result.winners is an array`);
  for (const field of ["owners", "roundStartVp"]) {
    assert.equal(typeof state[field], "object", `${name}: ${field} is an object`);
    assert.equal(Array.isArray(state[field]), false, `${name}: ${field} is not an array`);
  }
}

/** Plays the naive policy until the engine reports the game finished. */
async function playToEnd(sessions: Session[]) {
  for (let step = 0; step < 3000; step++) {
    const view = await viewOf(sessions[0]);
    if (view.phase === "ended") return;
    const session = sessionFor(sessions, view.currentPlayerId);
    const mine = await viewOf(session);
    let response = await act(session, chooseMove(mine));
    if (response.status !== 200) response = await act(session, { type: "endTurn" });
    assert.equal(response.status, 200);
  }
  throw new Error("the game did not end");
}

test("normalisation restores every array field Lua turns into objects", async () => {
  const sessions = await empire2Game(2);
  const key = roomKey(sessions[0].code);
  await viewOf(sessions[0]);
  const setupRoom = (await store.get<View>(key))!;
  await finishSetup(sessions);
  const playRoom = (await store.get<View>(key))!;
  await playToEnd(sessions);
  const endedRoom = (await store.get<View>(key))!;
  assert.equal(setupRoom.empire2!.phase, "setup");
  assert.ok(playRoom.empire2!.turn, "the play-phase state has a turn");
  assert.equal(endedRoom.empire2!.phase, "finished");
  for (const [name, room] of [["setup", setupRoom], ["play", playRoom], ["finished", endedRoom]] as const) {
    const encoded = luaEncoded({ ...room, empire2: withEmptyArrays(room.empire2 as View), empire2RoundVp: [] }) as View;
    assert.equal(Array.isArray(encoded.empire2.booms), false, `${name}: the encoding turned booms into an object`);
    assertNormalised(normalizeEmpire2State(encoded.empire2 as EmpireState) as View, `${name} (normalizeEmpire2State)`);
    await store.set(key, encoded);
    const loaded = (await loadSyncedEmpire2Room(store as unknown as Redis, key, clock))!;
    assertNormalised(loaded.empire2 as View, `${name} (room load)`);
    assert.ok(Array.isArray(loaded.empire2RoundVp), `${name}: empire2RoundVp is an array`);
  }
});

test("create rejects bad empire2 options", async () => {
  const badSpeed = await postRoom({ action: "create", name: "Host", mode: "empire2", turnSeconds: 15 });
  assert.equal(badSpeed.status, 400);
  assert.equal((await json(badSpeed)).error, "Choose a turn time of 20, 30 or 45 seconds, or no time limit.");
  const badBoom = await postRoom({ action: "create", name: "Host", mode: "empire2", underdogBoomPick: "yes" });
  assert.equal(badBoom.status, 400);
  assert.equal((await json(badBoom)).error, "Choose whether the lowest player picks the boom region.");
});

test("a view never carries another player's token or offers", async () => {
  const sessions = await empire2Game(2);
  const view = await viewOf(sessions[0]);
  const picker = sessionFor(sessions, view.currentPlayerId);
  const rival = other(sessions, picker);
  const pickerOffers = (await viewOf(picker)).setup.offers as string[];
  assert.ok(pickerOffers.length > 0, "the picker has offers");
  const rivalText = JSON.stringify(await getRoom(rival));
  assert.equal(rivalText.includes(picker.token), false, "the rival's view has no picker token");
  assert.equal(rivalText.includes(rival.token), false, "the rival's view has no own token either");
  assert.equal((await viewOf(rival)).setup.offers, null);
  assert.equal(JSON.stringify(await getRoom(picker)).includes(rival.token), false, "the picker's view has no rival token");
  await finishSetup(sessions);
  for (const session of sessions) {
    const text = JSON.stringify(await getRoom(session));
    for (const rivalSession of sessions) if (rivalSession !== session) assert.equal(text.includes(rivalSession.token), false);
  }
});

test("a 2-player game records one round-start points entry per round, matching the engine snapshot", async () => {
  const sessions = await empire2Game(2);
  const expected = new Map<number, Record<string, number>>();
  const observe = async () => {
    const stored = (await store.get<View>(roomKey(sessions[0].code)))!.empire2 as View | undefined;
    if (stored && stored.phase !== "setup" && stored.round >= 1 && !expected.has(stored.round)) {
      expected.set(stored.round, { ...stored.roundStartVp });
    }
  };
  let view = await viewOf(sessions[0]);
  await observe();
  for (let step = 0; step < 3000; step++) {
    view = await viewOf(sessions[0]);
    await observe();
    if (view.phase === "ended") break;
    const session = sessionFor(sessions, view.currentPlayerId);
    const mine = await viewOf(session);
    let response = await act(session, chooseMove(mine));
    if (response.status !== 200) response = await act(session, { type: "endTurn" });
    assert.equal(response.status, 200);
    await observe();
  }
  assert.equal(view.phase, "ended");
  const log = await json(await getLog(sessions[0]));
  const roundStarts = log.log.filter((entry: View) => entry.type === "roundStart");
  assert.equal(log.roundVp.length, roundStarts.length, "one entry per round started");
  assert.equal(expected.size, roundStarts.length);
  for (const entry of log.roundVp as { round: number; vp: Record<string, number> }[]) {
    assert.deepEqual(entry.vp, expected.get(entry.round), `round ${entry.round} values equal the engine snapshot`);
  }
  assert.deepEqual(log.roundVp.map((entry: View) => entry.round), [...expected.keys()].sort((a, b) => a - b));
});

test("a setup pick that runs out of time is made by the server (R2)", async () => {
  const sessions = await empire2Game(2);
  const first = await viewOf(sessions[0]);
  assert.equal(first.phase, "capital");
  const picker = sessionFor(sessions, first.currentPlayerId);
  const offered = first.setup.offers[0];
  clock += first.turnMs + 1;
  const later = await viewOf(sessions[0]);
  assert.equal(later.phase, "capital", "the next capital pick is due");
  assert.notEqual(later.currentPlayerId, picker.playerId, "the pick passed to the other player");
  assert.equal(later.owners[offered], picker.playerId, "the server took the first offer for the timed-out player");
  assert.equal((await viewOf(picker)).players.find((p: View) => p.id === picker.playerId).capital, offered);
});

test("a 4-player game gives every player a different colour", async () => {
  const sessions = await empire2Game(4);
  const view = await viewOf(sessions[0]);
  assert.equal(view.phase, "capital");
  assert.equal(view.players.length, 4);
  const colors: string[] = view.players.map((p: View) => p.color);
  assert.equal(new Set(colors).size, 4, colors.join(", "));
});

test("the compare-and-set writes only when version and status match", async () => {
  const sessions = await empire2Game(2);
  const key = roomKey(sessions[0].code);
  await viewOf(sessions[0]);
  const stored = (await store.get<View>(key))!;
  const version = stored.empire2Version as number;
  assert.ok(version >= 1, "the first read stored a version");
  // Argument order as in commit(): expected version, the new room JSON, the TTL.
  const cas = async (storeKey: string, expected: number, room: View) => {
    const result = await store.eval(EMPIRE2_CAS_SCRIPT, [storeKey], [String(expected), JSON.stringify(room), "3600"]);
    return (typeof result === "string" ? JSON.parse(result) : result) as { ok?: boolean; conflict?: boolean; error?: string };
  };
  const next = { ...stored, empire2Version: version + 1 };
  assert.deepEqual(await cas(key, version - 1, next), { conflict: true }, "a stale version conflicts");
  assert.deepEqual(await store.get(key), stored, "a conflict writes nothing");
  for (const status of ["ended", "waiting"]) {
    await store.set(key, { ...stored, status });
    assert.deepEqual(await cas(key, version, next), { conflict: true }, `status ${status} conflicts`);
  }
  await store.set(key, stored);
  assert.deepEqual(await cas(key, version, next), { ok: true }, "the right version and status write");
  assert.equal((await store.get<View>(key))!.empire2Version, version + 1, "the stored room is updated");
  assert.deepEqual(await cas("bran:room:NOPE12", version, next), { error: "Room not found." }, "a missing key");
});

test("an action uses the token's player, never a player id in the body", async () => {
  const sessions = await empire2Game(2);
  const key = roomKey(sessions[0].code);
  const forge = (from: Session, playerId: string, action: Record<string, unknown>) => empire2Post(new NextRequest("http://localhost/api/empire2", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: from.code, token: from.token, playerId, action }),
  }));
  // Setup: the rival (not the current picker) names the picker in the body.
  const setupView = await viewOf(sessions[0]);
  const picker = sessionFor(sessions, setupView.currentPlayerId);
  const rival = other(sessions, picker);
  const offer = (await viewOf(picker)).setup.offers[0] as string;
  const before = JSON.stringify(await store.get(key));
  const refused = await forge(rival, picker.playerId, { type: "pickCapital", code: offer });
  assert.equal(refused.status, 409);
  assert.equal((await json(refused)).error, "It's not your turn.");
  assert.equal(JSON.stringify(await store.get(key)), before, "the room is unchanged after the setup refusal");
  // Play: the same forgery during an expand.
  const playing = await finishSetup(sessions);
  const turnPlayer = sessionFor(sessions, playing.currentPlayerId);
  const turnRival = other(sessions, turnPlayer);
  const expand = (await viewOf(turnPlayer)).legal.expand[0] as string;
  const beforePlay = JSON.stringify(await store.get(key));
  const refusedPlay = await forge(turnRival, turnPlayer.playerId, { type: "expand", code: expand });
  assert.equal(refusedPlay.status, 409);
  assert.equal((await json(refusedPlay)).error, "It's not your turn.");
  assert.equal(JSON.stringify(await store.get(key)), beforePlay, "the room is unchanged after the play refusal");
});

test("catching up several timeouts records each round once", async () => {
  const sessions = await empire2Game(2);
  const playing = await finishSetup(sessions);
  clock += 6 * playing.turnMs;
  // One read: the log export runs the clocks.
  const log = await json(await getLog(sessions[0]));
  const rounds: number[] = log.roundVp.map((entry: View) => entry.round);
  const roundStarts = log.log.filter((entry: View) => entry.type === "roundStart");
  assert.ok(roundStarts.length >= 3, `${roundStarts.length} round starts after six timeouts`);
  assert.equal(rounds.length, roundStarts.length, "one roundVp entry per round-start entry");
  assert.deepEqual(rounds, rounds.map((_, index) => index + 1), `round numbers ${rounds.join(", ")}`);
  assert.equal(log.log.filter((entry: View) => entry.type === "timeout").length, 6, "six timeouts were applied");
});

test("a POST with a body that is not JSON gets 400", async () => {
  await empire2Game(2);
  const send = (body: string) => empire2Post(new NextRequest("http://localhost/api/empire2", {
    method: "POST", headers: { "content-type": "application/json" }, body,
  }));
  for (const body of ["not json", "null", "[]", "7"]) {
    const response = await send(body);
    assert.equal(response.status, 400, `body ${JSON.stringify(body)}`);
    assert.equal((await json(response)).error, "That action isn't valid.");
  }
});

test("a read whose save keeps conflicting returns the stored room, not an unsaved one", async () => {
  const sessions = await empire2Game(2);
  const key = roomKey(sessions[0].code);
  const playing = await finishSetup(sessions);
  const eval_ = store.eval.bind(store);
  store.eval = async (script: string, keys: string[], args: string[]) => (
    script.includes("room.empire2Version") ? { conflict: true } : eval_(script, keys, args)
  );
  clock += playing.turnMs + 1;
  let view: View;
  try {
    view = await viewOf(sessions[0]);
  } finally {
    store.eval = eval_;
  }
  const stored = (await store.get<View>(key))!.empire2 as View;
  assert.equal(view.currentPlayerId, stored.turn.playerId, "the turn the stored room holds, not the timed-out one");
  assert.equal(view.round, stored.round);
  assert.equal(view.log.some((line: string) => /time ran out/i.test(line)), false, "the timeout was not applied");
});
