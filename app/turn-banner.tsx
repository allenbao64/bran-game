"use client";

import React, { useEffect, useRef } from "react";

const TITLE_MINE = "Your turn · Atlas Sprint";

/** Shows "Your turn" in the tab title while it is the viewer's turn, then restores the previous title. */
export function useYourTurnTitle(mine: boolean) {
  useEffect(() => {
    if (!mine) return;
    const before = document.title;
    document.title = TITLE_MINE;
    return () => { document.title = before; };
  }, [mine]);
}

/** Focuses the input whenever `key` changes while it is the viewer's turn. */
export function useTurnFocus(mine: boolean, key: unknown) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (mine) input.current?.focus(); }, [mine, key]);
  return input;
}

type BannerProps = { mine: boolean; name: string; color: string; seconds: number };

/** Big "YOUR TURN" banner in the player's colour, or a quiet "Waiting for <name>…" line in theirs, with the turn clock beside it. */
export function TurnBanner({ mine, name, color, seconds }: BannerProps) {
  return <div className={mine ? "turn-banner mine" : "turn-banner"} style={mine ? { background: color, borderColor: color } : { borderLeftColor: color }}>
    <b className="turn-banner-text" style={mine ? undefined : { color }}>{mine ? "YOUR TURN" : `Waiting for ${name}…`}</b>
    <div className={seconds <= 5 ? "turn-clock urgent" : "turn-clock"} aria-label="Seconds left this turn">{String(seconds).padStart(2, "0")}s</div>
  </div>;
}
