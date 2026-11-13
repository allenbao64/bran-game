"use client";

import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { WorldMap } from "@/app/world-map";
import { TurnBanner, useTurnFocus, useYourTurnTitle } from "@/app/turn-banner";
import { regionProgress } from "@/lib/turn-rules";

export type TurnView = {
  number: number; round: number; totalRounds: number; currentPlayerId: string | null;
  startedAt: number; turnMs: number; serverNow: number; finished: boolean;
  card: { kind: string } | null; cardLabel: string | null; doubleRound: boolean;
};
export type ScoreView = { points: number; bonuses: { label: string; points: number }[]; bonusTotal: number; total: number; territory: number };
export type ClaimLogEntry = { code: string; name: string; playerId: string; points: number; round: number; order: number; at: number };
type TurnPlayer = { id: string; name: string; host: boolean };

type Props = {
  turn: TurnView; scores: Record<string, ScoreView>; players: TurnPlayer[]; playerId: string;
  countryClaims: Record<string, string>; skewMs: number; entry: string; onEntry: (value: string) => void;
  notice: string; busy: boolean; onSubmit: (event: FormEvent) => void; onPass: () => void;
  onEnd: () => void; colorOf: (id: string) => string; largestGroups?: Record<string, string[]>; claimNote?: string;
};

/** In-game screen for turn-based Country Sprint: banner, card, input, scoreboard and the shared map. */
export function TurnsGame({ turn, scores, players, playerId, countryClaims, skewMs, entry, onEntry, notice, busy, onSubmit, onPass, onEnd, colorOf, largestGroups, claimNote }: Props) {
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

  const input = useTurnFocus(mine, turn.number);
  useYourTurnTitle(mine);
  const waiting = `Waiting for ${current?.name ?? "the other player"}…`;
  const regions = useMemo(() => regionProgress(countryClaims), [countryClaims]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const shown = regions.find((region) => region.name === (hovered ?? pinned));
  const nameOf = (id: string) => id === playerId ? "you" : players.find((player) => player.id === id)?.name ?? "someone";

  return <div className="game"><section>
    <TurnBanner mine={mine} name={current?.name ?? "another player"} color={current ? colorOf(current.id) : "#9aa29b"} seconds={seconds}/>
    <p className="round-line">ROUND {turn.round} OF {turn.totalRounds}{turn.doubleRound && <span className="double-banner">Double points</span>}</p>
    <div className="turn-card"><small>CARD</small><b>{turn.cardLabel ?? "No card"}</b></div>
    <form className="guess-form" onSubmit={onSubmit}>
      <input ref={input} className={mine ? "field turn-input active" : "field turn-input"} style={{ "--pc": current ? colorOf(current.id) : "#9aa29b" } as React.CSSProperties} placeholder={mine ? "Country name" : waiting} aria-label="Country name" value={entry} onChange={(event) => onEntry(event.target.value)} readOnly={busy} disabled={!mine || seconds <= 0}/>
      <button className="primary" disabled={!mine || !entry.trim() || busy || seconds <= 0}>Claim</button>
    </form>
    <div className="turn-actions"><button type="button" className="quiet" disabled={!mine || busy || seconds <= 0} onClick={onPass}>Pass</button></div>
    {notice ? <p className="notice">{notice}</p> : claimNote && <p className="claim-note">{claimNote}</p>}
    <div className="scoreboard" aria-label="Scoreboard">{players.map((player) => {
      const score = scores[player.id];
      return <div className={player.id === turn.currentPlayerId ? "score-row active" : "score-row"} key={player.id} style={{ borderLeftColor: colorOf(player.id) }}>
        <b>{player.name}{player.id === playerId ? " (you)" : ""}</b><strong>{score?.total ?? 0}</strong>
        <small>{score?.points ?? 0} POINTS · LARGEST GROUP {score?.territory ?? 0}</small>
        {score?.bonuses.length ? <small>{score.bonuses.map((bonus) => <span className="bonus-chip" key={bonus.label}>+{bonus.points} {bonus.label}</span>)}</small> : null}
      </div>;
    })}</div>
    <WorldMap claims={countryClaims} players={players} youId={playerId} emphasis={largestGroups} highlight={shown?.codes}/>
  </section>
  <aside><div className="aside-title">PLAYERS <b>{players.length}/3</b></div>
    {players.map((player) => <div className="mini" key={player.id}><span style={{ background: colorOf(player.id), color: "#fff" }}>{player.name.slice(0, 1).toUpperCase()}</span><b>{player.name}{player.id === playerId ? " (you)" : ""}</b><i>{scores[player.id]?.total ?? 0}</i></div>)}
    <div className="region-panel" aria-label="Region bonuses">
      <div className="aside-title">REGION BONUSES</div>
      <p className="region-help">Own every country in a region to score its bonus. Tap one to see it on the map.</p>
      {regions.map((region) => <button type="button" key={region.name} className={`region-row ${region.status}${pinned === region.name ? " pinned" : ""}`} aria-pressed={pinned === region.name}
        onMouseEnter={() => setHovered(region.name)} onMouseLeave={() => setHovered(null)}
        onClick={() => setPinned(pinned === region.name ? null : region.name)}>
        <span className="region-name">{region.name}</span><b>+{region.points}</b>
        <span className="region-state">{region.status === "won" ? `Won by ${nameOf(region.winner!)}`
          : region.status === "blocked" ? "Split, no bonus"
          : Object.keys(region.owned).length ? Object.entries(region.owned).map(([id, count]) => <i key={id} style={{ color: colorOf(id) }}>{nameOf(id)} {count}/{region.codes.length}</i>)
          : `${region.codes.length} countries, none taken`}</span>
      </button>)}
    </div>
    {me?.host && <button className="quiet end-round" disabled={busy} onClick={onEnd}>End game &amp; reveal</button>}
  </aside></div>;
}
