import "./empire2-dom";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WorldMap } from "@/app/world-map";
import { Empire2Tutorial } from "@/app/empire2-tutorial";
import { FOCUS_BRAZIL, FOCUS_EUROPE, TUTORIAL_STEPS, focusView, type MapFocus } from "@/lib/empire2-tutorial";
import { centredView, IDENTITY_VIEW, MAX_ZOOM, type MapView } from "@/lib/map-zoom";
import { featureCode, mapFeatures, mapPath, MAP_HEIGHT, MAP_WIDTH } from "@/lib/world-geometry";

let dom: JSDOM | null = null;
let root: Root | null = null;

function mount(element: React.ReactElement, reduce = false) {
  dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost" });
  const window = dom.window;
  Object.assign(globalThis, { window, document: window.document, localStorage: window.localStorage, HTMLElement: window.HTMLElement, Event: window.Event, MouseEvent: window.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: window.navigator });
  Object.defineProperties(window.HTMLElement.prototype, {
    attachEvent: { configurable: true, value: () => {} }, detachEvent: { configurable: true, value: () => {} }
  });
  window.matchMedia = ((query: string) => ({
    matches: reduce, media: query, onchange: null, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false
  })) as unknown as Window["matchMedia"];
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

/** The map's transform as the view it encodes: "translate(x y) scale(k)". */
function viewOf(doc: Document): MapView {
  const transform = doc.querySelector(".world-map svg > g")!.getAttribute("transform")!;
  const [, x, y, k] = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/.exec(transform)!;
  return { x: Number(x), y: Number(y), k: Number(k) };
}
function buttonLabelled(doc: Document, label: string) {
  const button = doc.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;
  assert.ok(button, label);
  return button;
}
function click(doc: Document, label: string) {
  const button = [...doc.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
  assert.ok(button, `button "${label}"`);
  act(() => { button.click(); });
}

const PLAYERS = [{ id: "a", name: "Ana" }];
const claims = { FR: "a" };
const FRAME_PX = 343; // a 375px phone with 16px gutters

/** On-screen width (px) and centre (px) of a country's drawn shape in a frame `FRAME_PX` wide. */
function onScreen(code: string, focus: MapFocus) {
  const feature = mapFeatures.features.find((f) => featureCode(f) === code);
  assert.ok(feature, `${code} is drawn on the map`);
  const view = focusView(focus);
  const scale = FRAME_PX / MAP_WIDTH;
  const [[x0, y0], [x1, y1]] = mapPath.bounds(feature);
  const [cx, cy] = mapPath.centroid(feature);
  return {
    width: (x1 - x0) * view.k * scale,
    centre: [(view.x + view.k * cx) * scale, (view.y + view.k * cy) * scale],
    box: [(view.x + view.k * x0) * scale, (view.y + view.k * y0) * scale, (view.x + view.k * x1) * scale, (view.y + view.k * y1) * scale],
  };
}

test("map-view-01 centredView frames a point at the centre, keeps the frame inside the map, and may exceed MAX_ZOOM", () => {
  const view = centredView(450, 225, 9, MAP_WIDTH, MAP_HEIGHT);
  assert.equal(view.k, 9, "the fixed frame keeps its own scale");
  assert.ok(view.k > MAX_ZOOM, "a fixed frame is not limited by the interactive zoom range");
  assert.equal(view.x, MAP_WIDTH / 2 - 450 * 9);
  assert.equal(view.y, MAP_HEIGHT / 2 - 225 * 9);
  const corner = centredView(0, 0, 9, MAP_WIDTH, MAP_HEIGHT);
  assert.deepEqual({ x: corner.x, y: corner.y }, { x: 0, y: 0 }, "no empty space past the top-left edge");
  const far = centredView(MAP_WIDTH, MAP_HEIGHT, 9, MAP_WIDTH, MAP_HEIGHT);
  assert.deepEqual({ x: far.x, y: far.y }, { x: MAP_WIDTH - MAP_WIDTH * 9, y: MAP_HEIGHT - MAP_HEIGHT * 9 }, "no empty space past the bottom-right edge");
});

test("map-view-02 without initialView the map opens on the whole world, and Reset is off at the start", () => {
  const doc = mount(React.createElement(WorldMap, { claims, players: PLAYERS, youId: "a" }));
  assert.deepEqual(viewOf(doc), IDENTITY_VIEW);
  assert.equal(buttonLabelled(doc, "Reset zoom").disabled, true);
  click(doc, "+");
  assert.ok(viewOf(doc).k > 1, "zoom in works as before");
  assert.equal(buttonLabelled(doc, "Reset zoom").disabled, false);
  click(doc, "Reset");
  assert.deepEqual(viewOf(doc), IDENTITY_VIEW, "Reset returns to the whole world when no view is given");
});

test("map-view-03 with initialView the map opens on that view, and Reset returns to it", () => {
  const start = centredView(468, 79, 4, MAP_WIDTH, MAP_HEIGHT);
  const doc = mount(React.createElement(WorldMap, { claims, players: PLAYERS, youId: "a", initialView: start }));
  assert.deepEqual(viewOf(doc), start);
  assert.equal(buttonLabelled(doc, "Reset zoom").disabled, true, "Reset is off until the view moves");
  click(doc, "+");
  assert.notDeepEqual(viewOf(doc), start);
  click(doc, "Reset");
  assert.deepEqual(viewOf(doc), start);
});

test("map-view-04 the practice map passes its frame: each step opens on its own frame", () => {
  const doc = mount(React.createElement(Empire2Tutorial, { onClose: () => {} }), true);
  assert.deepEqual(viewOf(doc), focusView(FOCUS_EUROPE), "step 1 opens on Europe");
  assert.equal(viewOf(doc).k, FOCUS_EUROPE.k);
  click(doc, "Next");
  assert.equal(viewOf(doc).k, FOCUS_EUROPE.k, "step 2 keeps the Europe frame");
  click(doc, "Show me");
  click(doc, "Show me");
  assert.equal(doc.querySelector(".e2-tut h2")!.textContent, "Settle", "the expand demos are done");
  assert.deepEqual(viewOf(doc), focusView(FOCUS_BRAZIL), "the settle step pans to Brazil");
});

test("map-view-05 every tutorial step's frame is one of the two named frames, and the settle step is the only Brazil step", () => {
  for (const step of TUTORIAL_STEPS) {
    assert.ok([FOCUS_EUROPE, FOCUS_BRAZIL].includes(step.focus), `${step.id} has a named frame`);
  }
  assert.equal(TUTORIAL_STEPS.find((s) => s.id === "settle")!.focus, FOCUS_BRAZIL);
  assert.equal(TUTORIAL_STEPS.filter((s) => s.focus === FOCUS_BRAZIL).length, 1);
});

test("map-view-06 at 375px Belgium is at least 24px across in the tutorial frame", () => {
  const be = onScreen("BE", FOCUS_EUROPE);
  assert.ok(be.width >= 24, `Belgium ${be.width.toFixed(1)}px across`);
});

test("map-view-07 every tapped country in the tutorial is on screen at 375px and big enough to tap", () => {
  for (const step of TUTORIAL_STEPS) {
    if (!step.target) continue;
    const shape = onScreen(step.target, step.focus);
    const [cx, cy] = shape.centre;
    assert.ok(cx >= 0 && cx <= FRAME_PX && cy >= 0 && cy <= FRAME_PX / 2, `${step.target} centre (${cx.toFixed(0)}, ${cy.toFixed(0)}) is inside the frame`);
    if (step.note) {
      assert.match(step.note, /Luxembourg is very small/, "the only small target names itself and says to type");
      assert.equal(step.target, "LU");
      assert.ok(shape.width < 8, `Luxembourg is small (${shape.width.toFixed(1)}px), so the step says so`);
    } else {
      assert.ok(shape.width >= 14, `${step.target} is ${shape.width.toFixed(1)}px across`);
    }
  }
});

test("map-view-08 the settle step's Brazil is big enough to tap at 375px", () => {
  const br = onScreen("BR", FOCUS_BRAZIL);
  assert.ok(br.width >= 60, `Brazil ${br.width.toFixed(0)}px across`);
});
