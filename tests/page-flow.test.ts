import assert from "node:assert/strict";
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
  assert.match(doc.body.textContent ?? "", /ROOM READY/);
  assert.match(doc.body.textContent ?? "", /Brian/);
  assert.equal(requests, 1, "the successful join response already contains lobby state; no fragile follow-up GET is needed");
});

test("the game lobby switches the selected game and create-room label", async () => {
  const doc = mount();
  const championOption = [...doc.querySelectorAll<HTMLButtonElement>(".game-option")].find((button) => button.textContent?.includes("Champion Sprint"));
  assert.ok(championOption);
  act(() => championOption!.click());
  assert.equal(championOption!.getAttribute("aria-pressed"), "true");
  const createButton = [...doc.querySelectorAll("button")].find((button) => button.textContent?.includes("Create Champion Sprint room"));
  assert.ok(createButton);
});

test("the game lobby offers Overwatch Hero Sprint", async () => {
  const doc = mount();
  const heroOption = [...doc.querySelectorAll<HTMLButtonElement>(".game-option")].find((button) => button.textContent?.includes("Overwatch Hero Sprint"));
  assert.ok(heroOption);
  act(() => heroOption!.click());
  assert.equal(heroOption!.getAttribute("aria-pressed"), "true");
  assert.ok([...doc.querySelectorAll("button")].some((button) => button.textContent?.includes("Create Overwatch Hero Sprint room")));
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
  const startButton = [...doc.querySelectorAll("button")].find((button) => button.textContent?.includes("Start round"));
  assert.ok(startButton, "the host should be allowed to start with two players");
  await act(async () => { startButton!.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(calls.some((call) => call.body?.action === "start"));
  assert.match(doc.body.textContent ?? "", /COUNTRY SPRINT/);
  assert.ok(doc.querySelector(".world-map"), "country rounds should show the shared live map");

  doc.defaultView!.confirm = () => true;
  const stopButton = [...doc.querySelectorAll("button")].find((button) => button.textContent?.includes("End round & reveal"));
  assert.ok(stopButton, "the host should have a way to end a live round");
  await act(async () => { stopButton!.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(calls.some((call) => call.body?.action === "end"));
  assert.match(doc.body.textContent ?? "", /ANSWERS REVEALED/);
});

const jsonResponse = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
const twoPlayers = [{ id: "p1", name: "Host", host: true }, { id: "p2", name: "Brian", host: false }];

test("a turns game shows the banner, round counter, card, scoreboard and only lets the current player type", async () => {
  const snapshot = (current: string) => ({
    code: "ABC234", gameId: "countries", mode: "turns", status: "playing", startedAt: Date.now(), players: twoPlayers, playerId: "p1", myGuesses: [],
    countryClaims: { CA: "p2" }, lockedCountryCodes: ["CA"],
    turn: { number: 8, round: 10, totalRounds: 12, currentPlayerId: current, startedAt: Date.now(), turnMs: 15000, serverNow: Date.now(), finished: false, card: { kind: "landlocked" }, cardLabel: "Landlocked country", doubleRound: true },
    scores: { p1: { points: 3, bonuses: [], bonusTotal: 0, total: 3, territory: 1 }, p2: { points: 4, bonuses: [{ label: "Largest territory (3 linked)", points: 2 }], bonusTotal: 2, total: 6, territory: 3 } },
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
  assert.match(text(), /ROUND 10 OF 12/);
  assert.match(text(), /DOUBLE POINTS/);
  assert.match(text(), /Landlocked country/);
  assert.match(text(), /Brian’s turn/);
  assert.match(text(), /Largest territory \(3 linked\)/, "current bonuses show live");
  const field = () => doc.querySelector<HTMLInputElement>(".guess-form input")!;
  const passButton = () => [...doc.querySelectorAll("button")].find((button) => button.textContent === "Pass")!;
  assert.equal(field().disabled, true, "input is locked on someone else's turn");
  assert.equal(passButton().disabled, true);
  assert.ok(doc.querySelector(".world-map"));

  current = "p1";
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1000)); });
  assert.match(text(), /It’s your turn/);
  assert.equal(field().disabled, false, "polling every 0.8s unlocks the input on your turn");
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
    turn: { number: 24, round: 12, totalRounds: 12, currentPlayerId: null, startedAt: Date.now(), turnMs: 15000, serverNow: Date.now(), finished: true, card: null, cardLabel: null, doubleRound: true },
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
  assert.match(text, /FINAL SCORES/);
  assert.match(text, /Owns all of Central Europe\+2/);
  assert.match(text, /Final score7/);
  assert.match(text, /First claim: Brian/);
  const play = [...doc.querySelectorAll("button")].find((button) => button.textContent?.includes("Play"));
  assert.ok(play, "the replay has a Play button");
  assert.equal(doc.querySelectorAll(".map-country.claimed").length > 0, true, "the final map is shown before replaying");
  await act(async () => { play!.click(); });
  assert.equal(doc.querySelectorAll(".map-country.claimed").length, 0, "play restarts from an empty map");
  assert.match(doc.body.textContent ?? "", /REPLAYING…/, "the first step says it is replaying");
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
    turn: { number: 2, round: 2, totalRounds: 12, currentPlayerId: "p1", startedAt: Date.now() - 20_000, turnMs: 10000, serverNow: Date.now(), finished: false, card: { kind: "wild" }, cardLabel: "Wild card: any country", doubleRound: false },
    scores: {}, claimLog: []
  });
  globalThis.fetch = (async () => jsonResponse(snapshot())) as typeof fetch;
  const doc = mount({ code: "ABC234", token: "a".repeat(64), playerId: "p1", name: "Host" });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
  const passButton = [...doc.querySelectorAll("button")].find((button) => button.textContent === "Pass")!;
  assert.match(doc.body.textContent ?? "", /00s/);
  assert.match(doc.body.textContent ?? "", /10S TURNS/, "the chosen speed shows in game");
  assert.equal(doc.querySelector<HTMLInputElement>(".guess-form input")!.disabled, true);
  assert.equal(passButton.disabled, true, "no passing once the clock shows 0");
  assert.equal(doc.querySelectorAll(".map-country.territory").length > 0, true, "largest groups get a thicker outline");
});
