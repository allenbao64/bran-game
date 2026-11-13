"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { MAP_HEIGHT, MAP_WIDTH, mapDots, mapFeatures as countries, mapPath as path } from "@/lib/world-geometry";
import { dragSpeed, GLIDE_DECAY, GLIDE_MIN_SPEED, IDENTITY_VIEW, MAX_ZOOM, MIN_ZOOM, panBy, pinchView, wheelFactor, wheelIntent, zoomAt, ZOOM_STEP, type MapView } from "@/lib/map-zoom";
import { countryCodeFromNumericId } from "@/lib/countries";
import { playerColor } from "@/lib/player-colors";

type MapPlayer = { id: string; name: string };
/** `targets` are country codes to mark with a dashed outline (what the viewer can steal). `emphasis` maps a player id to the country codes to outline thickly in that player's colour (their largest territory). */
type WorldMapProps = { claims: Record<string, string>; players: MapPlayer[]; youId: string; heading?: string; emphasis?: Record<string, string[]>; compact?: boolean; targets?: string[] };

/** A shared board: every claimed country is filled with its owner's colour. */
export function WorldMap({ claims, players, youId, heading = "LIVE WORLD MAP", emphasis, compact = false, targets }: WorldMapProps) {
  const marked = useMemo(() => (targets ? new Set(targets) : undefined), [targets]);
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

  const zoomable = !compact;
  const [view, setView] = useState<MapView>(IDENTITY_VIEW);
  const svgRef = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const velocity = useRef({ x: 0, y: 0, at: 0 });
  const glide = useRef(0);
  const viewRef = useRef(view);
  viewRef.current = view;
  const update = (next: MapView) => { viewRef.current = next; setView(next); };
  // Client pixels to map pixels.
  const toMap = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const scale = rect.width ? MAP_WIDTH / rect.width : 1;
    return { x: (clientX - rect.left) * scale, y: (clientY - rect.top) * scale, scale };
  };
  const pinchOf = () => {
    const [a, b] = [...pointers.current.values()];
    return { ...toMap((a.x + b.x) / 2, (a.y + b.y) / 2), dist: Math.hypot(a.x - b.x, a.y - b.y) * toMap(0, 0).scale };
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!zoomable || !svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const at = toMap(event.clientX, event.clientY);
      const lines = event.deltaMode === 1 ? 16 : 1;
      if (wheelIntent(event) === "zoom") update(zoomAt(viewRef.current, wheelFactor(event.deltaY * lines), at.x, at.y, MAP_WIDTH, MAP_HEIGHT));
      else update(panBy(viewRef.current, -event.deltaX * lines * at.scale, -event.deltaY * lines * at.scale, MAP_WIDTH, MAP_HEIGHT));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoomable]);

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (glide.current) cancelAnimationFrame(glide.current);
    velocity.current = { x: 0, y: 0, at: performance.now() };
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (event.pointerType === "mouse" || viewRef.current.k > 1 || pointers.current.size > 1) event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const last = pointers.current.get(event.pointerId);
    if (!last) return;
    if (pointers.current.size === 2) {
      const from = pinchOf();
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      update(pinchView(viewRef.current, from, pinchOf(), MAP_WIDTH, MAP_HEIGHT));
    } else if (pointers.current.size === 1 && viewRef.current.k > 1) {
      const scale = toMap(0, 0).scale * dragSpeed(viewRef.current.k);
      const dx = (event.clientX - last.x) * scale, dy = (event.clientY - last.y) * scale;
      const now = performance.now(), dt = Math.max(1, now - velocity.current.at);
      velocity.current = { x: 0.6 * dx / dt + 0.4 * velocity.current.x, y: 0.6 * dy / dt + 0.4 * velocity.current.y, at: now };
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      update(panBy(viewRef.current, dx, dy, MAP_WIDTH, MAP_HEIGHT));
    }
  };
  const onPointerEnd = (event: React.PointerEvent<SVGSVGElement>) => {
    const wasPanning = pointers.current.size === 1 && viewRef.current.k > 1;
    pointers.current.delete(event.pointerId);
    let { x: vx, y: vy, at } = velocity.current;
    if (!wasPanning || performance.now() - at > 80 || Math.hypot(vx, vy) < GLIDE_MIN_SPEED) return;
    let last = performance.now();
    const step = (now: number) => {
      const dt = now - last; last = now;
      update(panBy(viewRef.current, vx * dt, vy * dt, MAP_WIDTH, MAP_HEIGHT));
      vx *= GLIDE_DECAY; vy *= GLIDE_DECAY;
      if (Math.hypot(vx, vy) >= GLIDE_MIN_SPEED) glide.current = requestAnimationFrame(step);
    };
    glide.current = requestAnimationFrame(step);
  };
  useEffect(() => () => { if (glide.current) cancelAnimationFrame(glide.current); }, []);
  const zoomBy = (factor: number) => update(zoomAt(viewRef.current, factor, MAP_WIDTH / 2, MAP_HEIGHT / 2, MAP_WIDTH, MAP_HEIGHT));
  const zoomed = view.k > 1;

  return <section className="world-map" aria-label="Live world map of claimed countries">
    {!compact && <><div className="world-map-heading"><span>{heading}</span><b>{total} CLAIMED</b></div>
    <div className="map-legend">{players.map((player) => <span key={player.id} className="legend-item">
      <i style={{ background: playerColor(ids, player.id) }}/>{player.name}{player.id === youId ? " (you)" : ""}<b>{counts.get(player.id) ?? 0}</b>
    </span>)}</div></>}
    <div className="map-stage">
    <svg ref={svgRef} viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} role="img" aria-label={`${total} countries have been claimed`}
      className={zoomable ? `map-zoomable${zoomed ? " zoomed" : ""}` : undefined}
      onPointerDown={zoomable ? onPointerDown : undefined} onPointerMove={zoomable ? onPointerMove : undefined} onPointerUp={zoomable ? onPointerEnd : undefined} onPointerCancel={zoomable ? onPointerEnd : undefined}>
      <rect width="900" height="450" rx="8" className="map-ocean" />
      <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
      {drawn.map(({ country, index, code }) => {
        const owner = code ? claims[code] : undefined;
        const d = path(country) ?? "";
        const ownerName = owner ? names.get(owner) ?? "Another player" : undefined;
        const outlined = code ? emphasised.has(code) : false;
        return <path key={`${country.id ?? "map"}-${index}`} d={d} className={`map-country${owner ? " claimed" : ""}${outlined ? " territory" : ""}${code && marked?.has(code) ? " steal-target" : ""}`}
          style={owner ? { fill: playerColor(ids, owner), ...(outlined ? { stroke: playerColor(ids, owner) } : {}) } : undefined}>
          <title>{ownerName ? `Claimed by ${ownerName}${owner === youId ? " (you)" : ""}${outlined ? " · part of their largest territory" : ""}` : "Available country"}</title>
        </path>;
      })}
      {mapDots.map(({ code, x, y }) => {
        const owner = claims[code];
        const ownerName = owner ? names.get(owner) ?? "Another player" : undefined;
        const outlined = emphasised.has(code);
        return <circle key={`dot-${code}`} cx={x} cy={y} r={3.2 / view.k} data-code={code} className={`map-dot${owner ? " claimed" : ""}${outlined ? " territory" : ""}${marked?.has(code) ? " steal-target" : ""}`}
          style={owner ? { fill: playerColor(ids, owner) } : undefined}>
          <title>{ownerName ? `Claimed by ${ownerName}${owner === youId ? " (you)" : ""}${outlined ? " · part of their largest territory" : ""}` : "Available country"}</title>
        </circle>;
      })}
      </g>
    </svg>
    {zoomable && <div className="map-zoom-controls" role="group" aria-label="Map zoom">
      <button type="button" aria-label="Zoom in" disabled={view.k >= MAX_ZOOM} onClick={() => zoomBy(ZOOM_STEP)}>+</button>
      <button type="button" aria-label="Zoom out" disabled={view.k <= MIN_ZOOM} onClick={() => zoomBy(1 / ZOOM_STEP)}>−</button>
      <button type="button" aria-label="Reset zoom" className="map-zoom-reset" disabled={!zoomed} onClick={() => update(IDENTITY_VIEW)}>Reset</button>
    </div>}
    </div>
  </section>;
}
