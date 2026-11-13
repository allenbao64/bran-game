export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;
export const ZOOM_STEP = 1.5;
/** `k` is the scale; `x`/`y` the map-pixel offset applied after scaling: screen = k * point + (x, y). */
export type MapView = { k: number; x: number; y: number };
export const IDENTITY_VIEW: MapView = { k: 1, x: 0, y: 0 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Keeps the zoom in range and the map covering the whole frame. */
export function clampView(view: MapView, width: number, height: number): MapView {
  const k = clamp(view.k, MIN_ZOOM, MAX_ZOOM);
  return { k, x: clamp(view.x, width - width * k, 0), y: clamp(view.y, height - height * k, 0) };
}

/** Multiplies the zoom by `factor`, keeping the map point under (px, py) where it is. */
export function zoomAt(view: MapView, factor: number, px: number, py: number, width: number, height: number): MapView {
  const k = clamp(view.k * factor, MIN_ZOOM, MAX_ZOOM);
  const ratio = k / view.k;
  return clampView({ k, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio }, width, height);
}

export function panBy(view: MapView, dx: number, dy: number, width: number, height: number): MapView {
  return clampView({ ...view, x: view.x + dx, y: view.y + dy }, width, height);
}

/** Two-finger gesture: zoom by the change in finger distance and follow the midpoint. */
export function pinchView(view: MapView, from: { x: number; y: number; dist: number }, to: { x: number; y: number; dist: number }, width: number, height: number): MapView {
  const zoomed = zoomAt(view, from.dist > 0 ? to.dist / from.dist : 1, from.x, from.y, width, height);
  return panBy(zoomed, to.x - from.x, to.y - from.y, width, height);
}

/** Wheel notches to a zoom factor; scrolling up zooms in. */
export const wheelFactor = (deltaY: number) => Math.exp(-clamp(deltaY, -200, 200) * 0.0025);

type WheelInput = { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean };
/** Scrolling up/down zooms; a mostly sideways trackpad swipe pans. */
export function wheelIntent({ deltaX, deltaY, ctrlKey }: WheelInput): "zoom" | "pan" {
  return !ctrlKey && Math.abs(deltaX) > Math.abs(deltaY) ? "pan" : "zoom";
}

/** The map moves faster than the pointer so a small on-screen map can be crossed in one drag at high zoom. */
export const dragSpeed = (k: number) => Math.min(2.5, 1 + (k - 1) * 0.5);
/** Flick momentum: velocity (map px per ms) decays each frame; below this speed the glide stops. */
export const GLIDE_DECAY = 0.92;
export const GLIDE_MIN_SPEED = 0.02;
