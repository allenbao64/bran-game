"use client";

import React, { FormEvent, useEffect, useState } from "react";
import { WorldMap } from "@/app/world-map";
import { ResultsReplay } from "@/app/replay";
import type { ClaimLogEntry } from "@/app/turns-game";
import { countryByCode, resolveCountry } from "@/lib/countries";

export type EmpireScore = {
  countries: number; goldRush: number; empireSize: number; empire: number;
  sets: { region: string; points: number }[]; majorities: string[]; total: number;
};
export type EmpireView = {
  underdogId?: string | null; roundStartTotals?: Record<string, number>;
  round: number; roundCap: number; winPoints: number; currentPlayerId: string | null;
  turnStartedAt: number; turnMs: number; serverNow: number; largestGroups?: Record<string, string[]>;
  event: { kind: string; continent?: string; label: string } | null; nextEventAfterRound: number;
  hand: { kind: string; label: string }[]; chosen: number | null;
  players: { id: string; capital: string; capitalName: string; stealTokens: number; forts: string[]; fortNames: string[] }[];
  scores: Record<string, EmpireScore>; empireHolder: string | null; protected: string[];
  finished: boolean; winnerIds: string[];
  log: { kind: string; playerId: string; code?: string; name: string | null; from?: string; points?: number; round: number }[];
};
export type EmpireAction =
  | { type: "pick"; index: number } | { type: "claim"; code: string }
  | { type: "steal"; code: string; capital: string } | { type: "fortify"; code: string } | { type: "pass" };
type EmpirePlayer = { id: string; name: string; host: boolean };

type Props = {
  view: EmpireView; players: EmpirePlayer[]; playerId: string; countryClaims: Record<string, string>; skewMs: number;
  notice: string; busy: boolean; onAction: (action: EmpireAction) => Promise<boolean>; onNotice: (text: string) => void;
  onEnd: () => void; colorOf: (id: string) => string;
};

const bonusLines = (score: EmpireScore) => [
  ...(score.goldRush ? [`Gold rush +${score.goldRush}`] : []),
  ...(score.empire ? [`Largest empire (${score.empireSize}) +${score.empire}`] : []),
  ...score.sets.map((set) => `${set.region} set +${set.points}`),
  ...score.majorities.map((region) => `${region} majority +1`)
];

function logLine(entry: EmpireView["log"][number], nameOf: (id?: string) => string) {
  const who = nameOf(entry.playerId);
  if (entry.kind === "claim") return `${who} claimed ${entry.name}${entry.points && entry.points > 1 ? ` (+${entry.points})` : ""}`;
  if (entry.kind === "steal") return `${who} stole ${entry.name} from ${nameOf(entry.from)}`;
  if (entry.kind === "fortify") return `${who} fortified ${entry.name}`;
  return entry.code ? `${who} missed the capital of ${entry.name}` : `${who} passed`;
}

