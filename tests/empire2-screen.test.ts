import "./empire2-dom";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "@/app/page";
import { Empire2Game, Empire2Results } from "@/app/empire2-game";
import { WorldMap } from "@/app/world-map";
import { countryByCode, resolveCountry } from "@/lib/countries";
import type { Empire2Action, Empire2View } from "@/lib/empire2-playtest";

let dom: JSDOM | null = null;
let root: Root | null = null;

const roster = [{ id: "a", name: "Ana", host: true }, { id: "b", name: "Ben", host: false }];
const TOKEN = "k".repeat(40);
const countryName = (code: string) => countryByCode(code)!.name;

/** A playing view for the player "a" (Ana). Ana owns France and Spain and holds a city in France. */
function view(over: Partial<Empire2View> = {}): Empire2View {
  const now = Date.now();
  return {
    phase: "playing", viewerId: "a", currentPlayerId: "a", round: 3, roundCap: 20, winPoints: 16, turnMs: 30000,
    deadline: now + 20000, serverNow: now, underdogBoomPick: false,
    players: [
      { id: "a", name: "Ana", color: "#d4553a", host: true, influence: 6, capital: "FR", foothold: "ES", countries: 3, cities: 1, titles: [],
        vp: { total: 5, cities: 1, regionSets: [{ region: "Europe", points: 2 }], largestEmpire: 4, territory: 0, explorer: 0 },
        income: { base: 2, territory: 0, cities: 1, boom: 0, underdog: 0, total: 3 } },
      { id: "b", name: "Ben", color: "#2f78c4", host: false, influence: 4, capital: "PE", foothold: "DE", countries: 2, cities: 0, titles: [],
        vp: { total: 2, cities: 0, regionSets: [], largestEmpire: 0, territory: 0, explorer: 0 }, income: null }
    ],
    owners: { FR: "a", ES: "a", DE: "b" },
    cities: ["FR"], frontier: ["IT"], setup: null, boomPick: null, booms: [], bounties: [], event: null,
    turn: { playerId: "a", expands: 0, colonizes: 0, annexed: false, second: false },
    legal: { expand: ["IT"], colonize: ["JP"], city: ["FR"], annex: ["DE"] },
    costs: { expand: 0, colonize: 6, city: 3, annex: 5, relief: false },
    log: ["Round 3 starts.", "Ana picked France as capital."],
    result: null,
    ...over
  };
}

const capitalView = (viewerId: string) => view({
  viewerId, phase: "capital", currentPlayerId: "a", deadline: Date.now() + 30000, legal: null, costs: null, turn: null, owners: {}, cities: [], frontier: [],
  setup: { step: "capital", offers: viewerId === "a" ? ["FR", "PE", "JP"] : null, footholds: null }
});
const footholdView = (viewerId: string) => view({
  viewerId, phase: "foothold", currentPlayerId: "a", legal: null, costs: null, turn: null, frontier: [],
  setup: { step: "foothold", offers: null, footholds: viewerId === "a" ? ["DE", "IT"] : null }
});
const boomView = (viewerId: string, underdogBoomPick = true) => view({
  viewerId, phase: "boomPick", currentPlayerId: null, legal: null, costs: null, turn: null, underdogBoomPick,
  boomPick: { playerId: "a", region: null, by: null, regions: ["Amazon", "Sahel", "Steppe"] }
});
const endedView = (result: Empire2View["result"]) => view({
  phase: "ended", currentPlayerId: null, deadline: null, legal: null, costs: null, turn: null, frontier: [], round: 12, result
});

function gameProps(v: Empire2View, playerId: string, sent: Empire2Action[] = []) {
  return {
    view: v, players: roster, playerId, skewMs: 0, notice: "", busy: false,
    onAction: async (action: Empire2Action) => { sent.push(action); return true; },
    onNotice: () => {}, onEnd: () => {}
  };
}
/** Static markup as plain text: tags removed, entities decoded. */
function text(html: string) {
  return html.replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
}

function mountHome(session?: { code: string; token: string; playerId: string; name: string }) {
  dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost" });
  if (session) dom.window.localStorage.setItem("bran-game-room", JSON.stringify(session));
  return mountReact(React.createElement(Home));
}
function mountComponent(element: React.ReactElement) {
  dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost" });
  return mountReact(element);
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
async function flush() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  dom?.window.close();
  dom = null;
  delete (globalThis as { fetch?: typeof fetch }).fetch;
});

