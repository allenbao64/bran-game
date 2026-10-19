"use client";

import React, { useMemo } from "react";
import { geoEqualEarth, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import type { FeatureCollection, Geometry, GeoJsonProperties } from "geojson";
import { countryCodeFromNumericId } from "@/lib/countries";

const WORLD_ATLAS = require("world-atlas/countries-110m.json") as Topology<{ countries: GeometryCollection }>;
const countries = feature(WORLD_ATLAS, WORLD_ATLAS.objects.countries) as FeatureCollection<Geometry, GeoJsonProperties>;
const projection = geoEqualEarth().fitSize([900, 450], countries);
const path = geoPath(projection);

type WorldMapProps = { lockedCodes: string[] };

/** A shared board: it shows which countries are gone, never who claimed them. */
export function WorldMap({ lockedCodes }: WorldMapProps) {
  const locked = useMemo(() => new Set(lockedCodes), [lockedCodes]);

  return <section className="world-map" aria-label="Live world map of claimed countries">
    <div className="world-map-heading"><span>LIVE WORLD MAP</span><b>{locked.size} CLAIMED</b></div>
    <p>Claimed countries turn orange. The map never shows who claimed them.</p>
    <svg viewBox="0 0 900 450" role="img" aria-label={`${locked.size} countries have been claimed`}>
      <rect width="900" height="450" rx="8" className="map-ocean" />
      {countries.features.map((country, index) => {
        const code = countryCodeFromNumericId(country.id);
        const claimed = code ? locked.has(code) : false;
        const d = path(country) ?? "";
        return <path key={`${country.id ?? "map"}-${index}`} d={d} className={claimed ? "map-country claimed" : "map-country"}>
          <title>{claimed ? "Claimed country" : "Available country"}</title>
        </path>;
      })}
    </svg>
  </section>;
}
