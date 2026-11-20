// One game (playGame) and one configuration (runConfig). Records what section 3.2 asks for.
import { advanceTimeouts, applyAction, createGame, currentPlayerId, empire2Geo, isBoomPickPending, ownedBy, scorePlayer } from "@/lib/empire2";
import type { Empire2Geo } from "@/lib/empire2";
import { assertInvariants, miniGeo, newTrackers } from "@/tests/empire2-support";
import type { Action, BountyKind, EmpireState, Rules } from "@/lib/empire2/types";
import { decideBoomPick, decideSetup, decideTurn, makeKnownCapitals, PURE_STRATEGIES, type Strategy } from "./bots";
import { type ConfigSpec, type Field, MAX_ACTIONS_PER_TURN, MAX_TURNS_PER_GAME, type MapKind } from "./config";
import { mulberry32, streamSeed } from "./rng";
import { emptyStats, type GameRecord, type RoundRecord, type SeatRecord, type WaitingRecord, type SeatStats } from "./types";

export type PlayOptions = {
  geo: Empire2Geo;
  lineup: Strategy[];
  seed: number;
  knowP: number;
  slowP: number;
  rules?: Partial<Rules>;
  onStep?: (before: EmpireState, after: EmpireState) => void;
};

type StepKind = "setup" | "action" | "endTurn" | "timeout" | "pick";
type Waiting = { seat: number; outcome: WaitingRecord["outcome"] | null };

function bucketOf(round: number): 0 | 1 | 2 {
  if (round <= 4) return 0;
  if (round <= 9) return 1;
  return 2;
}

function seatOf(state: EmpireState, id: string): number {
  const p = state.players.find((x) => x.id === id);
  if (!p) throw new Error(`unknown player ${id}`);
  return p.seat;
}

/** Turns engine events into the records of section 3.2. Read-only on the engine states it sees. */
class Collector {
  readonly seats: { stats: SeatStats }[];
  readonly startVp: number[][] = [];
  readonly perRound: RoundRecord[] = [];
  readonly bountiesClaimed: Partial<Record<BountyKind, number>> = {};
  readonly waiting: Waiting[] = [];
  private readonly open = new Map<number, number>();   // seat -> index in waiting
  private curRound = 0;
  private totalTurns = 0;

  constructor(n: number) {
    this.seats = Array.from({ length: n }, () => ({ stats: emptyStats() }));
  }

  step(before: EmpireState, after: EmpireState, kind: StepKind): void {
    if (kind === "action") this.action(before, after);
    if (kind === "endTurn") this.turnEnd(before, after, true);
    if (kind === "timeout") this.turnEnd(before, after, false);
    // A round is recorded once its first turn exists: under underdogBoomPick the round starts before its booms and income.
    if (after.phase !== "setup" && after.turn !== null && after.round !== this.curRound) this.roundStarted(after);
  }

  private roundStarted(after: EmpireState): void {
    this.curRound = after.round;
    this.startVp.push(after.players.map((p) => after.roundStartVp[p.id] ?? 0));
    this.perRound.push({
      round: after.round,
      event: after.event,
      bountiesDrawn: after.bounties.map((b) => b.kind),
      income: after.players.map((p) => after.lastIncome?.[p.id]?.total ?? 0),
      expands: 0, colonizes: 0, cities: 0, annexes: 0, bountiesClaimed: 0,
    });
  }

  private action(before: EmpireState, after: EmpireState): void {
    const t = after.turn;
    if (t === null) throw new Error("action with no turn");
    const a = t.actions[t.actions.length - 1];
    if (a === undefined) throw new Error("action recorded no turn entry");
    const st = this.seats[t.seat].stats;
    st.count[a.type] += 1;
    st.spent[a.type] += a.cost;
    const rr = this.perRound[this.perRound.length - 1];
    if (a.type === "expand") rr.expands += 1;
    else if (a.type === "colonize") rr.colonizes += 1;
    else if (a.type === "city") rr.cities += 1;
    else rr.annexes += 1;
    if (a.bounty > 0) {
      st.bountyCount += 1;
      st.bountyInfluence += a.bounty;
      rr.bountiesClaimed += 1;
      const card = before.bounties.find((c) => !after.bounties.some((x) => x.id === c.id));
      if (card !== undefined) this.bountiesClaimed[card.kind] = (this.bountiesClaimed[card.kind] ?? 0) + 1;
    }
  }

