"use client";

import React, { useEffect, useMemo, useState } from "react";
import { WorldMap } from "@/app/world-map";
import type { ClaimLogEntry } from "@/app/turns-game";

type Props = { claimLog: ClaimLogEntry[]; players: { id: string; name: string }[]; youId: string };

/** Animates the final map filling in claim order, in each owner's colour. */
export function ResultsReplay({ claimLog, players, youId }: Props) {
  const [step, setStep] = useState(claimLog.length);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setStep((current) => {
        if (current >= claimLog.length) { setPlaying(false); return current; }
        return current + 1;
      });
    }, 350);
    return () => window.clearInterval(id);
  }, [playing, claimLog.length]);

  const claims = useMemo(() => Object.fromEntries(claimLog.slice(0, step).map((entry) => [entry.code, entry.playerId])), [claimLog, step]);
  const last = step > 0 ? claimLog[step - 1] : null;
  const who = last ? players.find((player) => player.id === last.playerId)?.name : null;

  return <div className="replay">
    <div className="replay-controls">
      <button type="button" className="primary" disabled={!claimLog.length} onClick={() => { setStep(0); setPlaying(true); }}>{playing ? "Replaying…" : "▶ Play"}</button>
      <small>{last ? `CLAIM ${step} OF ${claimLog.length} · ${who} TOOK ${last.name.toUpperCase()} (+${last.points})` : playing ? "REPLAYING…" : claimLog.length ? "PRESS PLAY TO WATCH THE MAP FILL IN" : "NO CLAIMS WERE MADE"}</small>
    </div>
    <WorldMap claims={claims} players={players} youId={youId} heading="REPLAY"/>
  </div>;
}
