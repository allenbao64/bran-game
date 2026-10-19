import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { JSDOM } from "jsdom";

// React DOM decides at import time whether the browser supports input events, so
// this file installs jsdom globals first and imports the page afterwards. That lets
// us type into fields for real, which page-flow.test.ts does not need.
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true
});
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });

let React: typeof import("react");
let act: typeof import("react").act;
let createRoot: typeof import("react-dom/client").createRoot;
let Home: typeof import("@/app/page").default;
before(async () => {
  React = await import("react");
  act = React.act;
  ({ createRoot } = await import("react-dom/client"));
  ({ default: Home } = await import("@/app/page"));
});
after(() => dom.window.close());

type Root = ReturnType<typeof import("react-dom/client").createRoot>;
let root: Root | null = null;
const doc = dom.window.document;

function mount() {
  doc.body.innerHTML = "<div id='root'></div>";
  dom.window.localStorage.clear();
  root = createRoot(doc.getElementById("root")!);
  act(() => root!.render(React.createElement(Home)));
}
function type(id: string, value: string) {
  const input = doc.getElementById(id) as HTMLInputElement;
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
  act(() => { input.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
}
const button = (text: string, selector = "button") => [...doc.querySelectorAll<HTMLButtonElement>(selector)].find((b) => b.textContent?.includes(text));

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  delete (globalThis as { fetch?: typeof fetch }).fetch;
});

test("the mode toggle only shows for Country Sprint and live is the default", () => {
  mount();
  assert.ok(button("Live race", ".mode-option") && button("Turn-based", ".mode-option"));
  assert.equal(button("Live race", ".mode-option")!.getAttribute("aria-pressed"), "true");

  act(() => button("Champion Sprint", ".game-option")!.click());
  assert.equal(doc.querySelectorAll(".mode-option").length, 0, "other games have no mode");
  act(() => button("Overwatch Hero Sprint", ".game-option")!.click());
  assert.equal(doc.querySelectorAll(".mode-option").length, 0);
  act(() => button("Country Sprint", ".game-option")!.click());
  assert.equal(doc.querySelectorAll(".mode-option").length, 2);

  act(() => button("Turn-based", ".mode-option")!.click());
  assert.equal(button("Turn-based", ".mode-option")!.getAttribute("aria-pressed"), "true");
  assert.equal(button("Live race", ".mode-option")!.getAttribute("aria-pressed"), "false");
});

test("the chosen mode is sent when creating a room and shown in the room lobby", async () => {
  mount();
  act(() => button("Turn-based", ".mode-option")!.click());
  type("name", "Host");
  const sent: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({
      code: "ABC234", gameId: "countries", mode: "turns", token: "a".repeat(64), playerId: "p1", status: "waiting", startedAt: null,
      players: [{ id: "p1", name: "Host", host: true }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  await act(async () => { button("Create Country Sprint room")!.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(sent[0].mode, "turns");
  assert.equal(sent[0].gameId, "countries");
  assert.match(doc.body.textContent ?? "", /ROOM READY/);
  assert.match(doc.body.textContent ?? "", /MODE.*TURN-BASED/);
});

test("a live-mode create sends mode live, and non-country games send no mode", async () => {
  mount();
  type("name", "Host");
  const sent: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ error: "stop here" }), { status: 400, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  await act(async () => { button("Create Country Sprint room")!.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(sent[0].mode, "live");
  act(() => button("Champion Sprint", ".game-option")!.click());
  await act(async () => { button("Create Champion Sprint room")!.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(sent[1].gameId, "champions");
  assert.equal("mode" in sent[1], false);
});

test("the turn speed picker only shows for Turn-based, defaults to Standard, and its choice is sent and shown in the lobby", async () => {
  mount();
  assert.equal(doc.querySelectorAll(".speed-option").length, 0, "live race has no speed");
  act(() => button("Turn-based", ".mode-option")!.click());
  assert.equal(doc.querySelectorAll(".speed-option").length, 3);
  assert.equal(button("Standard", ".speed-option")!.getAttribute("aria-pressed"), "true");
  assert.match(button("Blitz", ".speed-option")!.textContent ?? "", /10 SECONDS/);
  assert.match(button("Relaxed", ".speed-option")!.textContent ?? "", /25 SECONDS/);
  act(() => button("Blitz", ".speed-option")!.click());
  assert.equal(button("Blitz", ".speed-option")!.getAttribute("aria-pressed"), "true");
  assert.equal(button("Standard", ".speed-option")!.getAttribute("aria-pressed"), "false");
  act(() => button("Live race", ".mode-option")!.click());
  assert.equal(doc.querySelectorAll(".speed-option").length, 0);
  act(() => button("Turn-based", ".mode-option")!.click());
  type("name", "Host");
  const sent: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({
      code: "ABC234", gameId: "countries", mode: "turns", turnSeconds: 10, token: "a".repeat(64), playerId: "p1", status: "waiting", startedAt: null,
      players: [{ id: "p1", name: "Host", host: true }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  await act(async () => { button("Create Country Sprint room")!.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(sent[0].turnSeconds, 10, "the earlier Blitz pick is kept");
  assert.match(doc.body.textContent ?? "", /TURN-BASED · 10S TURNS/);
  assert.match(doc.body.textContent ?? "", /10 seconds each/);
});

test("live-mode creates send no turn speed", async () => {
  mount();
  type("name", "Host");
  const sent: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ error: "stop here" }), { status: 400, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  await act(async () => { button("Create Country Sprint room")!.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal("turnSeconds" in sent[0], false);
});
