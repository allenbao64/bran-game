import type { EventKind, Rng } from "./types";

export const EVENT_KINDS: readonly EventKind[] = ["tradeWinds", "ceasefire", "goldenAge", "goldRush", "closedBorders"];

/** Exactly one rng draw; list order is fixed (decision D6). */
export function drawEvent(rng: Rng): EventKind {
  return EVENT_KINDS[Math.floor(rng() * EVENT_KINDS.length)];
}

const LABELS: Record<EventKind, string> = {
  tradeWinds: "Trade winds: colonizing costs 2",
  ceasefire: "Ceasefire: no annexing",
  goldenAge: "Golden age: cities pay 2",
  goldRush: "Gold rush: bounties pay 4",
  closedBorders: "Closed borders: expanding costs 1 more",
};

export function eventLabel(kind: EventKind): string {
  return LABELS[kind];
}
