import "./empire2-dom";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "@/app/page";
import { Empire2Game } from "@/app/empire2-game";
import { Empire2Tutorial } from "@/app/empire2-tutorial";
import { TUTORIAL_SEEN_KEY } from "@/lib/empire2-tutorial";
import type { Empire2View } from "@/lib/empire2-playtest";

let dom: JSDOM | null = null;
let root: Root | null = null;

const TOKEN = "k".repeat(40);

function newDom() {
  dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost" });
  return dom;
}
function mountReact(element: React.ReactElement) {
  const window = dom!.window;
  Object.assign(globalThis, {
    window, document: window.document, localStorage: window.localStorage, HTMLElement: window.HTMLElement,
    Event: window.Event, MouseEvent: window.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true
  });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: window.navigator });
  Object.defineProperties(window.HTMLElement.prototype, {
    attachEvent: { configurable: true, value: () => {} },
    detachEvent: { configurable: true, value: () => {} }
  });
  root = createRoot(window.document.getElementById("root")!);
  act(() => root!.render(element));
  return window.document;
}
function mountTutorial(onClose = () => {}, reduce = false) {
  newDom();
  setMotion(reduce);
  return mountReact(React.createElement(Empire2Tutorial, { onClose }));
}
function mountHome() {
  newDom();
  return mountReact(React.createElement(Home));
}
function setMotion(reduce: boolean) {
  dom!.window.matchMedia = ((query: string) => ({
    matches: reduce, media: query, onchange: null, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false
  })) as unknown as Window["matchMedia"];
}
function buttonNamed(doc: Document, label: string, starts = false) {
  return [...doc.querySelectorAll("button")].find((button) => {
    const content = button.textContent?.trim() ?? "";
    return starts ? content.startsWith(label) : content === label;
  }) ?? null;
}
function click(doc: Document, label: string, starts = false) {
  const button = buttonNamed(doc, label, starts);
  assert.ok(button, `button "${label}"`);
  act(() => { button.click(); });
}
function clickCountry(doc: Document, code: string) {
  const path = doc.querySelector(`[data-code="${code}"]`);
  assert.ok(path, `map country ${code}`);
  act(() => { path.dispatchEvent(new dom!.window.MouseEvent("click", { bubbles: true })); });
}
function setField(doc: Document, selector: string, value: string) {
  const input = doc.querySelector(selector) as HTMLInputElement;
  assert.ok(input, selector);
  const setter = Object.getOwnPropertyDescriptor(dom!.window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  act(() => {
    input.dispatchEvent(new dom!.window.Event("input", { bubbles: true }));
    input.dispatchEvent(new dom!.window.Event("change", { bubbles: true }));
  });
}
const heading = (doc: Document) => doc.querySelector("#e2-tut-title")?.textContent ?? "";
const hint = (doc: Document) => doc.querySelector('[role="status"].e2-hint')?.textContent ?? "";
const counter = (doc: Document) => doc.querySelector(".e2-tut-count")?.textContent ?? "";

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  dom?.window.close();
  dom = null;
  delete (globalThis as { fetch?: typeof fetch }).fetch;
});

test("tutorial-dom-01 the Tutorial button is in the Empire 2.0 lobby only", async () => {
  const doc = mountHome();
  assert.equal(buttonNamed(doc, "Tutorial"), null, "not shown for the live race");
  click(doc, "Empire 2.0 (playtest)", true);
  assert.ok(buttonNamed(doc, "Tutorial"), "shown in Empire 2.0");
  click(doc, "Turn-based", true);
  assert.equal(buttonNamed(doc, "Tutorial"), null, "hidden again for turn-based");
});

test("tutorial-dom-02 step one shows its text; Next advances; Back on step two returns to step one", () => {
  const doc = mountTutorial();
  assert.equal(heading(doc), "Your empire");
  assert.equal(counter(doc), "Step 1 of 7");
  click(doc, "Next");
  assert.equal(heading(doc), "Expand");
  click(doc, "Back");
  assert.equal(heading(doc), "Your empire");
});

