"use client";

import React, { useMemo } from "react";
import { mapDots, mapFeatures as countries, mapPath as path } from "@/lib/world-geometry";
import { countryCodeFromNumericId } from "@/lib/countries";
import { playerColor } from "@/lib/player-colors";

type MapPlayer = { id: string; name: string };
/** `emphasis` maps a player id to the country codes to outline thickly in that player's colour (their largest territory). */
type WorldMapProps = { claims: Record<string, string>; players: MapPlayer[]; youId: string; heading?: string; emphasis?: Record<string, string[]>; compact?: boolean };

/** A shared board: every claimed country is filled with its owner's colour. */
export function WorldMap({ claims, players, youId, heading = "LIVE WORLD MAP", emphasis, compact = false }: WorldMapProps) {
  const ids = useMemo(() => players.map((player) => player.id), [players]);
  const names = useMemo(() => new Map(players.map((player) => [player.id, player.name])), [players]);
  const counts = useMemo(() => {
    const tally = new Map<string, number>();
    Object.values(claims).forEach((owner) => tally.set(owner, (tally.get(owner) ?? 0) + 1));
    return tally;
  }, [claims]);
  const total = Object.keys(claims).length;
  const emphasised = useMemo(() => {
    const byCode = new Map<string, string>();
    for (const [owner, codes] of Object.entries(emphasis ?? {})) codes.forEach((code) => { if (claims[code] === owner) byCode.set(code, owner); });
    return byCode;
  }, [emphasis, claims]);
  // Emphasised countries are drawn last so their thick outline sits above the neighbours.
  const drawn = useMemo(() => countries.features.map((country, index) => ({ country, index, code: countryCodeFromNumericId(country.id) }))
    .sort((a, b) => Number(emphasised.has(a.code ?? "")) - Number(emphasised.has(b.code ?? ""))), [emphasised]);

  return <section className="world-map" aria-label="Live world map of claimed countries">
    {!compact && <><div className="world-map-heading"><span>{heading}</span><b>{total} CLAIMED</b></div>
    <div className="map-legend">{players.map((player) => <span key={player.id} className="legend-item">
      <i style={{ background: playerColor(ids, player.id) }}/>{player.name}{player.id === youId ? " (you)" : ""}<b>{counts.get(player.id) ?? 0}</b>
    </span>)}</div></>}
    <svg viewBox="0 0 900 450" role="img" aria-label={`${total} countries have been claimed`}>
      <rect width="900" height="450" rx="8" className="map-ocean" />
      {drawn.map(({ country, index, code }) => {
        const owner = code ? claims[code] : undefined;
        const d = path(country) ?? "";
        const ownerName = owner ? names.get(owner) ?? "Another player" : undefined;
        const outlined = code ? emphasised.has(code) : false;
        return <path key={`${country.id ?? "map"}-${index}`} d={d} className={`map-country${owner ? " claimed" : ""}${outlined ? " territory" : ""}`}
          style={owner ? { fill: playerColor(ids, owner), ...(outlined ? { stroke: playerColor(ids, owner) } : {}) } : undefined}>
          <title>{ownerName ? `Claimed by ${ownerName}${owner === youId ? " (you)" : ""}${outlined ? " · part of their largest territory" : ""}` : "Available country"}</title>
        </path>;
      })}
      {mapDots.map(({ code, x, y }) => {
        const owner = claims[code];
        const ownerName = owner ? names.get(owner) ?? "Another player" : undefined;
        const outlined = emphasised.has(code);
        return <circle key={`dot-${code}`} cx={x} cy={y} r={3.2} data-code={code} className={`map-dot${owner ? " claimed" : ""}${outlined ? " territory" : ""}`}
          style={owner ? { fill: playerColor(ids, owner) } : undefined}>
          <title>{ownerName ? `Claimed by ${ownerName}${owner === youId ? " (you)" : ""}${outlined ? " · part of their largest territory" : ""}` : "Available country"}</title>
        </circle>;
      })}
    </svg>
  </section>;
}