test("the capital phase shows three offers as buttons to the picker only", () => {
  const picker = renderToStaticMarkup(React.createElement(Empire2Game, gameProps(capitalView("a"), "a")));
  for (const code of ["FR", "PE", "JP"]) assert.match(picker, new RegExp(`<button[^>]*>${countryName(code)}</button>`));
  assert.match(text(picker), /Pick your home country/);
  const other = renderToStaticMarkup(React.createElement(Empire2Game, gameProps(capitalView("b"), "b")));
  assert.doesNotMatch(other, /<button[^>]*>France<\/button>/);
  assert.match(text(other), /Ana is picking a home country/);
});

test("the foothold phase shows an input to the picker and a waiting banner to others", () => {
  const picker = renderToStaticMarkup(React.createElement(Empire2Game, gameProps(footholdView("a"), "a")));
  assert.match(picker, /<input[^>]*placeholder="Country name"/);
  assert.match(text(picker), /Place your outpost/);
  assert.match(text(picker), /Place outpost/);
  const other = renderToStaticMarkup(React.createElement(Empire2Game, gameProps(footholdView("b"), "b")));
  assert.doesNotMatch(other, /<input/);
  assert.match(text(other), /Ana is placing an outpost/);
});

test("the boom pick prompt shows only to the picker", () => {
  const picker = renderToStaticMarkup(React.createElement(Empire2Game, gameProps(boomView("a"), "a")));
  assert.match(text(picker), /Pick this round's boom region/);
  for (const region of ["Amazon", "Sahel", "Steppe"]) assert.match(picker, new RegExp(`<button[^>]*>${region}</button>`));
  const other = renderToStaticMarkup(React.createElement(Empire2Game, gameProps(boomView("b"), "b")));
  assert.match(text(other), /Ana is picking the boom region/);
  assert.doesNotMatch(other, /<button[^>]*>Amazon<\/button>/);
});

test("the action panel shows costs and disables actions that are not in the view's legal lists", () => {
  const html = renderToStaticMarkup(React.createElement(Empire2Game, gameProps(view(), "a")));
  assert.match(html, /<button[^>]*disabled[^>]*>Expand \(free\)<\/button>/, "nothing typed yet, so Expand is disabled");
  assert.match(html, /<button[^>]*>Settle \(6\)<\/button>/);
  assert.match(html, /<button[^>]*>Stronghold \(3\)<\/button>/);
  assert.match(html, /<button[^>]*>Take over \(5\)<\/button>/);
  assert.match(html, /<button[^>]*>End turn<\/button>/);

  const sent: Empire2Action[] = [];
  const doc = mountComponent(React.createElement(Empire2Game, gameProps(view(), "a", sent)));
  setField(doc, 'input[aria-label="Country name"]', "Japan");
  assert.equal(buttonNamed(doc, "Expand (free)")!.disabled, true, "Japan is not in legal.expand");
  assert.equal(buttonNamed(doc, "Settle (6)")!.disabled, false, "Japan is in legal.colonize");
  setField(doc, 'input[aria-label="Country name"]', "Mexico");
  assert.equal(buttonNamed(doc, "Settle (6)")!.disabled, true);
  assert.match(doc.body.textContent ?? "", /You can't do that right now\./);
  setField(doc, 'input[aria-label="Country name"]', "Italy");
  assert.equal(buttonNamed(doc, "Expand (free)")!.disabled, false);
  assert.doesNotMatch(doc.body.textContent ?? "", /You can't do that right now\./, "no hint when an action is allowed");
});

test("a country name that matches nothing shows the no-match line", () => {
  const doc = mountComponent(React.createElement(Empire2Game, gameProps(view(), "a")));
  setField(doc, 'input[aria-label="Country name"]', "Zzqxv");
  assert.equal(doc.querySelector(".e2-hint")?.textContent, "That doesn’t match a country on the list.");
});

test("an action button follows the view's legal list, not the screen's own influence check", () => {
  const broke = view({ players: view().players.map((entry) => (entry.id === "a" ? { ...entry, influence: 0 } : entry)), costs: { expand: 2, colonize: 6, city: 3, annex: 5, relief: false } });
  const sent: Empire2Action[] = [];
  const doc = mountComponent(React.createElement(Empire2Game, gameProps(broke, "a", sent)));
  setField(doc, 'input[aria-label="Country name"]', "Italy");
  assert.equal(buttonNamed(doc, "Expand (2)")!.disabled, false, "Italy is in legal.expand and the view's cost is not null");
  click(doc, "Expand (2)");
  assert.deepEqual(sent, [{ type: "expand", code: "IT" }]);
});

test("a non-current player sees a waiting line and no action buttons", () => {
  const html = renderToStaticMarkup(React.createElement(Empire2Game, gameProps(view({ viewerId: "b", currentPlayerId: "a", legal: null, costs: null }), "b")));
  assert.match(text(html), /Waiting for Ana\./);
  assert.doesNotMatch(html, /End turn/);
  assert.doesNotMatch(html, /<button[^>]*>Expand/);
});

test("the no-room relief shows the (no room to expand) suffix on Settle", () => {
  const html = renderToStaticMarkup(React.createElement(Empire2Game, gameProps(view({ costs: { expand: 0, colonize: 2, city: 3, annex: 5, relief: true } }), "a")));
  assert.match(text(html), /Settle \(2\) \(no room to expand\)/);
});

test("the scoreboard shows influence and points, with the breakdown in details", () => {
  const html = renderToStaticMarkup(React.createElement(Empire2Game, gameProps(view(), "a")));
  const plain = text(html);
  assert.match(plain, /Ana \(you\)/);
  assert.match(plain, /Ben/);
  assert.match(plain, /6 influence/);
  assert.match(plain, /5 points/);
  assert.match(plain, /4 influence/);
  assert.match(plain, /2 points/);
  assert.match(html, /<details[^>]*><summary>Details<\/summary><div class="e2-breakdown"><span>Countries /);
  assert.match(plain, /Largest empire · 4 points/);
  assert.match(plain, /Full Europe · 2 points/);
});

test("How to play is collapsed and states the numbers from the rules", () => {
  const html = renderToStaticMarkup(React.createElement(Empire2Game, gameProps(view(), "a")));
  assert.match(html, /<details class="e2-how">/);
  assert.doesNotMatch(html, /<details[^>]* open/, "no details element is open by default");
  assert.match(text(html), /the first player with 16 points at the end of their own turn wins/);
  assert.match(text(html), /Everyone starts with 3 influence/);
  assert.doesNotMatch(text(html), /Boom pick:/, "the boom pick line only shows when the option is on");
  const withBoom = renderToStaticMarkup(React.createElement(Empire2Game, gameProps(view({ underdogBoomPick: true }), "a")));
  assert.match(text(withBoom), /Boom region pick: the player with the fewest points picks this round's boom region\./);
});

test("the Expand button sends an expand action with the resolved code", () => {
  const sent: Empire2Action[] = [];
  const doc = mountComponent(React.createElement(Empire2Game, gameProps(view({ legal: { expand: ["PE", "IT"], colonize: [], city: [], annex: [] } }), "a", sent)));
  assert.equal(resolveCountry("Peru")?.code, "PE");
  setField(doc, 'input[aria-label="Country name"]', "Peru");
  click(doc, "Expand (free)");
  assert.deepEqual(sent, [{ type: "expand", code: "PE" }]);
});

test("Stronghold and Take over send the capital city text with the action", () => {
  const sent: Empire2Action[] = [];
  const doc = mountComponent(React.createElement(Empire2Game, gameProps(view(), "a", sent)));
  setField(doc, 'input[aria-label="Country name"]', "France");
  assert.equal(buttonNamed(doc, "Stronghold (3)")!.disabled, true, "Stronghold needs the capital city text");
  setField(doc, 'input[aria-label="Capital city (real-world)"]', " Paris ");
  click(doc, "Stronghold (3)");
  setField(doc, 'input[aria-label="Country name"]', "Germany");
  setField(doc, 'input[aria-label="Capital city (real-world)"]', "Berlin");
  click(doc, "Take over (5)");
  assert.deepEqual(sent, [
    { type: "city", code: "FR", capital: "Paris" },
    { type: "annex", code: "DE", capital: "Berlin" }
  ]);
});

test("End turn sends endTurn", () => {
  const sent: Empire2Action[] = [];
  const doc = mountComponent(React.createElement(Empire2Game, gameProps(view(), "a", sent)));
  click(doc, "End turn");
  assert.deepEqual(sent, [{ type: "endTurn" }]);
});

test("the capital offer button sends pickCapital", () => {
  const sent: Empire2Action[] = [];
  const doc = mountComponent(React.createElement(Empire2Game, gameProps(capitalView("a"), "a", sent)));
  click(doc, countryName("PE"));
  assert.deepEqual(sent, [{ type: "pickCapital", code: "PE" }]);
});

test("the boom region button sends pickBoom", () => {
  const sent: Empire2Action[] = [];
  const doc = mountComponent(React.createElement(Empire2Game, gameProps(boomView("a"), "a", sent)));
  click(doc, "Sahel");
  assert.deepEqual(sent, [{ type: "pickBoom", region: "Sahel" }]);
});

test("results show the winner line and the download button", () => {
  const html = renderToStaticMarkup(React.createElement(Empire2Results, {
    view: endedView({ reason: "points", winnerIds: ["a"] }), players: roster, playerId: "b", onDownloadLog: () => {}, onLeave: () => {}
  }));
  assert.match(text(html), /Ana wins/);
  assert.match(text(html), /Download game log/);
  assert.match(text(html), /Back to lobby/);
  assert.match(text(html), /Ana · WINNER/);
  assert.match(text(html), /Ben \(you\)/);
});

test("a tie lists the names in standings order", () => {
  // Engine order is Ben then Ana; Ana has more points, so the standings (and the cards) put her first.
  const html = renderToStaticMarkup(React.createElement(Empire2Results, {
    view: endedView({ reason: "points", winnerIds: ["b", "a"] }), players: roster, playerId: "a", onDownloadLog: () => {}, onLeave: () => {}
  }));
  assert.match(text(html), /Ana and Ben tie/);
  assert.doesNotMatch(text(html), /Ben and Ana/);
});

test("results for a game ended in setup do not say Round 0", () => {
  const html = renderToStaticMarkup(React.createElement(Empire2Results, {
    view: { ...endedView({ reason: "hostEnded", winnerIds: ["a"] }), round: 0 }, players: roster, playerId: "a", onDownloadLog: () => {}, onLeave: () => {}
  }));
  assert.match(text(html), /Ended during setup/);
  assert.doesNotMatch(text(html), /Round 0/);
});

test("host ended results say Ended early", () => {
  const html = renderToStaticMarkup(React.createElement(Empire2Results, {
    view: endedView({ reason: "hostEnded", winnerIds: ["a"] }), players: roster, playerId: "a", onDownloadLog: () => {}, onLeave: () => {}
  }));
  assert.match(text(html), /Ended early\. Ana leads/);
});

test("the lobby offers Empire 2.0 (playtest) with turn speeds and the boom option", async () => {
  const doc = mountHome();
  setField(doc, "#name", "Ana");
  click(doc, "Empire 2.0 (playtest)", true);
  for (const label of ["Quick", "Standard", "Relaxed"]) assert.ok(buttonNamed(doc, label, true), label);
  assert.equal(buttonNamed(doc, "Standard", true)!.getAttribute("aria-pressed"), "true");
  assert.ok(buttonNamed(doc, "On"), "boom On");
  assert.equal(buttonNamed(doc, "Off")!.getAttribute("aria-pressed"), "true");
  assert.match(doc.body.textContent ?? "", /The player with the fewest points picks one of this round's boom regions\./);
  assert.match(doc.body.textContent ?? "", /Expand, settle anywhere, build strongholds and take over rivals' countries\. First to 16 points wins\./);
});

test("the empire2 create request carries the chosen speed and boom option", async () => {
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({
      code: "ABC234", gameId: "countries", mode: "empire2", turnSeconds: 45, token: TOKEN, playerId: "a",
      status: "waiting", startedAt: null, players: [{ id: "a", name: "Ana", host: true }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const doc = mountHome();
  setField(doc, "#name", "Ana");
  click(doc, "Empire 2.0 (playtest)", true);
  click(doc, "Relaxed", true);
  click(doc, "On");
  click(doc, "Create room");
  await flush();
  assert.equal(bodies.length, 1);
  const { code, ...rest } = bodies[0];
  assert.equal(code, "");
  assert.deepEqual(rest, { action: "create", name: "Ana", gameId: "countries", mode: "empire2", turnSeconds: 45, underdogBoomPick: true });
  assert.match(doc.body.textContent ?? "", /Empire 2\.0 \(playtest\) · 45s turns · Lowest player picks the boom region/);
});

test("a joiner sees the boom option in the lobby tag", async () => {
  const room = {
    code: "ABC234", gameId: "countries", mode: "empire2", turnSeconds: 30, status: "waiting", startedAt: null, playerId: "b",
    underdogBoomPick: true, myGuesses: [], players: roster
  };
  globalThis.fetch = (async () => new Response(JSON.stringify(room), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  const doc = mountHome({ code: "ABC234", token: TOKEN, playerId: "b", name: "Ben" });
  await flush();
  assert.match(doc.body.textContent ?? "", /Lowest player picks the boom region/);
});

test("the 4-player roster shows four seats in an empire2 lobby", async () => {
  const room = {
    code: "ABC234", gameId: "countries", mode: "empire2", turnSeconds: 30, status: "waiting", startedAt: null, playerId: "a",
    myGuesses: [], players: [1, 2, 3, 4].map((n) => ({ id: `p${n}`, name: `Player ${n}`, host: n === 1 }))
  };
  globalThis.fetch = (async () => new Response(JSON.stringify(room), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  const doc = mountHome({ code: "ABC234", token: TOKEN, playerId: "p1", name: "Player 1" });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(doc.querySelectorAll(".roster .player").length, 4);
  assert.equal(doc.querySelectorAll(".roster .player b")[3]?.textContent, "Player 4");
  assert.match(doc.body.textContent ?? "", /PLAYERS 4\/4/);
});

test("the world map shows city markers only when given cities", () => {
  const base = { claims: { FR: "a" }, players: roster, youId: "a" };
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(WorldMap, base)), /map-city/);
  assert.match(renderToStaticMarkup(React.createElement(WorldMap, { ...base, cities: ["FR"] })), /map-city/);
});

test("the download button calls the log endpoint with the player's token and saves a dated JSON file", async () => {
  const calls: { url: string; auth: string | null }[] = [];
  const saved: { download: string; href: string }[] = [];
  const blobs: Blob[] = [];
  const logBody = JSON.stringify({ code: "ABC234", endedBy: "engine", log: [{ type: "roundStart" }] });
  const room = { code: "ABC234", gameId: "countries", mode: "empire2", turnSeconds: 30, status: "ended", startedAt: 1000, playerId: "a", myGuesses: [], players: roster, empire2: endedView({ reason: "points", winnerIds: ["a"] }) };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/empire2")) {
      calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
      return new Response(logBody, { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify(room), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = ((blob: Blob) => { blobs.push(blob); return "blob:empire2-log"; }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
  let anchors: HTMLAnchorElement | null = null;
  let originalClick: (() => void) | null = null;
  try {
    const doc = mountHome({ code: "ABC234", token: TOKEN, playerId: "a", name: "Ana" });
    anchors = dom!.window.HTMLAnchorElement.prototype;
    originalClick = anchors.click;
    anchors.click = function (this: HTMLAnchorElement) { saved.push({ download: this.download, href: this.href }); };
    await flush();
    assert.match(doc.body.textContent ?? "", /Download game log/);
    click(doc, "Download game log");
    await flush();
    assert.deepEqual(calls, [{ url: "/api/empire2?code=ABC234", auth: `Bearer ${TOKEN}` }]);
    assert.equal(saved.length, 1);
    assert.match(saved[0].download, /^empire2-ABC234-\d{4}-\d{2}-\d{2}\.json$/);
    assert.equal(blobs.length, 1);
    assert.equal(await blobs[0].text(), logBody);
  } finally {
    if (anchors && originalClick) anchors.click = originalClick;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});

test("a failed log download shows a notice", async () => {
  const room = { code: "ABC234", gameId: "countries", mode: "empire2", turnSeconds: 30, status: "ended", startedAt: 1000, playerId: "a", myGuesses: [], players: roster, empire2: endedView({ reason: "points", winnerIds: ["a"] }) };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).startsWith("/api/empire2")) return new Response(JSON.stringify({ error: "This browser is not in that room." }), { status: 403, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify(room), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const doc = mountHome({ code: "ABC234", token: TOKEN, playerId: "a", name: "Ana" });
  await flush();
  click(doc, "Download game log");
  await flush();
  assert.match(doc.body.textContent ?? "", /Could not download the log\. Try again\./);
});