  /** A played turn (`played` true) or a skipped one that the engine timed out (`played` false). */
  private turnEnd(before: EmpireState, after: EmpireState, played: boolean): void {
    const t = before.turn;
    if (t === null) throw new Error("turn end with no turn");
    this.totalTurns += 1;
    if (this.totalTurns > MAX_TURNS_PER_GAME) throw new Error(`game exceeded ${MAX_TURNS_PER_GAME} turns`);
    const seat = t.seat;
    const pid = t.playerId;
    if (played) {
      const st = this.seats[seat].stats;
      const b = bucketOf(before.round);
      st.turns += 1;
      st.turnsByBucket[b] += 1;
      if (t.isSecondOfTwo) st.secondTurns += 1;
      if (t.expands >= before.rules.maxExpandsPerTurn) {
        st.threeExpandTurns += 1;
        st.threeExpandByBucket[b] += 1;
      }
      if (t.actions.length === 0) st.idleTurns += 1;
      if (t.noFrontierAtStart) {
        st.noFrontierTurns += 1;
        if (t.colonizes >= 1) st.noFrontierColonized += 1;
        if (t.actions.length === 0) st.noFrontierIdle += 1;
      }
    } else {
      this.seats[seat].stats.skippedTurns += 1;
    }

    // Waiting wins (section 3.2): close an open event on the seat's next turn end, then open one on a second turn.
    const openIdx = this.open.get(seat);
    if (openIdx !== undefined) {
      if (after.phase === "finished" && after.result !== null && after.result.winners.includes(pid)) {
        this.waiting[openIdx].outcome = "won";
        this.open.delete(seat);
      } else if (after.phase === "play") {
        this.waiting[openIdx].outcome = "dropped";
        this.open.delete(seat);
      }
    }
    if (t.isSecondOfTwo && after.waitingWin.includes(pid) && !before.waitingWin.includes(pid)) {
      this.waiting.push({ seat, outcome: null });
      this.open.set(seat, this.waiting.length - 1);
    }
  }

  finish(state: EmpireState, geo: Empire2Geo, lineup: Strategy[]): GameRecord {
    const res = state.result;
    if (res === null) throw new Error("finish: no result");
    const seats: SeatRecord[] = state.players.map((p) => {
      const vp = scorePlayer(state, p.id, geo);
      return {
        seat: p.seat,
        strategy: lineup[p.seat],
        finalVp: res.vp[p.id],
        vp: {
          territory: vp.territory,
          cities: vp.cities,
          regionSets: vp.regionSets.reduce((sum, x) => sum + x.points, 0),
          largestEmpire: vp.largestEmpire,
          explorer: vp.explorer,
        },
        finalInfluence: p.influence,
        countries: ownedBy(state, p.id).length,
        cityCount: state.cities.filter((c) => state.owners[c] === p.id).length,
        stats: this.seats[p.seat].stats,
      };
    });
    const waiting: WaitingRecord[] = this.waiting.map((w) => ({ seat: w.seat, outcome: w.outcome ?? "preempted" }));
    return {
      seed: 0,
      n: state.players.length,
      lineup,
      winners: res.winners.map((id) => seatOf(state, id)),
      reason: res.reason,
      rounds: res.round,
      startVp: this.startVp,
      finalVp: state.players.map((p) => res.vp[p.id]),
      seats,
      perRound: this.perRound,
      bountiesClaimed: this.bountiesClaimed,
      waiting,
    };
  }
}

