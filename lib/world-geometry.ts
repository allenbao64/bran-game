import { geoEqualEarth, geoPath } from "d3-geo";
import { feature, merge } from "topojson-client";
import type { GeometryCollection, GeometryObject, MultiPolygon, Polygon, Topology } from "topojson-specification";
import type { Feature, FeatureCollection, Geometry, GeoJsonProperties } from "geojson";
import worldCountries from "world-countries";
import { allCountryFacts, countryCodeFromNumericId } from "@/lib/countries";

export const MAP_WIDTH = 900;
export const MAP_HEIGHT = 450;
/** Countries drawn smaller than this (in map pixels squared) get a dot so they can be seen. */
export const MIN_VISIBLE_AREA = 4;

const WORLD_ATLAS = require("world-atlas/countries-110m.json") as Topology<{ countries: GeometryCollection<{ name: string }> }>;
const atlasFeatures = feature(WORLD_ATLAS, WORLD_ATLAS.objects.countries) as FeatureCollection<Geometry, GeoJsonProperties>;
const geometries = WORLD_ATLAS.objects.countries.geometries;
const polygonal = (g?: GeometryObject<{ name: string }>) => g as Polygon<{ name: string }> | MultiPolygon<{ name: string }> | undefined;
const somalia = polygonal(geometries.find((g) => String(g.id) === "706"));
const somaliland = polygonal(geometries.find((g) => (g.properties as { name?: string } | undefined)?.name === "Somaliland"));
/** Somaliland has no code of its own: it is fused into Somalia so the two draw and colour as one shape. */
const somaliaWhole: Feature<Geometry, GeoJsonProperties> | null = somalia && somaliland
  ? { type: "Feature", id: somalia.id, properties: { ...somalia.properties }, geometry: merge(WORLD_ATLAS, [somalia, somaliland]) }
  : null;
export const mapFeatures: FeatureCollection<Geometry, GeoJsonProperties> = {
  type: "FeatureCollection",
  features: atlasFeatures.features.flatMap((f) => !somaliaWhole ? [f] : f.properties?.name === "Somaliland" ? [] : String(f.id) === "706" ? [somaliaWhole] : [f])
};

/** The game country a drawn shape stands for, or undefined when the shape is not in the game (it is drawn hatched). */
export function featureCode(f: Feature<Geometry, GeoJsonProperties>) {
  return countryCodeFromNumericId(f.id) ?? (f.properties?.name === "Kosovo" ? "XK" : undefined);
}
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

/** Where a home marker sits for each game country: its dot, or the centre of its biggest drawn piece. */
export const homePoints: Record<string, [number, number]> = (() => {
  const points: Record<string, [number, number]> = {};
  for (const f of mapFeatures.features) {
    const code = featureCode(f);
    if (!code) continue;
    const parts: Geometry[] = f.geometry.type === "MultiPolygon" ? f.geometry.coordinates.map((coordinates) => ({ type: "Polygon", coordinates })) : [f.geometry];
    const biggest = parts.map((g) => ({ g, area: mapPath.area(g) })).sort((a, b) => b.area - a.area)[0];
    const [x, y] = mapPath.centroid(biggest.g);
    if (Number.isFinite(x) && Number.isFinite(y)) points[code] = [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  }
  for (const dot of mapDots) points[dot.code] = [dot.x, dot.y];
  return points;
})();
