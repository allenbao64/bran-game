"use client";

import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { WorldMap } from "@/app/world-map";
import { TurnStatus, useTurnFocus, useYourTurnTitle } from "@/app/turn-banner";
import { countryFacts } from "@/lib/countries";
import { regionProgress } from "@/lib/turn-rules";

export type TurnView = {
  number: number; round: number; totalRounds: number; currentPlayerId: string | null;
  startedAt: number; turnMs: number; serverNow: number; finished: boolean;
  card: { kind: string } | null; cardLabel: string | null; doubleRound: boolean;
};
export type ScoreView = { points: number; bonuses: { label: string; points: number }[]; bonusTotal: number; total: number; territory: number };
export type ClaimLogEntry = { code: string; name: string; playerId: string; points: number; round: number; order: number; at: number };
export type GuessEntry = { playerId: string; kind: "claimed" | "wrong" | "passed" | "timeout"; code: string | null; text: string; points: number; at: number };
type TurnPlayer = { id: string; name: string; host: boolean };

type Props = {
  turn: TurnView; scores: Record<string, ScoreView>; players: TurnPlayer[]; playerId: string;
  countryClaims: Record<string, string>; skewMs: number; entry: string; onEntry: (value: string) => void;
  notice: string; busy: boolean; onSubmit: (event: FormEvent) => void; onPass: () => void;
  onEnd: () => void; colorOf: (id: string) => string; largestGroups?: Record<string, string[]>; claimNote?: string;
  startCountries?: Record<string, string>; recentGuesses?: GuessEntry[];
};

/** In-game screen for turn-based Country Sprint: a frozen bar (turn, card, input), the shared map, and a narrow column of scores, recent guesses and region bonuses. */
export function TurnsGame({ turn, scores, players, playerId, countryClaims, skewMs, entry, onEntry, notice, busy, onSubmit, onPass, onEnd, colorOf, largestGroups, claimNote, startCountries = {}, recentGuesses = [] }: Props) {
  const [seconds, setSeconds] = useState(Math.ceil(turn.turnMs / 1000));
  const current = players.find((player) => player.id === turn.currentPlayerId);
  const mine = turn.currentPlayerId === playerId;
  const me = players.find((player) => player.id === playerId);

  useEffect(() => {
    const tick = () => setSeconds(Math.max(0, Math.min(Math.ceil(turn.turnMs / 1000), Math.ceil((turn.startedAt + turn.turnMs - (Date.now() + skewMs)) / 1000))));
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [turn.number, turn.startedAt, turn.turnMs, skewMs]);

  const input = useTurnFocus(mine, turn.number, busy);
  useYourTurnTitle(mine);
  const waiting = `Waiting for ${current?.name ?? "the other player"}…`;
  const regions = useMemo(() => regionProgress(countryClaims), [countryClaims]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const shown = regions.find((region) => region.name === (hovered ?? pinned));
  const nameOf = (id: string) => id === playerId ? "you" : players.find((player) => player.id === id)?.name ?? "someone";

  const tint = current ? colorOf(current.id) : "#9aa29b";
  const homes = Object.fromEntries(Object.entries(startCountries).filter(([id]) => players.some((player) => player.id === id)));
  const guessText = (entry: GuessEntry) => {
    const country = entry.code ? countryFacts(entry.code)?.name : undefined;
    if (entry.kind !== "wrong" || !country || !entry.text.startsWith(country)) return <span className={entry.kind === "claimed" ? undefined : "muted"}>{entry.text}</span>;
    return <><s>{country}</s><span className="muted">{entry.text.slice(country.length)}</span></>;
  };

  return <div className="game turns-layout">
    <header className="turn-bar">
      <div className="turn-bar-head">
        <TurnStatus mine={mine} name={current?.name ?? "another player"} color={tint} seconds={seconds}/>
        <span className="round-line">Round {turn.round} of {turn.totalRounds}{turn.doubleRound && <span className="double-banner">Double points</span>}</span>
      </div>
      <div className="turn-bar-play">
        <b className="turn-card-text" aria-label="Card">{turn.cardLabel ?? "No card"}</b>
        <form className="guess-form" onSubmit={onSubmit}>
          <input ref={input} className={mine ? "field turn-input active" : "field turn-input"} style={{ "--pc": tint } as React.CSSProperties} placeholder={mine ? "Country name" : waiting} aria-label="Country name" value={entry} onChange={(event) => onEntry(event.target.value)} readOnly={busy} disabled={!mine || seconds <= 0}/>
          <button className="primary" disabled={!mine || !entry.trim() || busy || seconds <= 0}>Claim</button>
          <button type="button" className="quiet" disabled={!mine || busy || seconds <= 0} onClick={onPass}>Pass</button>
        </form>
      </div>
      <div className="turn-note">{notice ? <p className="notice">{notice}</p> : claimNote && <p className="claim-note">{claimNote}</p>}</div>
    </header>
    <div className="turn-map"><WorldMap claims={countryClaims} players={players} youId={playerId} emphasis={largestGroups} highlight={shown?.codes} homes={homes} heading="MAP · ⌂ = starting country"/></div>
    <aside className="turn-side">
      <div className="scoreboard" aria-label="Scoreboard">{players.map((player) => {
        const score = scores[player.id];
        const start = startCountries[player.id] ? countryFacts(startCountries[player.id])?.name : undefined;
        return <div className={player.id === turn.currentPlayerId ? "score-row active" : "score-row"} key={player.id}>
          <i className="score-dot" style={{ background: colorOf(player.id) }}/>
          <b>{player.name}{player.id === playerId ? " (you)" : ""}</b><strong>{score?.total ?? 0}</strong>
          <small>{start ? `start ${start} · ` : ""}group {score?.territory ?? 0}</small>
          {score?.bonuses.length ? <small className="chips-line">{score.bonuses.map((bonus) => <span className="bonus-chip" key={bonus.label}>+{bonus.points} {bonus.label}</span>)}</small> : null}
        </div>;
      })}</div>
      <div className="side-title">Recent guesses</div>
      <ol className="guess-feed" aria-label="Recent guesses">{recentGuesses.slice(0, 8).map((entry, index) => <li key={`${entry.at}-${index}`} className={entry.kind}>
        <b style={{ color: colorOf(entry.playerId) }}>{players.find((player) => player.id === entry.playerId)?.name ?? "Someone"}</b> {guessText(entry)}{entry.kind === "claimed" && <em> +{entry.points}</em>}
      </li>)}</ol>
      <div className="region-panel" aria-label="Region bonuses">
        <div className="side-title">Region bonuses</div>
        {regions.map((region) => <button type="button" key={region.name} className={`region-row ${region.status}${pinned === region.name ? " pinned" : ""}`} aria-pressed={pinned === region.name}
          onMouseEnter={() => setHovered(region.name)} onMouseLeave={() => setHovered(null)}
          onClick={() => setPinned(pinned === region.name ? null : region.name)}>
          <span className="region-name">{region.name}</span>
          <span className="region-state">{region.status === "won" ? <i style={{ color: colorOf(region.winner!) }}>{nameOf(region.winner!)} won</i>
            : region.status === "blocked" ? "split"
            : Object.keys(region.owned).length ? Object.entries(region.owned).map(([id, count]) => <i key={id} style={{ color: colorOf(id) }}>{nameOf(id)} {count}/{region.codes.length}</i>)
            : `0/${region.codes.length}`}</span>
          <b>+{region.points}</b>
        </button>)}
      </div>
      {me?.host && <button className="quiet end-round" disabled={busy} onClick={onEnd}>End game &amp; reveal</button>}
    </aside>
  </div>;
}
