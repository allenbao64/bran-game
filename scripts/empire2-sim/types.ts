import type { BountyKind, EventKind } from "@/lib/empire2/types";
import type { Strategy } from "./bots";

export type { Strategy };

export type ActionKind = "expand" | "colonize" | "city" | "annex";

export type SeatStats = {
  turns: number; skippedTurns: number; idleTurns: number;      // idle = played turn with zero successful actions
  threeExpandTurns: number; secondTurns: number;               // secondTurns: played turns with isSecondOfTwo
  noFrontierTurns: number;       // played turns with turn.noFrontierAtStart
  noFrontierColonized: number;   // of those, turns with colonizes >= 1
  noFrontierIdle: number;        // of those, turns with zero actions
  count: { expand: number; colonize: number; city: number; annex: number };
  spent: { expand: number; colonize: number; city: number; annex: number };
  bountyCount: number; bountyInfluence: number;
  threeExpandByBucket: [number, number, number]; turnsByBucket: [number, number, number];   // buckets: rounds 1-4, 5-9, 10+
};

export type SeatRecord = {
  seat: number; strategy: Strategy; finalVp: number;
  vp: { territory: number; cities: number; regionSets: number; largestEmpire: number; explorer: number };
  finalInfluence: number; countries: number; cityCount: number; stats: SeatStats;
};

export type RoundRecord = {
  round: number; event: EventKind | null;
  bountiesDrawn: BountyKind[]; income: number[];     // per seat: lastIncome[id].total
  expands: number; colonizes: number; cities: number; annexes: number; bountiesClaimed: number;
};

export type WaitingRecord = { seat: number; outcome: "won" | "dropped" | "preempted" };

export type GameRecord = {
  seed: number; n: number; lineup: Strategy[];
  winners: number[]; reason: "points" | "cap"; rounds: number;
  startVp: number[][];            // startVp[r-1][seat] = roundStartVp at the start of round r
  finalVp: number[];              // by seat, = result.vp
  seats: SeatRecord[]; perRound: RoundRecord[];
  bountiesClaimed: Partial<Record<BountyKind, number>>;
  waiting: WaitingRecord[];
};

export function emptyStats(): SeatStats {
  return {
    turns: 0, skippedTurns: 0, idleTurns: 0,
    threeExpandTurns: 0, secondTurns: 0,
    noFrontierTurns: 0, noFrontierColonized: 0, noFrontierIdle: 0,
    count: { expand: 0, colonize: 0, city: 0, annex: 0 },
    spent: { expand: 0, colonize: 0, city: 0, annex: 0 },
    bountyCount: 0, bountyInfluence: 0,
    threeExpandByBucket: [0, 0, 0], turnsByBucket: [0, 0, 0],
  };
}