/** Plays one full game with the given lineup (section 3.1). A rejected bot action is a bug and throws. */
export function playGame(o: PlayOptions): GameRecord {
  const geo = o.geo;
  const n = o.lineup.length;
  const engineRng = mulberry32(streamSeed(o.seed, 1));
  const slowRng = mulberry32(streamSeed(o.seed, 3));
  const botRngs = o.lineup.map((_, s) => mulberry32(streamSeed(o.seed, 200 + s)));
  const known = o.lineup.map((_, s) => makeKnownCapitals(o.seed, s, geo, o.knowP));
  const ids = Array.from({ length: n }, (_, s) => `p${s}`);
  const created = createGame({ playerIds: ids, rules: o.rules }, { geo, rng: engineRng, now: 0 });
  if (!created.ok) throw new Error(`seed ${o.seed}: createGame failed: ${created.error.code}`);
  let state: EmpireState = created.state;
  const col = new Collector(n);

  while (state.phase === "setup") {
    const pid = currentPlayerId(state);
    if (pid === null) throw new Error(`seed ${o.seed}: setup has no picker`);
    const seat = seatOf(state, pid);
    const action = decideSetup(o.lineup[seat], state, geo, pid, botRngs[seat]);
    const before: EmpireState = state;
    const r = applyAction(state, pid, action, { geo, rng: engineRng, now: 0 });
    if (!r.ok) throw new Error(`seed ${o.seed} seat ${seat}: setup ${action.type} ${"code" in action ? action.code : ""} rejected: ${r.error.code}`);
    state = r.state;
    col.step(before, state, "setup");
    o.onStep?.(before, state);
  }

  while (state.phase === "play") {
    if (isBoomPickPending(state) && state.boomPick !== undefined) {
      // underdogBoomPick: the picker's bot makes the round's pick first. Its turn does not start until then.
      const pid = state.boomPick.playerId;
      const seat = seatOf(state, pid);
      const action = decideBoomPick(o.lineup[seat], state, geo, pid);
      const before: EmpireState = state;
      const r = applyAction(state, pid, action, { geo, rng: engineRng, now: state.boomPick.startedAt });
      if (!r.ok) throw new Error(`seed ${o.seed} seat ${seat} round ${state.round}: pickBoom ${action.type === "pickBoom" ? action.region : ""} rejected: ${r.error.code}`);
      state = r.state;
      col.step(before, state, "pick");
      o.onStep?.(before, state);
      continue;
    }
    const turn0 = state.turn;
    if (turn0 === null) throw new Error(`seed ${o.seed}: play with no turn`);
    const u = slowRng();
    if (u < o.slowP) {
      const before: EmpireState = state;
      state = advanceTimeouts(state, { geo, rng: engineRng, now: turn0.startedAt + state.turnMs });
      col.step(before, state, "timeout");
      o.onStep?.(before, state);
      continue;
    }
    let actions = 0;
    for (;;) {
      const cur = state.turn;
      if (cur === null || state.phase !== "play") break;
      const pid = cur.playerId;
      const action: Action = decideTurn(o.lineup[cur.seat], state, geo, pid, known[cur.seat], botRngs[cur.seat]);
      const before: EmpireState = state;
      const r = applyAction(state, pid, action, { geo, rng: engineRng, now: cur.startedAt });
      if (!r.ok) {
        const target = action.type === "endTurn" ? "" : action.type === "pickBoom" ? action.region : action.code;
        throw new Error(`seed ${o.seed} seat ${cur.seat} round ${state.round}: ${action.type} ${target} rejected: ${r.error.code}`);
      }
      state = r.state;
      if (action.type === "endTurn") {
        col.step(before, state, "endTurn");
        o.onStep?.(before, state);
        break;
      }
      actions += 1;
      if (actions > MAX_ACTIONS_PER_TURN) throw new Error(`seed ${o.seed}: more than ${MAX_ACTIONS_PER_TURN} actions in one turn`);
      col.step(before, state, "action");
      o.onStep?.(before, state);
    }
  }
  if (state.result === null) throw new Error(`seed ${o.seed}: game ended without a result`);
  const record = col.finish(state, geo, o.lineup);
  record.seed = o.seed;
  return record;
}

/** Seat strategies for game index i of a config (section 3.3). Pure function of (i, n, field). */
export function lineupFor(i: number, n: number, field: Field): Strategy[] {
  if (field === "mixed") return Array.from({ length: n }, () => "mixed" as Strategy);
  const b = Math.floor(i / n);
  const r = mulberry32(streamSeed(b, 2));
  const shuffled: Strategy[] = [...PURE_STRATEGIES];
  for (let j = 3; j >= 1; j--) {
    const k = Math.floor(r() * (j + 1));
    const tmp = shuffled[j];
    shuffled[j] = shuffled[k];
    shuffled[k] = tmp;
  }
  const lineup = shuffled.slice(0, n);
  const t = i % n;
  return lineup.map((_, k) => lineup[(k + t) % n]);
}

export function geoFor(map: MapKind) {
  return map === "real" ? empire2Geo : miniGeo;
}

export type RunOptions = {
  seedBase: number;
  rules?: Partial<Rules>;
  check?: boolean;
  log?: (line: string) => void;
};

/** Runs every game of a config. Progress lines every 100 games; a slow warning once (section 3.5). */
export function runConfig(spec: ConfigSpec, opts: RunOptions): GameRecord[] {
  const geo = geoFor(spec.map);
  const log = opts.log ?? ((line: string) => console.error(line));
  const records: GameRecord[] = [];
  const started = Date.now();
  let warned = false;
  for (let i = 0; i < spec.games; i++) {
    const seed = opts.seedBase + i;
    const lineup = lineupFor(i, spec.n, spec.field);
    const trackers = newTrackers();
    const onStep = opts.check && i < 200 ? (b: EmpireState, a: EmpireState) => assertInvariants(b, a, geo, trackers) : undefined;
    records.push(playGame({ geo, lineup, seed, knowP: spec.knowP, slowP: spec.slowP, rules: opts.rules, onStep }));
    const done = i + 1;
    const elapsed = (Date.now() - started) / 1000;
    if (done % 100 === 0 && done < spec.games) {
      const avgMs = (elapsed * 1000) / done;
      const eta = (avgMs * (spec.games - done)) / 1000;
      log(`[${spec.id}] ${done}/${spec.games} games  elapsed ${elapsed.toFixed(1)}s  avg ${avgMs.toFixed(0)} ms/game  eta ${eta.toFixed(0)}s`);
      const projectedMin = (avgMs * spec.games) / 60000;
      if (!warned && projectedMin > 20) {
        log(`WARNING slow: projected ${projectedMin.toFixed(1)} min`);
        warned = true;
      }
    }
  }
  const total = (Date.now() - started) / 1000;
  log(`[${spec.id}] done: ${spec.games} games in ${total.toFixed(1)}s`);
  return records;
}
