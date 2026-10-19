"use client";

import React, { useMemo } from "react";
import { geoEqualEarth, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import type { FeatureCollection, Geometry, GeoJsonProperties } from "geojson";
import { countryCodeFromNumericId } from "@/lib/countries";
import { playerColor } from "@/lib/player-colors";

const WORLD_ATLAS = require("world-atlas/countries-110m.json") as Topology<{ countries: GeometryCollection }>;
const countries = feature(WORLD_ATLAS, WORLD_ATLAS.objects.countries) as FeatureCollection<Geometry, GeoJsonProperties>;
const projection = geoEqualEarth().fitSize([900, 450], countries);
const path = geoPath(projection);

type MapPlayer = { id: string; name: string };
type WorldMapProps = { claims: Record<string, string>; players: MapPlayer[]; youId: string };

/** A shared board: every claimed country is filled with its owner's colour. */
export function WorldMap({ claims, players, youId }: WorldMapProps) {
  const ids = useMemo(() => players.map((player) => player.id), [players]);
  const names = useMemo(() => new Map(players.map((player) => [player.id, player.name])), [players]);
  const counts = useMemo(() => {
    const tally = new Map<string, number>();
    Object.values(claims).forEach((owner) => tally.set(owner, (tally.get(owner) ?? 0) + 1));
    return tally;
  }, [claims]);
  const total = Object.keys(claims).length;

  return <section className="world-map" aria-label="Live world map of claimed countries">
    <div className="world-map-heading"><span>LIVE WORLD MAP</span><b>{total} CLAIMED</b></div>
    <div className="map-legend">{players.map((player) => <span key={player.id} className="legend-item">
      <i style={{ background: playerColor(ids, player.id) }}/>{player.name}{player.id === youId ? " (you)" : ""}<b>{counts.get(player.id) ?? 0}</b>
    </span>)}</div>
    <svg viewBox="0 0 900 450" role="img" aria-label={`${total} countries have been claimed`}>
      <rect width="900" height="450" rx="8" className="map-ocean" />
      {countries.features.map((country, index) => {
        const code = countryCodeFromNumericId(country.id);
        const owner = code ? claims[code] : undefined;
        const d = path(country) ?? "";
        const ownerName = owner ? names.get(owner) ?? "Another player" : undefined;
        return <path key={`${country.id ?? "map"}-${index}`} d={d} className={owner ? "map-country claimed" : "map-country"}
          style={owner ? { fill: playerColor(ids, owner) } : undefined}>
          <title>{ownerName ? `Claimed by ${ownerName}${owner === youId ? " (you)" : ""}` : "Available country"}</title>
        </path>;
      })}
    </svg>
  </section>;
}
