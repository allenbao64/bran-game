import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { NextRequest } from "next/server";
import type { Redis } from "@upstash/redis";
import { POST as roomPost, GET as roomGet } from "@/app/api/room/route";
import { POST as guessPost } from "@/app/api/guess/route";
import { setRedisForTests } from "@/lib/redis";
import { resolveChampion } from "@/lib/champions";
import { resolveOverwatchHero } from "@/lib/overwatch-heroes";
import { MemoryRedis } from "./memory-redis";

type Session = { code: string; token: string; playerId: string; gameId?: "countries" | "champions" | "overwatch"; status: string; startedAt: number | null; players: { id: string; name: string; host: boolean }[] };
const json = async (response: Response) => response.json() as Promise<Record<string, any>>;
let store: MemoryRedis;

beforeEach(() => {
  store = new MemoryRedis();
  setRedisForTests(store as unknown as Redis);
});
afterEach(() => setRedisForTests(null));

async function postRoom(body: Record<string, unknown>) {
  return roomPost(new NextRequest("http://localhost/api/room", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  }));
}
async function create(name = "Host", gameId?: "countries" | "champions" | "overwatch") {
  const response = await postRoom({ action: "create", name, ...(gameId ? { gameId } : {}) });
  assert.equal(response.status, 200);
  return json(response) as Promise<Session>;
}
async function join(code: string, name: string) {
  return postRoom({ action: "join", code, name });
}
async function start(session: Session, name = "Host") {
  return postRoom({ action: "start", code: session.code, token: session.token, name });
}
async function room(session: Session) {
  return roomGet(new NextRequest(`http://localhost/api/room?code=${session.code}`, {
    headers: { authorization: `Bearer ${session.token}` }
  }));
}
async function guess(session: Session, countryCode: string) {
  return guessPost(new NextRequest("http://localhost/api/guess", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: session.code, token: session.token, countryCode })
  }));
}

test("two players can join, start, keep guesses private, and reveal together at time", async () => {
  const host = await create();
  const guestResponse = await join(host.code, "Brian");
  assert.equal(guestResponse.status, 200);
  const guest = await json(guestResponse) as unknown as Session;
  assert.equal(guest.players.length, 2);
  assert.equal(guest.status, "waiting");
  assert.ok(!JSON.stringify(guest.players).includes(host.token), "player tokens must never be included in room snapshots");

  const startResponse = await start(host);
  assert.equal(startResponse.status, 200);
  const started = await json(startResponse);
  assert.equal(started.status, "playing");
  assert.equal(started.players.length, 2);
  host.startedAt = started.startedAt;
  guest.startedAt = started.startedAt;

  assert.equal((await guess(host, "CA")).status, 200);
  assert.equal((await guess(host, "CA")).status, 409, "a player cannot score one country twice");
  const stolenCountry = await guess(guest, "CA");
  assert.equal(stolenCountry.status, 409, "a country claimed by one player must be locked for everyone");
  assert.match((await json(stolenCountry)).error, /Another player already claimed/);
  assert.equal((await guess(guest, "US")).status, 200);
  const beforeReveal = await json(await room(guest));
  assert.deepEqual(beforeReveal.myGuesses.map((answer: { code: string }) => answer.code), ["US"]);
  assert.deepEqual([...beforeReveal.lockedCountryCodes].sort(), ["CA", "US"], "the public country board tracks claimed countries without player identities");
  assert.equal("results" in beforeReveal, false, "other players' answers stay hidden until the timer ends");

  const realNow = Date.now;
  Date.now = () => started.startedAt + 10 * 60 * 1000;
  try {
    const revealed = await json(await room(guest));
    assert.equal(revealed.status, "ended");
    assert.deepEqual(revealed.results.map((result: { name: string }) => result.name), ["Host", "Brian"]);
    assert.deepEqual(revealed.results.map((result: { guesses: { code: string }[] }) => result.guesses[0].code), ["CA", "US"]);
  } finally {
    Date.now = realNow;
  }
});

test("champion rooms share the selected game and end after two minutes", async () => {
  const host = await create("Host", "champions");
  assert.equal(host.gameId, "champions");
  const guest = await json(await join(host.code, "Brian")) as unknown as Session;
  assert.equal(guest.gameId, "champions", "the guest should inherit the game's selection from the room");
  const started = await json(await start(host));
  assert.equal(started.gameId, "champions");
  assert.equal(resolveChampion("Locke")?.name, "Locke", "the roster includes current 2026 champions");

  assert.equal((await guessPost(new NextRequest("http://localhost/api/guess", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: host.code, token: host.token, answerCode: resolveChampion("Kha Zix")!.code })
  }))).status, 200);
  const claimedChampion = await guessPost(new NextRequest("http://localhost/api/guess", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: host.code, token: guest.token, answerCode: resolveChampion("Kha Zix")!.code })
  }));
  assert.equal(claimedChampion.status, 409, "champions are globally locked within a room");
  const wrongGameAnswer = await guessPost(new NextRequest("http://localhost/api/guess", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: host.code, token: host.token, answerCode: "CA" })
  }));
  assert.equal(wrongGameAnswer.status, 400, "countries should not score in a champion round");

  const realNow = Date.now;
  Date.now = () => started.startedAt + 2 * 60 * 1000;
  try {
    const revealed = await json(await room(guest));
    assert.equal(revealed.gameId, "champions");
    assert.equal(revealed.status, "ended");
    assert.deepEqual(revealed.results[0].guesses, [{ code: "kha-zix", name: "Kha'Zix" }]);
  } finally { Date.now = realNow; }
});

