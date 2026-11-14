import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import Home from "@/app/page";

let dom: JSDOM;
let root: Root;

function mount(session?: { code: string; token: string; playerId: string; name: string }) {
  dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost" });
  if (session) dom.window.localStorage.setItem("bran-game-room", JSON.stringify(session));
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true
  });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    attachEvent: { configurable: true, value: () => {} },
    detachEvent: { configurable: true, value: () => {} }
  });
  root = createRoot(dom.window.document.getElementById("root")!);
  act(() => root.render(React.createElement(Home)));
  return dom.window.document;
}

function setInput(doc: Document, id: string, value: string) {
  const input = doc.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  act(() => {
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}

function submitJoin(doc: Document) {
  const form = doc.querySelector(".join-row")?.closest("form");
  assert.ok(form);
  act(() => {
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  });
}

afterEach(() => {
  if (root) act(() => root.unmount());
  dom?.window.close();
  delete (globalThis as { fetch?: typeof fetch }).fetch;
});

test("joining opens the lobby from one response and ignores rapid repeated submits", async () => {
  const doc = mount();
  setInput(doc, "name", "Brian");
  setInput(doc, "room", "ABC234");
  let requests = 0;
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  globalThis.fetch = (async () => { requests++; return pending; }) as typeof fetch;

  submitJoin(doc);
  assert.equal(requests, 1, "a fast second submit must not send another join request");
  await act(async () => {
    finish(new Response(JSON.stringify({
      code: "ABC234", token: "b".repeat(64), playerId: "p2", status: "waiting", startedAt: null,
      players: [{ id: "p1", name: "Host", host: true }, { id: "p2", name: "Brian", host: false }]
    }), { status: 200, headers: { "content-type": "application/json" } }));
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.match(doc.body.textContent ?? "", /ABC234.*Copy/);
  assert.match(doc.body.textContent ?? "", /Brian/);
  assert.equal(requests, 1, "the successful join response already contains lobby state; no fragile follow-up GET is needed");
});

test("the game lobby switches the selected game", async () => {
  const doc = mount();
  const championOption = [...doc.querySelectorAll<HTMLButtonElement>(".game-option")].find((button) => button.textContent?.includes("Champion Sprint"));
  assert.ok(championOption);
  act(() => championOption!.click());
  assert.equal(championOption!.getAttribute("aria-pressed"), "true");
  assert.equal([...doc.querySelectorAll(".game-option")].filter((button) => button.getAttribute("aria-pressed") === "true").length, 1, "exactly one game is selected");
  assert.ok([...doc.querySelectorAll("button")].some((button) => button.textContent === "Create room"));
});

test("the home page explains the game beside the room form", async () => {
  const doc = mount();
  const intro = doc.querySelector(".home-intro");
  assert.ok(intro, "intro section is shown");
  assert.equal(intro!.querySelector("h1")?.textContent, "Name countries. Paint the map.");
  assert.equal(intro!.querySelectorAll(".home-steps li").length, 3);
  assert.ok(intro!.querySelectorAll(".map-country.claimed").length > 10, "the example map shows claimed countries");
  assert.equal(intro!.querySelector(".map-legend"), null, "the example map has no legend");
});

test("the game lobby offers Overwatch Hero Sprint", async () => {
  const doc = mount();
  const heroOption = [...doc.querySelectorAll<HTMLButtonElement>(".game-option")].find((button) => button.textContent?.includes("Overwatch Hero Sprint"));
  assert.ok(heroOption);
  act(() => heroOption!.click());
  assert.equal(heroOption!.getAttribute("aria-pressed"), "true");
  assert.ok([...doc.querySelectorAll("button")].some((button) => button.textContent === "Create room"));
});

test("a host can start a two-player room from the lobby", async () => {
  const roomSession = { code: "ABC234", token: "a".repeat(64), playerId: "p1", name: "Host" };
  const calls: { url: string; body?: Record<string, unknown> }[] = [];
  let ended = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url, body });
    if (body?.action === "start") return new Response(JSON.stringify({ status: "playing", startedAt: Date.now(), players: [{ id: "p1", name: "Host", host: true }, { id: "p2", name: "Brian", host: false }] }), { status: 200, headers: { "content-type": "application/json" } });
    if (body?.action === "end") { ended = true; return new Response(JSON.stringify({ status: "ended" }), { status: 200, headers: { "content-type": "application/json" } }); }
    const data = ended
      ? { code: "ABC234", status: "ended", startedAt: Date.now() - 1000, players: [{ id: "p1", name: "Host", host: true }, { id: "p2", name: "Brian", host: false }], playerId: "p1", myGuesses: [], results: [{ playerId: "p1", name: "Host", guesses: [] }, { playerId: "p2", name: "Brian", guesses: [] }] }
      : { code: "ABC234", status: "waiting", startedAt: null, players: [{ id: "p1", name: "Host", host: true }, { id: "p2", name: "Brian", host: false }], playerId: "p1", myGuesses: [] };
    return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const doc = mount(roomSession);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const startButton = [...doc.querySelectorAll("button")].find((button) => button.textContent === "Start");
  assert.ok(startButton, "the host should be allowed to start with two players");
  await act(async () => { startButton!.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(calls.some((call) => call.body?.action === "start"));
  assert.match(doc.body.textContent ?? "", /Country Sprint.*TIME LEFT/);
  assert.ok(doc.querySelector(".world-map"), "country rounds should show the shared live map");
  const map = doc.querySelector(".world-map")!;
  for (const later of [".guess-form", ".claim-lists", "aside"]) assert.ok(map.compareDocumentPosition(doc.querySelector(later)!) & 4, `the map comes before ${later}`);
  assert.equal(doc.querySelectorAll(".continent-chip").length, 6, "one chip per continent");
  assert.match(doc.querySelector(".continent-chips")!.textContent ?? "", /Africa \d+ left/);
  assert.ok(doc.querySelector(".map-zoom-controls"), "the live map can be zoomed");


  doc.defaultView!.confirm = () => true;
  const stopButton = [...doc.querySelectorAll("button")].find((button) => button.textContent?.includes("End round & reveal"));
  assert.ok(stopButton, "the host should have a way to end a live round");
  await act(async () => { stopButton!.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(calls.some((call) => call.body?.action === "end"));
  assert.match(doc.body.textContent ?? "", /Results/);
});

const jsonResponse = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
const twoPlayers = [{ id: "p1", name: "Host", host: true }, { id: "p2", name: "Brian", host: false }];

test("a turns game shows the banner, round counter, card, scoreboard and only lets the current player type", async () => {
  const snapshot = (current: string) => ({
    code: "ABC234", gameId: "countries", mode: "turns", status: "playing", startedAt: Date.now(), players: twoPlayers, playerId: "p1", myGuesses: [],
    countryClaims: { CA: "p2" }, lockedCountryCodes: ["CA"], startCountries: { p1: "FR", p2: "CA" },
    recentGuesses: [
      { playerId: "p2", kind: "claimed", code: "CA", text: "Canada", points: 2, at: 3 },
      { playerId: "p1", kind: "wrong", code: "CL", text: "doesn't fit", points: 0, at: 2 },
      { playerId: "p2", kind: "passed", code: null, text: "passed", points: 0, at: 1 }
    ],
    turn: { number: 8, round: 10, totalRounds: 12, currentPlayerId: current, startedAt: Date.now(), turnMs: 15000, serverNow: Date.now(), finished: false, cards: [{ kind: "landlocked", label: "Landlocked country" }, { kind: "letter", letter: "A", label: 'Starts with "A"' }], doubleRound: true, pointsOne: 2, pointsBoth: 6, sudden: null },
    scores: { p1: { points: 3, bonuses: [], bonusTotal: 0, total: 3, territory: 1 }, p2: { points: 4, bonuses: [{ label: "Territory (3 linked)", points: 1 }], bonusTotal: 1, total: 5, territory: 3 } },
    claimLog: []
  });
  const calls: Record<string, unknown>[] = [];
  let current = "p2";
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body) { calls.push(JSON.parse(String(init.body))); return jsonResponse({ ok: true }); }
    return jsonResponse(snapshot(current));
  }) as typeof fetch;
  const doc = mount({ code: "ABC234", token: "a".repeat(64), playerId: "p1", name: "Host" });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const text = () => doc.body.textContent ?? "";
  assert.match(text(), /Round 10 of 12/);
  assert.match(text(), /Double points/);
  assert.match(text(), /Landlocked country/);
  assert.match(text(), /Brian's turn/);
  assert.match(text(), /Territory \(3 linked\)/, "current bonuses show live");
  assert.match(text(), /start France/);
  assert.match(text(), /start Canada/);
  assert.equal(doc.querySelectorAll(".map-home").length, 2, "each starting country gets a home marker");
  const feed = [...doc.querySelectorAll(".guess-feed li")];
  assert.equal(feed.length, 3);
  assert.match(feed[0].textContent ?? "", /Brian Canada \+2/);
  assert.equal(feed[1].querySelector("s")?.textContent, "Chile", "a wrong guess is struck through");
  assert.match(feed[1].textContent ?? "", /Chile doesn't fit/);
  const field = () => doc.querySelector<HTMLInputElement>(".guess-form input")!;
  const passButton = () => [...doc.querySelectorAll("button")].find((button) => button.textContent === "Pass")!;
  assert.equal(field().disabled, true, "input is locked on someone else's turn");
  assert.equal(field().placeholder, "Waiting for Brian…");
  assert.notEqual(doc.title, "Your turn · Atlas Sprint");
  assert.equal(passButton().disabled, true);
  assert.ok(doc.querySelector(".world-map"));
  const rows = [...doc.querySelectorAll<HTMLButtonElement>(".region-row")];
  assert.equal(rows.length, 11, "every bonus region is listed");
  const northAmerica = rows.find((row) => row.textContent?.startsWith("North America"))!;
  assert.match(northAmerica.textContent ?? "", /\+2/);
  assert.match(northAmerica.textContent ?? "", /Brian 1\/3/);
  assert.equal(doc.querySelectorAll(".region-highlight").length, 0);
  await act(async () => { northAmerica.click(); });
  assert.equal(doc.querySelectorAll(".map-country.region-highlight").length, 3, "tapping a region outlines its countries on the map");

  current = "p1";
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1000)); });
  assert.match(text(), /Your turn/);
  assert.equal(field().disabled, false, "polling every 0.8s unlocks the input on your turn");
  assert.equal(doc.title, "Your turn · Atlas Sprint", "the tab title says it is your turn");
  assert.equal(doc.activeElement, field(), "the input is focused on your turn");
  assert.match(field().className, /active/);
  await act(async () => { passButton().click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(calls.some((call) => call.action === "pass"));
});

test("turn-based results show each score breakdown, awards and a replay that fills the map in claim order", async () => {
  const claimLog = [
    { code: "FR", name: "France", playerId: "p2", points: 1, round: 1, order: 0, at: 1 },
    { code: "DE", name: "Germany", playerId: "p1", points: 2, round: 11, order: 1, at: 2 }
  ];
  globalThis.fetch = (async () => jsonResponse({
    code: "ABC234", gameId: "countries", mode: "turns", status: "ended", startedAt: Date.now() - 1000, players: twoPlayers, playerId: "p1", myGuesses: [],
    countryClaims: { FR: "p2", DE: "p1" }, claimLog,
    turn: { number: 24, round: 12, totalRounds: 12, currentPlayerId: null, startedAt: Date.now(), turnMs: 15000, serverNow: Date.now(), finished: true, cards: [], doubleRound: true, pointsOne: 2, pointsBoth: 6, sudden: null },
    scores: {},
    awards: [{ id: "first", title: "First claim", playerId: "p2", detail: "Opened the board with France" }],
    results: [
      { playerId: "p1", name: "Host", points: 5, bonuses: [{ kind: "region", label: "Owns all of Central Europe", points: 2 }], bonusTotal: 2, total: 7, guesses: [{ code: "DE", name: "Germany", points: 2 }] },
      { playerId: "p2", name: "Brian", points: 1, bonuses: [], bonusTotal: 0, total: 1, guesses: [{ code: "FR", name: "France", points: 1 }] }
    ]
  })) as typeof fetch;
  const doc = mount({ code: "ABC234", token: "a".repeat(64), playerId: "p1", name: "Host" });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const text = doc.body.textContent ?? "";
  assert.match(text, /Results/);
  assert.match(text, /Owns all of Central Europe\+2/);
  assert.match(text, /Final score7/);
  assert.match(text, /First claim: Brian/);
  const play = [...doc.querySelectorAll("button")].find((button) => button.textContent?.includes("Play"));
  assert.ok(play, "the replay has a Play button");
  assert.equal(doc.querySelectorAll(".map-country.claimed").length > 0, true, "the final map is shown before replaying");
  await act(async () => { play!.click(); });
  assert.equal(doc.querySelectorAll(".map-country.claimed").length, 0, "play restarts from an empty map");
  assert.match(doc.body.textContent ?? "", /Replaying…/, "the first step says it is replaying");
  assert.doesNotMatch(doc.body.textContent ?? "", /PRESS PLAY/);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
  assert.match(doc.body.textContent ?? "", /CLAIM 1 OF 2/);
  assert.match(doc.body.textContent ?? "", /Brian TOOK FRANCE/);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
  assert.match(doc.body.textContent ?? "", /CLAIM 2 OF 2/);
});

test("the Pass button locks when the turn clock reaches zero, like the input and Claim button", async () => {
  const snapshot = () => ({
    code: "ABC234", gameId: "countries", mode: "turns", status: "playing", startedAt: Date.now(), players: twoPlayers, playerId: "p1", myGuesses: [],
    countryClaims: { FR: "p1", DE: "p1", ES: "p2" }, lockedCountryCodes: ["FR", "DE", "ES"], largestGroups: { p1: ["FR", "DE"], p2: ["ES"] },
    turn: { number: 2, round: 2, totalRounds: 12, currentPlayerId: "p1", startedAt: Date.now() - 20_000, turnMs: 10000, serverNow: Date.now(), finished: false, cards: [{ kind: "wild", label: "Wild card: any country" }], doubleRound: false, pointsOne: 1, pointsBoth: 3, sudden: null },
    scores: {}, claimLog: []
  });
  globalThis.fetch = (async () => jsonResponse(snapshot())) as typeof fetch;
  const doc = mount({ code: "ABC234", token: "a".repeat(64), playerId: "p1", name: "Host" });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
  const passButton = [...doc.querySelectorAll("button")].find((button) => button.textContent === "Pass")!;
  assert.match(doc.body.textContent ?? "", /00s/);
  assert.equal(doc.querySelector<HTMLInputElement>(".guess-form input")!.disabled, true);
  assert.equal(passButton.disabled, true, "no passing once the clock shows 0");
  assert.equal(doc.querySelectorAll(".map-country.territory").length > 0, true, "largest groups get a thicker outline");
});

test("in a live race the answer box keeps focus after each claim", async () => {
  const urls: string[] = [];
  let answerSent = () => {};
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    if (String(input).includes("/api/guess")) { await new Promise<void>((resolve) => { answerSent = resolve; }); return jsonResponse({ ok: true }); }
    return jsonResponse({ code: "ABC234", gameId: "countries", mode: "live", status: "playing", startedAt: Date.now(), players: twoPlayers, playerId: "p1", myGuesses: [], countryClaims: {} });
  }) as typeof fetch;
  const doc = mount({ code: "ABC234", token: "a".repeat(64), playerId: "p1", name: "Host" });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const answer = doc.querySelector<HTMLInputElement>(".guess-form input")!;
  answer.id = "answer";
  answer.focus();
  setInput(doc, "answer", "France");
  act(() => { answer.dispatchEvent(new dom.window.KeyboardEvent("keyup", { bubbles: true })); });
  const claim = [...doc.querySelectorAll<HTMLButtonElement>(".guess-form button")].find((button) => button.textContent === "Claim")!;
  await act(async () => { claim.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(urls.some((url) => url.includes("/api/guess")), "the answer was sent");
  assert.equal(answer.disabled, false, "the box is never disabled while sending (browsers drop focus from disabled inputs)");
  assert.equal(answer.readOnly, true, "but it can't be edited mid-send");
  await act(async () => { answerSent(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(answer.value, "", "the box clears after a claim");
  assert.equal(doc.activeElement, answer, "the box keeps focus so you can type the next country");
});

test("in a turns game the answer box keeps focus after the server rejects a guess", async () => {
  const snapshot = {
    code: "ABC234", gameId: "countries", mode: "turns", status: "playing", startedAt: Date.now(), players: twoPlayers, playerId: "p1", myGuesses: [],
    countryClaims: {}, lockedCountryCodes: [],
    turn: { number: 1, round: 1, totalRounds: 12, currentPlayerId: "p1", startedAt: Date.now(), turnMs: 60000, serverNow: Date.now(), finished: false, cards: [{ kind: "wild", label: "Wild card: any country" }], doubleRound: false, pointsOne: 1, pointsBoth: 3, sudden: null },
    scores: {}, claimLog: []
  };
  let reject = () => {};
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body && String(init.body).includes("answerCode")) {
      await new Promise<void>((resolve) => { reject = resolve; });
      return new Response(JSON.stringify({ error: "That country doesn't fit your card." }), { status: 400, headers: { "content-type": "application/json" } });
    }
    return jsonResponse(snapshot);
  }) as typeof fetch;
  const doc = mount({ code: "ABC234", token: "a".repeat(64), playerId: "p1", name: "Host" });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const answer = doc.querySelector<HTMLInputElement>(".guess-form input")!;
  answer.id = "answer";
  answer.focus();
  setInput(doc, "answer", "France");
  act(() => { answer.dispatchEvent(new dom.window.KeyboardEvent("keyup", { bubbles: true })); });
  const claim = [...doc.querySelectorAll<HTMLButtonElement>(".guess-form button")].find((button) => button.textContent === "Claim")!;
  await act(async () => { claim.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(answer.disabled, false, "the box is never disabled while sending");
  const elsewhere = doc.body.appendChild(doc.createElement("button"));
  elsewhere.focus();
  assert.notEqual(doc.activeElement, answer, "focus has moved off the box mid-send");
  await act(async () => { reject(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.match(doc.body.textContent ?? "", /doesn't fit/, "the rejection is shown");
  assert.equal(doc.activeElement, answer, "the box has focus again so you can type another country");
});

const CARDS = [{ kind: "landlocked", label: "Landlocked country" }, { kind: "letter", letter: "A", label: 'Starts with "A"' }];
const threePlayers = [...twoPlayers, { id: "p3", name: "Sam", host: false }];
const settle = (ms = 0) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
/** A turns snapshot for p1 (the viewer) on a turn that is theirs unless `turn` says otherwise. */
function turnRoom(turn: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    code: "ABC234", gameId: "countries", mode: "turns", status: "playing", startedAt: Date.now(), players: twoPlayers, playerId: "p1", myGuesses: [],
    countryClaims: {}, startCountries: {}, recentGuesses: [], claimLog: [], scores: {},
    turn: { number: 8, round: 4, totalRounds: 12, currentPlayerId: "p1", startedAt: Date.now(), turnMs: 60000, serverNow: Date.now(), finished: false, cards: CARDS, doubleRound: false, pointsOne: 1, pointsBoth: 3, sudden: null, ...turn },
    ...extra
  };
}
/** Answers every poll with the current view; a POST (a claim or pass) gets `{ ok: true }`. */
function serve(view: () => unknown) {
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body) return jsonResponse({ ok: true });
    return jsonResponse(view());
  }) as typeof fetch;
}
const session = { code: "ABC234", token: "a".repeat(64), playerId: "p1", name: "Host" };

test("a turns game shows both cards and what they are worth", async () => {
  let view = turnRoom({ doubleRound: true, pointsOne: 2, pointsBoth: 6 });
  serve(() => view);
  const doc = mount(session);
  await settle(0);
  const cardTexts = () => [...doc.querySelectorAll(".turn-card-text")].map((card) => card.textContent);
  assert.deepEqual(cardTexts(), ["Landlocked country", 'Starts with "A"']);
  assert.match(doc.querySelector(".turn-cards")?.textContent ?? "", /2 for one · 6 for both/);
  view = turnRoom({ doubleRound: false, pointsOne: 1, pointsBoth: 3 });
  await settle(1000);
  assert.match(doc.querySelector(".turn-cards")?.textContent ?? "", /1 for one · 3 for both/, "the stakes follow the server's numbers");
  assert.equal(doc.querySelectorAll(".turn-card-or").length, 1, "the two cards are joined by one 'or'");
});

test("a one-card deal (old rooms, late game) renders one card and no stakes line", async () => {
  serve(() => turnRoom({ cards: [{ kind: "wild", label: "Wild card: any country" }], pointsOne: 1, pointsBoth: 3 }));
  const doc = mount(session);
  await settle(0);
  assert.deepEqual([...doc.querySelectorAll(".turn-card-text")].map((card) => card.textContent), ["Wild card: any country"]);
  assert.equal(doc.querySelector(".turn-points"), null, "no stakes line for one card");
  assert.equal(doc.querySelector(".turn-card-or"), null);
});

test("a double round shows Double points, sudden death hides it and shows the round", async () => {
  let view = turnRoom({ doubleRound: true });
  serve(() => view);
  const doc = mount(session);
  await settle(0);
  assert.match(doc.body.textContent ?? "", /Double points/);
  view = turnRoom({ round: 12, totalRounds: 12, doubleRound: false, sudden: { round: 2, maxRounds: 3, playerIds: ["p1", "p2"] } });
  await settle(1000);
  const text = doc.body.textContent ?? "";
  assert.match(text, /Sudden death/);
  assert.match(text, /round 2 of 3/i);
  assert.doesNotMatch(text, /Double points/);
  assert.doesNotMatch(text, /Round 20 of 20/);
  assert.match(text, /In it: Host and Brian/);
});

test("in sudden death a player who is not in it sees watching and a locked input", async () => {
  serve(() => turnRoom({ round: 12, totalRounds: 12, sudden: { round: 1, maxRounds: 3, playerIds: ["p1", "p2"] } }, { players: threePlayers, playerId: "p3" }));
  const doc = mount({ ...session, playerId: "p3" });
  await settle(0);
  const field = doc.querySelector<HTMLInputElement>(".guess-form input")!;
  assert.equal(field.placeholder, "Watching sudden death");
  assert.equal(field.disabled, true);
  const pass = [...doc.querySelectorAll("button")].find((button) => button.textContent === "Pass")!;
  assert.equal(pass.disabled, true);
  const out = [...doc.querySelectorAll(".score-row.out")];
  assert.equal(out.length, 1, "only the spectator's row is dimmed");
  assert.match(out[0].textContent ?? "", /Sam/);
});

test("a contender on their turn in sudden death can type", async () => {
  serve(() => turnRoom({ round: 12, totalRounds: 12, sudden: { round: 1, maxRounds: 3, playerIds: ["p1", "p2"] } }));
  const doc = mount(session);
  await settle(0);
  const field = doc.querySelector<HTMLInputElement>(".guess-form input")!;
  assert.equal(field.disabled, false);
  assert.equal(field.placeholder, "Country name");
  assert.equal(doc.activeElement, field, "the input has focus on the contender's turn");
});

test("the claim note names the points after a claim", async () => {
  const posted: Record<string, unknown>[] = [];
  let view = turnRoom({});
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body) {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      posted.push(body);
      view = turnRoom({ number: 9, currentPlayerId: "p2" });
      return jsonResponse({ ok: true, claim: { code: "FR", points: 3, fit: 2, cards: 2, both: true, sudden: false } });
    }
    return jsonResponse(view);
  }) as typeof fetch;
  const doc = mount(session);
  await settle(0);
  const answer = doc.querySelector<HTMLInputElement>(".guess-form input")!;
  answer.id = "answer";
  answer.focus();
  setInput(doc, "answer", "France");
  act(() => { answer.dispatchEvent(new dom.window.KeyboardEvent("keyup", { bubbles: true })); });
  const claim = [...doc.querySelectorAll<HTMLButtonElement>(".guess-form button")].find((button) => button.textContent === "Claim")!;
  await act(async () => { claim.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(posted.length, 1, "the claim was sent");
  assert.match(doc.querySelector(".claim-note")?.textContent ?? "", /^Both cards: \+3/);
});

test("the claim note is shown during the other players' turns and gone on your next turn", async () => {
  let view = turnRoom({});
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body) {
      view = turnRoom({ number: 9, currentPlayerId: "p2" });
      return jsonResponse({ ok: true, claim: { code: "FR", points: 3, fit: 2, cards: 2, both: true, sudden: false } });
    }
    return jsonResponse(view);
  }) as typeof fetch;
  const doc = mount(session);
  await settle(0);
  const answer = doc.querySelector<HTMLInputElement>(".guess-form input")!;
  answer.id = "answer";
  answer.focus();
  setInput(doc, "answer", "France");
  act(() => { answer.dispatchEvent(new dom.window.KeyboardEvent("keyup", { bubbles: true })); });
  const claim = [...doc.querySelectorAll<HTMLButtonElement>(".guess-form button")].find((button) => button.textContent === "Claim")!;
  await act(async () => { claim.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.match(doc.querySelector(".claim-note")?.textContent ?? "", /^Both cards: \+3/, "the note shows during the next player's turn");
  view = turnRoom({ number: 10, currentPlayerId: "p1" });
  await settle(1000);
  assert.equal(doc.querySelector(".claim-note"), null, "the note is gone on your next turn");
  view = turnRoom({ number: 11, currentPlayerId: "p2" });
  await settle(1000);
  assert.equal(doc.querySelector(".claim-note"), null, "the note never comes back on a later round");
});

test("the results breakdown is placed in the wide grid columns", async () => {
  const css = readFileSync(`${process.cwd()}/app/globals.css`, "utf8");
  assert.match(css, /\.board article>\.breakdown\{[^}]*grid-column:2\/4/);
});

test("the sudden death and double points banners are dark enough for white text", async () => {
  const css = readFileSync(`${process.cwd()}/app/globals.css`, "utf8");
  const background = (className: string) => {
    const match = css.match(new RegExp(`\\.${className}\\{[^}]*background:(#[0-9a-fA-F]{6})`));
    assert.ok(match, `.${className} sets a hex background`);
    return match[1];
  };
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((index) => {
      const channel = parseInt(hex.slice(index, index + 2), 16) / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrastWithWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05);
  for (const className of ["sudden-banner", "double-banner"]) {
    assert.ok(contrastWithWhite(background(className)) >= 4.5, `.${className} white text contrast is at least 4.5:1`);
  }
});

test("ending a turn-based game asks to end the game, not the round", async () => {
  serve(() => turnRoom({}));
  const doc = mount(session);
  await settle(0);
  const asked: string[] = [];
  doc.defaultView!.confirm = (message?: string) => { asked.push(message ?? ""); return false; };
  const endButton = [...doc.querySelectorAll("button")].find((button) => button.textContent?.includes("End game & reveal"));
  assert.ok(endButton, "the host has an end button in a turn-based game");
  await act(async () => { endButton!.click(); });
  assert.deepEqual(asked, ["End the game now and show the results?"]);
});

test("the feed marks claims that fit both cards", async () => {
  serve(() => turnRoom({}, { recentGuesses: [{ playerId: "p2", kind: "claimed", code: "CA", text: "Canada", points: 3, at: 3, both: true }] }));
  const doc = mount(session);
  await settle(0);
  const feed = [...doc.querySelectorAll(".guess-feed li")];
  assert.equal(feed.length, 1);
  assert.match(feed[0].textContent ?? "", /Brian Canada \+3 both cards/);
});

/** An ended turns room: Host 4 points, Brian 2 (or 4 when `tie`). */
function endedView({ winners, sudden = false, tie = false, finished = true }: { winners?: string[]; sudden?: boolean; tie?: boolean; finished?: boolean }) {
  return {
    code: "ABC234", gameId: "countries", mode: "turns", status: "ended", startedAt: Date.now() - 1000, players: twoPlayers, playerId: "p1", myGuesses: [],
    countryClaims: { FR: "p2", DE: "p1" }, claimLog: [], scores: {}, awards: [],
    turn: { number: 24, round: 12, totalRounds: 12, currentPlayerId: null, startedAt: Date.now(), turnMs: 15000, serverNow: Date.now(), finished, cards: [], doubleRound: false, pointsOne: 1, pointsBoth: 3, sudden: sudden ? { round: 1, maxRounds: 3, playerIds: ["p1", "p2"] } : null },
    results: [
      { playerId: "p1", name: "Host", points: 4, bonuses: [], bonusTotal: 0, total: 4, guesses: [] },
      { playerId: "p2", name: "Brian", points: tie ? 4 : 2, bonuses: [], bonusTotal: 0, total: tie ? 4 : 2, guesses: [] }
    ],
    ...(winners ? { winners } : {})
  };
}
function unmountNow() {
  act(() => root.unmount());
  root = null as unknown as Root;
}

test("turn-based results name the winner, share ties and mention sudden death", async () => {
  const shown = async (view: unknown) => {
    serve(() => view);
    const doc = mount(session);
    await settle(0);
    const result = { line: doc.querySelector(".winner-line")?.textContent ?? "", labels: [...doc.querySelectorAll(".board article > small")].map((label) => label.textContent) };
    unmountNow();
    return result;
  };
  assert.deepEqual(await shown(endedView({ winners: ["p1"] })), { line: "Host wins", labels: ["1ST", "2ND"] });
  assert.deepEqual(await shown(endedView({ winners: ["p1"], sudden: true })), { line: "Host wins in sudden death", labels: ["1ST", "2ND"] });
  assert.deepEqual(await shown(endedView({ winners: ["p1", "p2"], tie: true })), { line: "Host and Brian tie", labels: ["TIED 1ST", "TIED 1ST"] });
  assert.deepEqual(await shown(endedView({ winners: ["p1", "p2"], tie: true, sudden: true })), { line: "Host and Brian share the win after sudden death", labels: ["TIED 1ST", "TIED 1ST"] });
});

test("turn-based results for a game the host ended early say who leads and never claim a win", async () => {
  const shown = async (view: unknown) => {
    serve(() => view);
    const doc = mount(session);
    await settle(0);
    const result = { line: doc.querySelector(".winner-line")?.textContent ?? "", labels: [...doc.querySelectorAll(".board article > small")].map((label) => label.textContent) };
    unmountNow();
    return result;
  };
  const sole = await shown(endedView({ winners: ["p1"], finished: false }));
  assert.equal(sole.line, "Ended early. Host leads");
  assert.doesNotMatch(sole.line, /wins/);
  const tied = await shown(endedView({ winners: ["p1", "p2"], tie: true, finished: false }));
  assert.equal(tied.line, "Ended early. Host and Brian are level");
  assert.deepEqual(tied.labels, ["TIED 1ST", "TIED 1ST"]);
  const soleSudden = await shown(endedView({ winners: ["p1"], sudden: true, finished: false }));
  assert.equal(soleSudden.line, "Ended early. Host leads");
  assert.doesNotMatch(soleSudden.line, /sudden/i);
  const tiedSudden = await shown(endedView({ winners: ["p1", "p2"], tie: true, sudden: true, finished: false }));
  assert.equal(tiedSudden.line, "Ended early. Host and Brian are level");
  assert.doesNotMatch(tiedSudden.line, /sudden/i);
});

test("a naturally finished game still reads as before", async () => {
  const shown = async (view: unknown) => {
    serve(() => view);
    const doc = mount(session);
    await settle(0);
    const line = doc.querySelector(".winner-line")?.textContent ?? "";
    unmountNow();
    return line;
  };
  assert.equal(await shown(endedView({ winners: ["p1"], finished: true })), "Host wins");
  assert.equal(await shown(endedView({ winners: ["p1", "p2"], tie: true, finished: true })), "Host and Brian tie");
  assert.equal(await shown(endedView({ winners: ["p1", "p2"], tie: true, sudden: true, finished: true })), "Host and Brian share the win after sudden death");
  for (const view of [endedView({ winners: ["p1"], finished: true }), endedView({ winners: ["p1", "p2"], tie: true, finished: true })]) {
    assert.doesNotMatch(await shown(view), /Ended early/);
  }
});

test("the replay marks sudden-death claims", async () => {
  const view = endedView({ winners: ["p1"], sudden: true });
  view.claimLog = [
    { code: "FR", name: "France", playerId: "p2", points: 1, round: 12, order: 0, at: 1 },
    { code: "DE", name: "Germany", playerId: "p1", points: 1, round: 13, order: 1, at: 2, sudden: true }
  ] as never;
  serve(() => view);
  const doc = mount(session);
  await settle(0);
  const play = [...doc.querySelectorAll("button")].find((button) => button.textContent?.includes("Play"));
  assert.ok(play);
  await act(async () => { play!.click(); });
  await settle(400);
  assert.match(doc.body.textContent ?? "", /CLAIM 1 OF 2/);
  assert.doesNotMatch(doc.body.textContent ?? "", /SUDDEN DEATH/, "a normal claim has no sudden-death mark");
  await settle(400);
  assert.match(doc.body.textContent ?? "", /CLAIM 2 OF 2 · Host TOOK GERMANY \(\+1\) · SUDDEN DEATH/);
});
