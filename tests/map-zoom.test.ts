import assert from "node:assert/strict";
import { test } from "node:test";
import { clampView, IDENTITY_VIEW, MAX_ZOOM, MIN_ZOOM, panBy, pinchView, wheelFactor, wheelIntent, zoomAt } from "@/lib/map-zoom";

const W = 900, H = 450;
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test("zoom is clamped between 1x and 8x", () => {
  assert.equal(zoomAt(IDENTITY_VIEW, 100, 0, 0, W, H).k, MAX_ZOOM);
  assert.deepEqual(zoomAt(IDENTITY_VIEW, 0.1, 300, 100, W, H), IDENTITY_VIEW);
  assert.equal(clampView({ k: 20, x: 0, y: 0 }, W, H).k, MAX_ZOOM);
  assert.equal(clampView({ k: 0.2, x: 0, y: 0 }, W, H).k, MIN_ZOOM);
});

test("zooming keeps the map point under the cursor in place", () => {
  const view = zoomAt(IDENTITY_VIEW, 2, 450, 225, W, H);
  assert.equal(view.k, 2);
  const px = 300, py = 150;
  const before = zoomAt(view, 1, px, py, W, H);
  const after = zoomAt(before, 2, px, py, W, H);
  near(after.k * ((px - before.x) / before.k) + after.x, px);
  near(after.k * ((py - before.y) / before.k) + after.y, py);
});

test("the map can't be dragged out of the frame", () => {
  const zoomed = zoomAt(IDENTITY_VIEW, 4, 450, 225, W, H);
  assert.deepEqual(panBy(zoomed, 5000, 5000, W, H), { k: 4, x: 0, y: 0 });
  assert.deepEqual(panBy(zoomed, -5000, -5000, W, H), { k: 4, x: W - W * 4, y: H - H * 4 });
  assert.deepEqual(panBy(IDENTITY_VIEW, 40, -40, W, H), IDENTITY_VIEW, "no panning at 1x");
});

test("zooming out from a corner snaps back inside the frame", () => {
  const corner = zoomAt(IDENTITY_VIEW, 8, 900, 450, W, H);
  assert.equal(corner.x, W - W * 8);
  assert.deepEqual(zoomAt(corner, 1 / 8, 900, 450, W, H), IDENTITY_VIEW);
});

test("pinching zooms by the finger distance and follows the midpoint", () => {
  const out = pinchView(IDENTITY_VIEW, { x: 450, y: 225, dist: 100 }, { x: 450, y: 225, dist: 300 }, W, H);
  assert.equal(out.k, 3);
  const moved = pinchView(out, { x: 450, y: 225, dist: 100 }, { x: 460, y: 235, dist: 100 }, W, H);
  assert.equal(moved.k, 3);
  near(moved.x, out.x + 10);
  assert.equal(pinchView(IDENTITY_VIEW, { x: 0, y: 0, dist: 0 }, { x: 0, y: 0, dist: 50 }, W, H).k, 1);
});

test("wheel up zooms in, wheel down zooms out", () => {
  assert.ok(wheelFactor(-100) > 1);
  assert.ok(wheelFactor(100) < 1);
  assert.equal(wheelFactor(0), 1);
});

test("trackpad swipes pan the map, mouse wheels and pinches zoom it", () => {
  const wheel = (deltaX: number, deltaY: number, extra: { deltaMode?: number; ctrlKey?: boolean } = {}) => wheelIntent({ deltaX, deltaY, deltaMode: 0, ctrlKey: false, ...extra });
  assert.equal(wheel(40, 0), "pan");
  assert.equal(wheel(12.5, -3), "pan");
  assert.equal(wheel(0, 8), "pan");
  assert.equal(wheel(0, 100), "zoom");
  assert.equal(wheel(0, -120), "zoom");
  assert.equal(wheel(0, 3, { deltaMode: 1 }), "zoom");
  assert.equal(wheel(0, 4.2, { ctrlKey: true }), "zoom");
});