test("tutorial-dom-03 step two: clicking Belgium advances; Japan and Italy show their hints", () => {
  const doc = mountTutorial();
  click(doc, "Next");
  clickCountry(doc, "JP");
  assert.equal(heading(doc), "Expand", "a wrong click keeps the step open");
  assert.equal(hint(doc), "Expand only works next to your empire. Tap an outlined country.");
  clickCountry(doc, "IT");
  assert.equal(hint(doc), "That one is already taken. Look for an outlined country.");
  clickCountry(doc, "BE");
  assert.equal(heading(doc), "Second expand", "the outlined country advances the step");
});

test("tutorial-dom-15 a click on the sea or on the End step map gives a hint, never a silent dead end", () => {
  const doc = mountTutorial(() => {}, true);
  click(doc, "Next");
  act(() => { doc.querySelector(".map-ocean")!.dispatchEvent(new dom!.window.MouseEvent("click", { bubbles: true })); });
  assert.equal(heading(doc), "Expand", "a sea click keeps the step open");
  assert.equal(hint(doc), "Tap a country on the map, or type its name below.");
  click(doc, "Show me");
  setField(doc, 'input[aria-label="Country name"]', "Luxembourg");
  click(doc, "Expand (", true);
  assert.equal(heading(doc), "Settle");
  click(doc, "Show me");
  assert.equal(heading(doc), "Stronghold");
  click(doc, "Show me");
  assert.equal(heading(doc), "Take over");
  click(doc, "Show me");
  assert.equal(heading(doc), "End your turn");
  clickCountry(doc, "FR");
  assert.equal(hint(doc), "Press End turn below.", "a country click on the End step explains the step");
  assert.equal(heading(doc), "End your turn");
});

test("tutorial-dom-16 Escape skips the tutorial and remembers it", () => {
  let closed = 0;
  const doc = mountTutorial(() => { closed += 1; });
  act(() => { dom!.window.dispatchEvent(new dom!.window.KeyboardEvent("keydown", { key: "Escape" })); });
  assert.equal(closed, 1, "Escape closes once");
  assert.equal(dom!.window.localStorage.getItem(TUTORIAL_SEEN_KEY), "1");
});

test("tutorial-dom-04 step five: a wrong capital shows a hint; the right capital enables Stronghold", () => {
  const doc = mountTutorial(() => {}, true);
  click(doc, "Next");
  click(doc, "Show me");
  click(doc, "Show me");
  click(doc, "Show me");
  assert.equal(heading(doc), "Stronghold");
  setField(doc, 'input[aria-label="Country name"]', "Germany");
  setField(doc, 'input[aria-label="Capital city (real-world)"]', "Paris");
  click(doc, "Stronghold (3)");
  assert.equal(hint(doc), "That's not the capital city of Germany. Try again.");
  assert.equal(heading(doc), "Stronghold", "the step stays open");
  setField(doc, 'input[aria-label="Capital city (real-world)"]', "Berlin");
  assert.equal(buttonNamed(doc, "Stronghold (3)")!.disabled, false, "the right capital enables the button");
  click(doc, "Stronghold (3)");
  assert.equal(heading(doc), "Take over");
});

test("tutorial-dom-05 Show me plays the step and advances (reduced motion: at once, with no animation class)", () => {
  const doc = mountTutorial(() => {}, true);
  click(doc, "Next");
  assert.ok(doc.querySelector(".e2-tut-target")?.textContent?.includes("Next: Belgium") ?? false, "static label names the next country");
  click(doc, "Show me");
  assert.equal(heading(doc), "Second expand");
  assert.equal(counter(doc), "Step 3 of 7");
  assert.equal(doc.querySelector(".e2-tut-showing"), null, "no demo animation");
});

test("tutorial-dom-06 without reduced motion, Show me animates for about 800 ms before it advances", async () => {
  const doc = mountTutorial(() => {}, false);
  click(doc, "Next");
  click(doc, "Show me");
  assert.equal(heading(doc), "Expand", "still on the step while the demo plays");
  assert.ok(doc.querySelector(".e2-tut-showing"), "the demo is showing");
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 900)); });
  assert.equal(heading(doc), "Second expand", "advanced after the demo");
});

test("tutorial-dom-07 Skip closes the tutorial and remembers it", () => {
  let closed = 0;
  const doc = mountTutorial(() => { closed += 1; });
  click(doc, "Skip");
  assert.equal(closed, 1);
  assert.equal(dom!.window.localStorage.getItem(TUTORIAL_SEEN_KEY), "1");
});

