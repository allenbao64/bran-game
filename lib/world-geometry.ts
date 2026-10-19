import { geoEqualEarth, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import type { FeatureCollection, Geometry, GeoJsonProperties } from "geojson";
import worldCountries from "world-countries";
import { allCountryFacts, countryCodeFromNumericId } from "@/lib/countries";

export const MAP_WIDTH = 900;
export const MAP_HEIGHT = 450;
/** Countries drawn smaller than this (in map pixels squared) get a dot so they can be seen. */
export const MIN_VISIBLE_AREA = 4;

const WORLD_ATLAS = require("world-atlas/countries-110m.json") as Topology<{ countries: GeometryCollection }>;
export const mapFeatures = feature(WORLD_ATLAS, WORLD_ATLAS.objects.countries) as FeatureCollection<Geometry, GeoJsonProperties>;
export const projection = geoEqualEarth().fitSize([MAP_WIDTH, MAP_HEIGHT], mapFeatures);
export const mapPath = geoPath(projection);

export type MapDot = { code: string; x: number; y: number };

/**
 * Small countries are missing from the 110m world map (Monaco, Tuvalu, most
 * island nations) or drawn smaller than a pixel. Each one gets a dot at its
 * centre point so it can still be seen, coloured and hovered.
 */
export const mapDots: MapDot[] = (() => {
  const drawnArea = new Map<string, number>();
  for (const country of mapFeatures.features) {
    const code = countryCodeFromNumericId(country.id);
    if (code) drawnArea.set(code, (drawnArea.get(code) ?? 0) + mapPath.area(country));
  }
  const centres = new Map(worldCountries.map((c) => [c.cca2, c.latlng]));
  const dots: MapDot[] = [];
  for (const { code } of allCountryFacts()) {
    if ((drawnArea.get(code) ?? 0) >= MIN_VISIBLE_AREA) continue;
    const latlng = centres.get(code);
    const point = latlng ? projection([latlng[1], latlng[0]]) : null;
    // Keep dots inside the frame: Tuvalu sits just past the right edge.
    const inside = (value: number, max: number) => Math.round(Math.min(max - 4, Math.max(4, value)) * 10) / 10;
    if (point) dots.push({ code, x: inside(point[0], MAP_WIDTH), y: inside(point[1], MAP_HEIGHT) });
  }
  return dots.sort((a, b) => a.code.localeCompare(b.code));
})();
