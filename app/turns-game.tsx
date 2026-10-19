"use client";

import React, { FormEvent, useEffect, useRef, useState } from "react";
import { WorldMap } from "@/app/world-map";

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
  onEnd: () => void; colorOf: (id: string) => string;
};

/** In-game screen for turn-based Country Sprint: banner, card, input, scoreboard and the shared map. */
export function TurnsGame({ turn, scores, players, playerId, countryClaims, skewMs, entry, onEntry, notice, busy, onSubmit, onPass, onEnd, colorOf }: Props) {
  const [seconds, setSeconds] = useState(Math.ceil(turn.turnMs / 1000));
  const input = useRef<HTMLInputElement>(null);
  const current = players.find((player) => player.id === turn.currentPlayerId);
  const mine = turn.currentPlayerId === playerId;
  const me = players.find((player) => player.id === playerId);

  useEffect(() => {
    const tick = () => setSeconds(Math.max(0, Math.min(Math.ceil(turn.turnMs / 1000), Math.ceil((turn.startedAt + turn.turnMs - (Date.now() + skewMs)) / 1000))));
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [turn.number, turn.startedAt, turn.turnMs, skewMs]);

  useEffect(() => { if (mine) input.current?.focus(); }, [mine, turn.number]);

  return <div className="game"><section>
    <div className="game-head"><div><p className="kicker">COUNTRY SPRINT　<span className="live">● TURN-BASED</span></p><h1>Take your<br/><em>turn.</em></h1></div></div>
    <div className={mine ? "turn-banner mine" : "turn-banner"} style={{ borderLeftColor: current ? colorOf(current.id) : undefined }}>
      <div><small>{mine ? "YOUR TURN" : "NOW PLAYING"}</small><b>{mine ? "It’s your turn" : `${current?.name ?? "Another player"}’s turn`}</b></div>
      <div className={seconds <= 5 ? "turn-clock urgent" : "turn-clock"} aria-label="Seconds left this turn">{String(seconds).padStart(2, "0")}s</div>
    </div>
    <p className="round-line">ROUND {turn.round} OF {turn.totalRounds}{turn.doubleRound && <span className="double-banner">DOUBLE POINTS · CLAIMS WORTH 2</span>}</p>
    <div className="turn-card"><small>{mine ? "YOUR CARD" : `${current?.name?.toUpperCase() ?? "THEIR"} CARD`}</small><b>{turn.cardLabel ?? "No card"}</b></div>
    <form className="guess-form" onSubmit={onSubmit}>
      <input ref={input} className="field" placeholder={mine ? "Name a country that fits the card…" : `Waiting for ${current?.name ?? "the other player"}…`} value={entry} onChange={(event) => onEntry(event.target.value)} disabled={!mine || busy || seconds <= 0}/>
      <button className="primary" disabled={!mine || !entry.trim() || busy || seconds <= 0}>Claim ↵</button>
    </form>
    <div className="turn-actions"><button type="button" className="quiet" disabled={!mine || busy} onClick={onPass}>Pass</button></div>
    {notice && <p className="notice">{notice}</p>}
    <div className="scoreboard" aria-label="Scoreboard">{players.map((player) => {
      const score = scores[player.id];
      return <div className={player.id === turn.currentPlayerId ? "score-row active" : "score-row"} key={player.id} style={{ borderLeftColor: colorOf(player.id) }}>
        <b>{player.name}{player.id === playerId ? " (you)" : ""}</b><strong>{score?.total ?? 0}</strong>
        <small>{score?.points ?? 0} POINTS · LARGEST GROUP {score?.territory ?? 0}</small>
        {score?.bonuses.length ? <small>{score.bonuses.map((bonus) => <span className="bonus-chip" key={bonus.label}>+{bonus.points} {bonus.label}</span>)}</small> : <small>NO BONUSES YET</small>}
      </div>;
    })}</div>
    <WorldMap claims={countryClaims} players={players} youId={playerId}/>
  </section>
  <aside><div className="aside-title">THE ROOM <b>{players.length}/3</b></div>
    {players.map((player) => <div className="mini" key={player.id}><span style={{ background: colorOf(player.id), color: "#fff" }}>{player.name.slice(0, 1).toUpperCase()}</span><b>{player.name}{player.id === playerId ? " (you)" : ""}</b><i>{scores[player.id]?.total ?? 0}</i></div>)}
    <p className="aside-note">✳ Small region sets and the largest linked territory are worth +2 each. The last three rounds pay double.</p>
    {me?.host && <button className="quiet end-round" disabled={busy} onClick={onEnd}>End game &amp; reveal</button>}
  </aside></div>;
}