test("tutorial-dom-08 a storage that throws does not crash the tutorial or Skip", () => {
  newDom();
  setMotion(false);
  let closed = 0;
  const doc = mountReact(React.createElement(Empire2Tutorial, { onClose: () => { closed += 1; } }));
  // Storage is blocked from here on: every read and write throws.
  Object.defineProperty(dom!.window, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
  click(doc, "Next");
  assert.equal(heading(doc), "Expand");
  click(doc, "Skip");
  assert.equal(closed, 1, "Skip still closes");
});

test("tutorial-dom-09 the finish card appears after step seven, and Close calls onClose", () => {
  let closed = 0;
  const doc = mountTutorial(() => { closed += 1; }, true);
  click(doc, "Next");
  click(doc, "Show me");
  click(doc, "Show me");
  click(doc, "Show me");
  setField(doc, 'input[aria-label="Country name"]', "Germany");
  setField(doc, 'input[aria-label="Capital city (real-world)"]', "Berlin");
  click(doc, "Stronghold (3)");
  setField(doc, 'input[aria-label="Country name"]', "Spain");
  setField(doc, 'input[aria-label="Capital city (real-world)"]', "Madrid");
  click(doc, "Take over (5)");
  assert.equal(heading(doc), "End your turn");
  click(doc, "Show me");
  assert.equal(heading(doc), "That's the basics");
  assert.ok(doc.body.textContent?.includes("Start a game when you're ready."));
  click(doc, "Close");
  assert.equal(closed, 1);
});

test("tutorial-dom-10 the copy never shows the bare word city (only the qualified capital city phrase)", () => {
  const doc = mountTutorial(() => {}, true);
  const scan = (label: string) => {
    const visible = [doc.body.textContent ?? "", ...[...doc.querySelectorAll("[placeholder],[aria-label]")].map((el) => `${el.getAttribute("placeholder") ?? ""} ${el.getAttribute("aria-label") ?? ""}`)];
    for (const chunk of visible) {
      const bare = chunk.replace(/capital city/gi, "");
      assert.doesNotMatch(bare, /\bcit(y|ies)\b/i, `${label}: "${chunk.slice(0, 120)}"`);
    }
  };
  scan("step one");
  click(doc, "Next");
  scan("expand");
  click(doc, "Show me");
  click(doc, "Show me");
  click(doc, "Show me");
  scan("stronghold");
  click(doc, "Show me");
  scan("take over");
});

// ---------- copy scan of the game screen, with the qualified phrase allowed ----------

const gameView = (over: Partial<Empire2View> = {}): Empire2View => {
  const now = Date.now();
  return {
    phase: "playing", viewerId: "a", currentPlayerId: "a", round: 3, roundCap: 20, winPoints: 16, turnMs: null, deadline: null,
    serverNow: now, underdogBoomPick: true,
    players: [
      { id: "a", name: "Ana", color: "#d4553a", host: true, influence: 6, capital: "FR", foothold: "ES", countries: 3, cities: 1, titles: [],
        vp: { total: 5, cities: 1, regionSets: [{ region: "Europe", points: 2 }], largestEmpire: 4, territory: 0, explorer: 0 },
        income: { base: 2, territory: 0, cities: 1, boom: 0, underdog: 0, total: 3 } },
      { id: "b", name: "Ben", color: "#2f78c4", host: false, influence: 4, capital: "PE", foothold: "DE", countries: 2, cities: 0, titles: [],
        vp: { total: 2, cities: 0, regionSets: [], largestEmpire: 0, territory: 0, explorer: 0 }, income: null }
    ],
    owners: { FR: "a", ES: "a", DE: "b" }, cities: ["FR"], frontier: ["IT"], setup: null, boomPick: null, booms: [], bounties: [],
    event: "closedBorders", turn: { playerId: "a", expands: 0, colonizes: 0, annexed: false, second: false },
    legal: { expand: ["IT"], colonize: ["JP"], city: ["FR"], annex: ["DE"] }, costs: { expand: 0, colonize: 6, city: 3, annex: 5, relief: true },
    log: ["Round 3 starts.", "Ana built a stronghold in France (-3)."], result: null,
    ...over
  };
};

test("tutorial-dom-11 the game screen and How to play use no bare city word", () => {
  const roster = [{ id: "a", name: "Ana", host: true }, { id: "b", name: "Ben", host: false }];
  const screens = [
    gameView(),
    gameView({ phase: "capital", setup: { step: "capital", offers: ["FR", "PE", "JP"], footholds: null }, legal: null, costs: null, turn: null }),
    gameView({ phase: "boomPick", currentPlayerId: null, boomPick: { playerId: "a", region: null, by: null, regions: ["Amazon"] }, legal: null, costs: null, turn: null }),
    gameView({ turnMs: 30000, deadline: Date.now() + 20000 }),
  ];
  for (const v of screens) {
    const html = renderToStaticMarkup(React.createElement(Empire2Game, {
      view: v, players: roster, playerId: "a", skewMs: 0, notice: "", busy: false,
      onAction: async () => true, onNotice: () => {}, onEnd: () => {}, onOpenTutorial: () => {},
    }));
    const plain = html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
    const attrs = [...html.matchAll(/(?:placeholder|aria-label|title)="([^"]*)"/g)].map((m) => m[1]).join(" ");
    for (const chunk of [plain, attrs]) {
      assert.doesNotMatch(chunk.replace(/capital city/gi, ""), /\bcit(y|ies)\b/i, `${v.phase}: "${chunk.slice(0, 80)}"`);
    }
  }
});

test("tutorial-dom-12 the first-time prompt shows once for Empire 2.0 and Not now remembers it", () => {
  const doc = mountHome();
  assert.equal(doc.body.textContent?.includes("New to Empire 2.0? Try the tutorial."), false, "not before the mode is chosen");
  click(doc, "Empire 2.0 (playtest)", true);
  assert.equal(doc.body.textContent?.includes("New to Empire 2.0? Try the tutorial."), true, "shown on first selection");
  click(doc, "Not now");
  assert.equal(doc.body.textContent?.includes("New to Empire 2.0? Try the tutorial."), false, "dismissed");
  assert.equal(dom!.window.localStorage.getItem(TUTORIAL_SEEN_KEY), "1");
});

test("tutorial-dom-13 the first-time prompt still works when storage throws (it shows again, nothing breaks)", () => {
  const doc = mountHome();
  // Storage is blocked from here on: every read and write throws.
  Object.defineProperty(dom!.window, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
  click(doc, "Empire 2.0 (playtest)", true);
  assert.equal(doc.body.textContent?.includes("New to Empire 2.0? Try the tutorial."), true);
  click(doc, "Not now");
  assert.ok(buttonNamed(doc, "Tutorial"), "the lobby still works");
});

test("tutorial-dom-14 How to play opens the tutorial from the game screen", () => {
  let opened = 0;
  const roster = [{ id: "a", name: "Ana", host: true }];
  const html = renderToStaticMarkup(React.createElement(Empire2Game, {
    view: { phase: "playing", viewerId: "a", currentPlayerId: "a", round: 1, roundCap: 20, winPoints: 16, turnMs: null, deadline: null,
      serverNow: 0, underdogBoomPick: false, players: [], owners: {}, cities: [], frontier: [], setup: null, boomPick: null, booms: [],
      bounties: [], event: null, turn: null, legal: null, costs: null, log: [], result: null } as unknown as Empire2View,
    players: roster, playerId: "a", skewMs: 0, notice: "", busy: false, onAction: async () => true, onNotice: () => {}, onEnd: () => {},
    onOpenTutorial: () => { opened += 1; },
  }));
  assert.match(html, /Open the tutorial/);
  newDom();
  const doc = mountReact(React.createElement(Empire2Game, {
    view: { phase: "playing", viewerId: "a", currentPlayerId: "a", round: 1, roundCap: 20, winPoints: 16, turnMs: null, deadline: null,
      serverNow: 0, underdogBoomPick: false, players: [], owners: {}, cities: [], frontier: [], setup: null, boomPick: null, booms: [],
      bounties: [], event: null, turn: null, legal: null, costs: null, log: [], result: null } as unknown as Empire2View,
    players: roster, playerId: "a", skewMs: 0, notice: "", busy: false, onAction: async () => true, onNotice: () => {}, onEnd: () => {},
    onOpenTutorial: () => { opened += 1; },
  }));
  click(doc, "Open the tutorial");
  assert.equal(opened, 1);
});
