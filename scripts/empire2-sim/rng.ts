import type { Rng } from "@/lib/empire2/types";

/** mulberry32, the same algorithm as tests/empire2-support.ts (copied so scripts do not import tests). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seed of one named random stream inside a game. */
export function streamSeed(seed: number, tag: number): number {
  return (Math.imul(seed >>> 0, 2654435761) + Math.imul(tag, 40503)) >>> 0;
}