test("Overwatch rooms accept hero names, share them privately, and end after two minutes", async () => {
  const host = await create("Host", "overwatch");
  const guest = await json(await join(host.code, "Brian")) as unknown as Session;
  assert.equal(host.gameId, "overwatch");
  assert.equal(guest.gameId, "overwatch");
  const started = await json(await start(host));
  assert.equal(started.gameId, "overwatch");

  const lucio = resolveOverwatchHero("Lucio")!;
  assert.equal(lucio.name, "Lúcio", "accent-insensitive entries resolve to the canonical hero name");
  const scored = await guessPost(new NextRequest("http://localhost/api/guess", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: host.code, token: host.token, answerCode: lucio.code })
  }));
  assert.equal(scored.status, 200);
  const claimedHero = await guessPost(new NextRequest("http://localhost/api/guess", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: host.code, token: guest.token, answerCode: lucio.code })
  }));
  assert.equal(claimedHero.status, 409, "heroes are globally locked within a room");

  const crossGameAnswer = await guessPost(new NextRequest("http://localhost/api/guess", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: host.code, token: host.token, answerCode: "ahri" })
  }));
  assert.equal(crossGameAnswer.status, 400, "League champions should not score in Overwatch rounds");

  const beforeReveal = await json(await room(guest));
  assert.equal("results" in beforeReveal, false);
  const realNow = Date.now;
  Date.now = () => started.startedAt + 2 * 60 * 1000;
  try {
    const revealed = await json(await room(guest));
    assert.equal(revealed.status, "ended");
    assert.deepEqual(revealed.results[0].guesses, [{ code: "lucio", name: "Lúcio" }]);
  } finally { Date.now = realNow; }
});

test("three players can fill all seats and the fourth join is rejected", async () => {
  const host = await create();
  const second = await json(await join(host.code, "Brian")) as unknown as Session;
  const thirdResponse = await join(host.code, "Casey");
  assert.equal(thirdResponse.status, 200);
  const third = await json(thirdResponse) as unknown as Session;
  assert.equal(third.players.length, 3);
  assert.deepEqual(third.players.map((player) => player.name), ["Host", "Brian", "Casey"]);
  const full = await json(await join(host.code, "Extra"));
  assert.equal(full.error, "This room is full.");
  assert.equal((await room(second)).status, 200);
});

test("only the host can start and one player cannot start alone", async () => {
  const host = await create();
  const tooEarly = await json(await start(host));
  assert.match(tooEarly.error, /At least two players/);

  const guest = await json(await join(host.code, "Brian")) as unknown as Session;
  const guestStart = await postRoom({ action: "start", code: host.code, token: guest.token, name: "Brian" });
  assert.equal(guestStart.status, 400);
  assert.match((await json(guestStart)).error, /Only the host/);

  const started = await start(host);
  assert.equal(started.status, 200);
  const lateJoin = await json(await join(host.code, "Late"));
  assert.match(lateJoin.error, /already started/);
});

test("the host can end a live round early and reveal every player's answers", async () => {
  const host = await create();
  const guest = await json(await join(host.code, "Brian")) as unknown as Session;
  assert.equal((await start(host)).status, 200);
  assert.equal((await guess(host, "CA")).status, 200);
  assert.equal((await guess(guest, "US")).status, 200);

  const guestStop = await postRoom({ action: "end", code: host.code, token: guest.token, name: "Brian" });
  assert.equal(guestStop.status, 400);
  assert.match((await json(guestStop)).error, /Only the host/);

  const hostStop = await postRoom({ action: "end", code: host.code, token: host.token, name: "Host" });
  assert.equal(hostStop.status, 200);
  assert.equal((await json(await room(guest))).status, "ended");
  const revealed = await json(await room(guest));
  assert.deepEqual(revealed.results.map((result: { guesses: { code: string }[] }) => result.guesses[0].code), ["CA", "US"]);
  assert.equal((await guess(guest, "GB")).status, 409);
});

test("room sessions cannot read or submit guesses for someone else's seat", async () => {
  const host = await create();
  await join(host.code, "Brian");
  const outsiderRoom = await roomGet(new NextRequest(`http://localhost/api/room?code=${host.code}`, {
    headers: { authorization: `Bearer ${"x".repeat(64)}` }
  }));
  assert.equal(outsiderRoom.status, 403);
  const forged = await guessPost(new NextRequest("http://localhost/api/guess", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: host.code, token: "x".repeat(64), countryCode: "CA" })
  }));
  assert.equal(forged.status, 403);
});