/** In-game screen for Empire: turn banner, cards, actions, scoreboard and the shared map. */
export function EmpireGame({ view, players, playerId, countryClaims, skewMs, notice, busy, onAction, onNotice, onEnd, colorOf }: Props) {
  const [seconds, setSeconds] = useState(Math.ceil(view.turnMs / 1000));
  const [country, setCountry] = useState("");
  const [capital, setCapital] = useState("");
  const mine = view.currentPlayerId === playerId;
  const nameOf = (id?: string) => players.find((player) => player.id === id)?.name ?? "Someone";
  const me = view.players.find((player) => player.id === playerId);
  const host = players.find((player) => player.id === playerId)?.host;

  useEffect(() => {
    const tick = () => setSeconds(Math.max(0, Math.ceil((view.turnStartedAt + view.turnMs - (Date.now() + skewMs)) / 1000)));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [view.turnStartedAt, view.turnMs, skewMs]);

  const resolved = country.trim() ? resolveCountry(country) : null;
  const owner = resolved ? countryClaims[resolved.code] : undefined;
  const picked = view.chosen !== null;

  async function run(action: EmpireAction) {
    if (await onAction(action)) { setCountry(""); setCapital(""); }
  }
  function withCountry(next: (code: string) => EmpireAction) {
    if (!resolved) { onNotice("That doesn’t match a country on the list."); return; }
    void run(next(resolved.code));
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (owner && owner !== playerId) withCountry((code) => ({ type: "steal", code, capital }));
    else withCountry((code) => ({ type: "claim", code }));
  }

  return <div className="game empire">
    <section>
      <div className="game-head"><div>
        <h1>{mine ? "Your turn" : `${nameOf(view.currentPlayerId ?? undefined)}’s turn`}</h1>
        <p className="round-line">ROUND {view.round} OF {view.roundCap}</p>
      </div><div className={seconds <= 5 ? "timer urgent" : "timer"}><small>TURN</small><b>0:{String(seconds).padStart(2, "0")}</b></div></div>
      {view.event && <p className="empire-event">Event: {view.event.label}</p>}

      <div className="guess-title">{mine ? "YOUR CARDS" : `${nameOf(view.currentPlayerId ?? undefined).toUpperCase()}’S CARDS`}</div>
      <div className="empire-hand">{view.hand.map((card, index) => <button type="button" key={`${card.label}-${index}`}
        className={`empire-card${view.chosen === index ? " selected" : ""}`} disabled={!mine || busy}
        aria-pressed={view.chosen === index} onClick={() => void onAction({ type: "pick", index })}>{card.label}</button>)}</div>

      {mine && <form className="empire-actions" onSubmit={submit}>
        <input className="field" placeholder="Country name" aria-label="Country name" value={country} onChange={(event) => setCountry(event.target.value)} disabled={busy}/>
        {owner && owner !== playerId && <input className="field" placeholder={`Capital of ${resolved?.name}`} aria-label="Capital" value={capital} onChange={(event) => setCapital(event.target.value)} disabled={busy}/>}
        <div className="empire-buttons">
          <button className="primary" disabled={busy || !country.trim() || !picked}>{owner && owner !== playerId ? "Steal" : "Claim"}</button>
          <button type="button" className="quiet" disabled={busy || !country.trim() || owner !== playerId} onClick={() => withCountry((code) => ({ type: "fortify", code }))}>Fortify</button>
          <button type="button" className="quiet" disabled={busy} onClick={() => void run({ type: "pass" })}>Pass</button>
        </div>
        {!picked ? <p className="empire-hint">Pick a card first.</p> : owner && owner !== playerId ? <p className="empire-hint">{`${resolved?.name} belongs to ${nameOf(owner)}. Name its capital to steal it (${me?.stealTokens ?? 0} steal${me?.stealTokens === 1 ? "" : "s"} left).`}</p> : null}
        <p className="empire-hint">Steals: the country must border yours and its owner must have at least your score at the start of the round. Capitals, forts and full region sets are safe.</p>
      </form>}
      {notice && <p className="notice">{notice}</p>}
      <WorldMap claims={countryClaims} players={players} youId={playerId} emphasis={view.largestGroups}/>
    </section>
    <aside>
      <div className="aside-title">SCORES <b>{view.winPoints} TO WIN</b></div>
      {players.map((player) => {
        const score = view.scores[player.id];
        const info = view.players.find((entry) => entry.id === player.id);
        return <div className="empire-score" key={player.id} style={{ borderColor: colorOf(player.id) }}>
          <div className="empire-score-head"><b style={{ color: colorOf(player.id) }}>{player.name}{player.id === playerId ? " (you)" : ""}</b><strong>{score?.total ?? 0}</strong></div>
          <small>{score?.countries ?? 0} countries · capital {info?.capitalName} · {info?.stealTokens ?? 0} steals</small>
          {score && bonusLines(score).map((line) => <small key={line} className="empire-bonus">{line}</small>)}
          {info && info.fortNames.length > 0 && <small>Forts: {info.fortNames.join(", ")}</small>}
        </div>;
      })}
      <div className="aside-title">LATEST</div>
      <div className="empire-log">{view.log.length ? view.log.map((entry, index) => <small key={index}>R{entry.round} · {logLine(entry, nameOf)}</small>) : <small>No moves yet.</small>}</div>
      {host && <button className="quiet end-round" disabled={busy} onClick={onEnd}>End game &amp; reveal</button>}
    </aside>
  </div>;
}

type ResultsProps = { view: EmpireView | null; players: EmpirePlayer[]; playerId: string; claimLog: ClaimLogEntry[]; colorOf: (id: string) => string; onLeave: () => void };

/** Final standings for Empire, with each score broken down and the map replay. */
export function EmpireResults({ view, players, playerId, claimLog, colorOf, onLeave }: ResultsProps) {
  const ranked = [...players].sort((a, b) => (view?.scores[b.id]?.total ?? 0) - (view?.scores[a.id]?.total ?? 0));
  const winners = view?.winnerIds ?? [];
  const winnerNames = winners.map((id) => players.find((player) => player.id === id)?.name ?? "Player");
  return <div className="panel results turns-results">
    <h1>{winnerNames.length ? `${winnerNames.join(" and ")} ${winnerNames.length > 1 ? "win" : "wins"}` : "Results"}</h1>
    <p className="lede">{view ? `Round ${Math.min(view.round, view.roundCap)} of ${view.roundCap}` : "Ended by the host"}</p>
    <div className="board">{ranked.map((player, index) => {
      const score = view?.scores[player.id];
      const owned = Object.entries(claimLog.reduce<Record<string, string>>((map, entry) => ({ ...map, [entry.code]: entry.playerId }), {}))
        .filter(([, owner]) => owner === player.id).map(([code]) => countryByCode(code)?.name ?? code).sort();
      return <article key={player.id} style={{ borderLeft: `4px solid ${colorOf(player.id)}`, paddingLeft: 12 }}>
        <small>{["1ST", "2ND", "3RD"][index]}</small><b>{player.name}{player.id === playerId ? " · YOU" : ""}{winners.includes(player.id) ? " · WINNER" : ""}</b>
        <strong>{score?.total ?? 0}<small>POINTS</small></strong>
        <div className="breakdown"><span><em>Countries</em><em>{score?.countries ?? 0}</em></span>{score && bonusLines(score).map((line) => <span key={line}><em>{line.replace(/ \+\d+$/, "")}</em><em>{line.match(/\+\d+$/)?.[0]}</em></span>)}<span><em>Final score</em><em>{score?.total ?? 0}</em></span></div>
        <div className="chips">{owned.map((name) => <span key={name}>{name}</span>)}</div>
      </article>;
    })}</div>
    <ResultsReplay claimLog={claimLog} players={players} youId={playerId}/>
    <button className="primary" onClick={onLeave}>Back to lobby</button>
  </div>;
}
