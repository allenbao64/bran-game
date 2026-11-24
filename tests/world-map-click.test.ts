import "./empire2-dom";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WorldMap } from "@/app/world-map";

let dom: JSDOM | null = null;
let root: Root | null = null;

function mount(element: React.ReactElement) {
  dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost" });
  const window = dom.window;
  Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement, Event: window.Event, MouseEvent: window.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: window.navigator });
  Object.defineProperties(window.HTMLElement.prototype, {
    attachEvent: { configurable: true, value: () => {} }, detachEvent: { configurable: true, value: () => {} }
  });
  root = createRoot(window.document.getElementById("root")!);
  act(() => root!.render(element));
  return window.document;
}
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  dom?.window.close();
  dom = null;
});

const PLAYERS = [{ id: "a", name: "Ana" }];
const claims = { FR: "a" };

test("map-click-01 every country path and dot carries its code", () => {
  const doc = mount(React.createElement(WorldMap, { claims, players: PLAYERS, youId: "a", compact: true }));
  const paths = doc.querySelectorAll("path[data-code]");
  assert.ok(paths.length > 100, `many country paths carry a code (${paths.length})`);
  assert.ok(doc.querySelector('path[data-code="FR"]'), "France has a code");
});

test("map-click-02 with onCountryPick a click on a country reports its code", () => {
  const picked: string[] = [];
  const doc = mount(React.createElement(WorldMap, { claims, players: PLAYERS, youId: "a", compact: true, onCountryPick: (code: string) => picked.push(code) }));
  act(() => { doc.querySelector('path[data-code="BE"]')!.dispatchEvent(new dom!.window.MouseEvent("click", { bubbles: true })); });
  assert.deepEqual(picked, ["BE"]);
});

test("map-click-03 a click on the sea or the svg reports nothing as a country, and calls onMiss", () => {
  const picked: string[] = [];
  let misses = 0;
  const doc = mount(React.createElement(WorldMap, { claims, players: PLAYERS, youId: "a", compact: true, onCountryPick: (code: string) => picked.push(code), onMiss: () => { misses += 1; } }));
  act(() => { doc.querySelector(".map-ocean")!.dispatchEvent(new dom!.window.MouseEvent("click", { bubbles: true })); });
  assert.deepEqual(picked, []);
  assert.equal(misses, 1, "the sea click is reported as a miss");
  act(() => { doc.querySelector('path[data-code="BE"]')!.dispatchEvent(new dom!.window.MouseEvent("click", { bubbles: true })); });
  assert.equal(misses, 1, "a country click is not a miss");
});

test("map-click-04 a drag (pointer moved more than a few pixels) is not a country click", () => {
  const picked: string[] = [];
  const doc = mount(React.createElement(WorldMap, { claims, players: PLAYERS, youId: "a", compact: true, onCountryPick: (code: string) => picked.push(code) }));
  const svg = doc.querySelector("svg")!;
  const path = doc.querySelector('path[data-code="BE"]')!;
  act(() => { svg.dispatchEvent(new dom!.window.MouseEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 0 })); });
  act(() => { path.dispatchEvent(new dom!.window.MouseEvent("click", { bubbles: true, clientX: 60, clientY: 60 })); });
  assert.deepEqual(picked, [], "moved 85px: a pan, not a pick");
  act(() => { svg.dispatchEvent(new dom!.window.MouseEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 })); });
  act(() => { path.dispatchEvent(new dom!.window.MouseEvent("click", { bubbles: true, clientX: 11, clientY: 10 })); });
  assert.deepEqual(picked, ["BE"], "a press that barely moved is a pick");
});

test("map-click-05 without onCountryPick the map has no click handler and renders as before", () => {
  const doc = mount(React.createElement(WorldMap, { claims, players: PLAYERS, youId: "a", compact: true }));
  assert.doesNotThrow(() => act(() => { doc.querySelector('path[data-code="BE"]')!.dispatchEvent(new dom!.window.MouseEvent("click", { bubbles: true })); }));
});
