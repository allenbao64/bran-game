import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmpireGame, EmpireResults } from "@/app/empire-game";
import { empireSnapshot, type EmpireRoom } from "@/lib/empire-room";
import { actions } from "@/lib/empire/actions";
import { geo } from "@/lib/empire/geo";
import { cards } from "@/lib/empire/cards";
import { scoring } from "@/lib/empire/scoring";

let seed = 3;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const players = [{ id: "a", name: "Ana", host: true }, { id: "b", name: "Ben", host: false }];
const colorOf = (id: string) => (id === "a" ? "#d4553a" : "#2f78c4");

function room(): EmpireRoom {
  const empire = actions.initEmpire(["a", "b"], 1000, { geo, cards, scoring, rng });
  return { code: "ABCDEF", gameId: "countries", mode: "empire", status: "playing", startedAt: 1000,
    players: players.map((p) => ({ ...p, token: "x".repeat(40) })), empire };
}

test("the Empire game screen shows the turn, the hand, actions for the current player and every score", () => {
  const snap = empireSnapshot(room(), 2000);
  const view = snap.empire!;
  const html = renderToStaticMarkup(React.createElement(EmpireGame, {
    view, players, playerId: view.currentPlayerId!, countryClaims: snap.countryClaims, skewMs: 0, notice: "",
    busy: false, onAction: async () => true, onNotice: () => {}, onEnd: () => {}, colorOf
  }));
  assert.match(html, /Your/);
  for (const card of view.hand) assert.ok(html.includes(card.label), card.label);
  assert.match(html, /Pass/);
  assert.match(html, /Ana/);
  assert.match(html, /Ben/);
  for (const player of view.players) assert.ok(html.includes(player.capitalName));
});

test("other players see whose move it is and no action form", () => {
  const snap = empireSnapshot(room(), 2000);
  const view = snap.empire!;
  const other = players.find((p) => p.id !== view.currentPlayerId)!;
  const html = renderToStaticMarkup(React.createElement(EmpireGame, {
    view, players, playerId: other.id, countryClaims: snap.countryClaims, skewMs: 0, notice: "",
    busy: false, onAction: async () => true, onNotice: () => {}, onEnd: () => {}, colorOf
  }));
  assert.ok(html.includes(`${players.find((p) => p.id === view.currentPlayerId)!.name}’s`));
  assert.equal(html.includes("Country name"), false);
});

test("the Empire results screen names the winner and breaks down scores", () => {
  const r = room();
  r.empire = { ...r.empire!, finished: true, winnerIds: ["a"] };
  const snap = empireSnapshot(r, 2000);
  const html = renderToStaticMarkup(React.createElement(EmpireResults, {
    view: snap.empire, players, playerId: "b", claimLog: snap.claimLog, colorOf, onLeave: () => {}
  }));
  assert.match(html, /Ana/);
  assert.match(html, /rules the world/);
  assert.match(html, /Final score/);
  assert.match(html, /WINNER/);
});

test("the Empire screen copes with a one-card hand", () => {
  const r = room();
  r.empire = { ...r.empire!, hand: [{ kind: "wild" }] };
  const snap = empireSnapshot(r, 2000);
  const view = snap.empire!;
  assert.equal(view.hand.length, 1);
  const html = renderToStaticMarkup(React.createElement(EmpireGame, {
    view, players, playerId: view.currentPlayerId!, countryClaims: snap.countryClaims, skewMs: 0, notice: "",
    busy: false, onAction: async () => true, onNotice: () => {}, onEnd: () => {}, colorOf
  }));
  assert.equal((html.match(/empire-card/g) ?? []).length, 1);
  assert.match(html, /Any country/);
});
