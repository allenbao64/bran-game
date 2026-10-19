import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { NextRequest } from "next/server";
import type { Redis } from "@upstash/redis";
import { POST as roomPost, GET as roomGet } from "@/app/api/room/route";
import { POST as guessPost } from "@/app/api/guess/route";
import { POST as empirePost } from "@/app/api/empire/route";
import { setRedisForTests } from "@/lib/redis";
import { setEmpireRngForTests } from "@/lib/empire-room";
import { geo } from "@/lib/empire/geo";
import { cards } from "@/lib/empire/cards";
import { EMPIRE_RULES, type EmpireCard } from "@/lib/empire/types";
import { MemoryRedis } from "./memory-redis";

type Session = { code: string; token: string; playerId: string; mode?: string };
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
  let seed = 7;
  setEmpireRngForTests(() => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; });
});
afterEach(() => { setRedisForTests(null); setEmpireRngForTests(null); Date.now = realNow; });

const postRoom = (body: Record<string, unknown>) => roomPost(new NextRequest("http://localhost/api/room", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
}));
const getRoom = async (session: Session) => json(await roomGet(new NextRequest(`http://localhost/api/room?code=${session.code}`, {
  headers: { authorization: `Bearer ${session.token}` }
})));
const act = (session: Session, action: Record<string, unknown>) => empirePost(new NextRequest("http://localhost/api/empire", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: session.code, token: session.token, action })
}));

async function empireGame(players = 2) {
  const host = await json(await postRoom({ action: "create", name: "Host", mode: "empire" })) as Session;
  const sessions = [host];
  for (const name of ["Brian", "Casey"].slice(0, players - 1)) sessions.push(await json(await postRoom({ action: "join", code: host.code, name })) as Session);
  assert.equal((await postRoom({ action: "start", code: host.code, token: host.token, name: "Host" })).status, 200);
  return sessions;
}
const current = (view: View, sessions: Session[]) => sessions.find((s) => s.playerId === view.empire.currentPlayerId)!;
const allCodes = () => geo.regionNames().flatMap((region) => geo.regionMembers(region));
/** A free country that fits the given card for the current player. */
function fitting(view: View, card: EmpireCard): string | undefined {
  const owners = view.countryClaims as Record<string, string>;
  const mine = new Set(Object.keys(owners).filter((code) => owners[code] === view.empire.currentPlayerId));
  const closed = view.empire.event?.kind === "closedContinent" ? view.empire.event.continent : null;
  return allCodes().find((code) => !owners[code] && geo.continentOf(code) !== closed && cards.cardFits(card, code, { ownedByMe: mine, neighbours: geo.neighbours }));
}

test("Empire mode is stored on create and the game starts with capitals and a dealt hand", async () => {
  const sessions = await empireGame(3);
  assert.equal(sessions[0].mode, "empire");
  const view = await getRoom(sessions[1]);
  assert.equal(view.mode, "empire");
  assert.equal(view.status, "playing");
  assert.equal(view.empire.round, 1);
  assert.equal(Object.keys(view.countryClaims).length, 3, "each player starts with a capital");
  for (const player of view.empire.players) assert.equal(view.countryClaims[player.capital], player.id);
  assert.equal(view.empire.hand.length, EMPIRE_RULES.cardsDealt);
  assert.ok(view.empire.hand.every((card: { label: string }) => card.label.length > 0));
  assert.ok(sessions.some((s) => s.playerId === view.empire.currentPlayerId));
  assert.equal(JSON.stringify(view).includes(sessions[0].token), false, "tokens never leak");
});

test("only the current player can act, and a fitting claim moves the turn on", async () => {
  const sessions = await empireGame();
  let view = await getRoom(sessions[0]);
  const me = current(view, sessions);
  const other = sessions.find((s) => s !== me)!;
  assert.equal((await act(other, { type: "pass" })).status, 409);
  assert.equal((await act(me, { type: "claim", code: "FR" })).status, 400, "a card must be picked first");
  assert.equal((await act(me, { type: "pick", index: 0 })).status, 200);
  view = await getRoom(me);
  const code = fitting(view, view.empire.hand[0]);
  assert.ok(code, "the dealt card is playable");
  assert.equal((await act(me, { type: "claim", code })).status, 200);
  view = await getRoom(me);
  assert.equal(view.countryClaims[code!], me.playerId);
  assert.equal(view.empire.currentPlayerId, other.playerId);
  assert.ok(view.empire.scores[me.playerId].total >= 2);
});

test("live-race guesses are refused in Empire rooms", async () => {
  const [host] = await empireGame();
  const response = await guessPost(new NextRequest("http://localhost/api/guess", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: host.code, token: host.token, answerCode: "FR" })
  }));
  assert.equal(response.status, 409);
});

test("expired turns count as passes and land on the right player and round", async () => {
  const sessions = await empireGame();
  const first = (await getRoom(sessions[0])).empire.currentPlayerId;
  clock += EMPIRE_RULES.turnMs * 3 + 500;
  const view = await getRoom(sessions[0]);
  assert.notEqual(view.empire.currentPlayerId, first, "three passes in a 2-player game end on the other player");
  assert.equal(view.empire.round, 2);
  assert.ok(view.empire.log.some((entry: { kind: string }) => entry.kind === "pass"));
});

test("two simultaneous claims by the current player only count once", async () => {
  const sessions = await empireGame();
  let view = await getRoom(sessions[0]);
  const me = current(view, sessions);
  await act(me, { type: "pick", index: 0 });
  view = await getRoom(me);
  const code = fitting(view, view.empire.hand[0])!;
  const results = await Promise.all([act(me, { type: "claim", code }), act(me, { type: "claim", code })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
});

test("a whole game played through the API finishes with winners and a replay log", async () => {
  const sessions = await empireGame(3);
  for (let step = 0; step < 400; step++) {
    const view = await getRoom(sessions[0]);
    if (view.status === "ended") break;
    clock += 1000;
    const me = current(view, sessions);
    await act(me, { type: "pick", index: 0 });
    const picked = await getRoom(me);
    const code = fitting(picked, picked.empire.hand[0]);
    const response = await act(me, code ? { type: "claim", code } : { type: "pass" });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  }
  const done = await getRoom(sessions[1]);
  assert.equal(done.status, "ended");
  assert.equal(done.empire.finished, true);
  assert.ok(done.empire.winnerIds.length >= 1);
  const top = Math.max(...Object.values(done.empire.scores as Record<string, { total: number }>).map((s) => s.total));
  for (const id of done.empire.winnerIds) assert.equal(done.empire.scores[id].total, top);
  assert.equal(done.claimLog.slice(0, 3).every((entry: { round: number }) => entry.round === 0), true, "replay starts with the capitals");
  assert.equal((await act(sessions[0], { type: "pass" })).status, 409, "no actions after the game ends");
});
