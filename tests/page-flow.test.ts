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
  act(() => input.dispatchEvent(new dom.window.Event("input", { bubbles: true })));
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

test("a host can start a two-player room from the lobby", async () => {
  const roomSession = { code: "ABC234", token: "a".repeat(64), playerId: "p1", name: "Host" };
  const calls: { url: string; body?: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url, body });
    const data = body?.action === "start"
      ? { status: "playing", startedAt: Date.now(), players: [{ id: "p1", name: "Host", host: true }, { id: "p2", name: "Brian", host: false }] }
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
});
