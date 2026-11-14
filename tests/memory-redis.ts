type StoredRoom = {
  code: string;
  gameId?: "countries" | "champions" | "overwatch";
  status: "waiting" | "playing" | "ended";
  createdAt: number;
  startedAt: number | null;
  mode?: string;
  turnSeconds?: number;
  rounds?: number;
  turn?: { number: number; order: string[]; deal?: unknown };
  claims?: { code: string; playerId: string; points: number; round: number; turn: number; at: number }[];
  startCountries?: Record<string, string>;
  recentCards?: unknown[];
  recentGuesses?: unknown[];
  players: { id: string; token: string; name: string; host: boolean }[];
};

/** A small Redis test double for the commands used by the API routes. */
export class MemoryRedis {
  private values = new Map<string, unknown>();
  private hashes = new Map<string, Record<string, string>>();
  private zsets = new Map<string, Map<string, number>>();
  private ttls = new Map<string, number>();
  /** Every write the game logs make, in order (mirrors what the real commands would do). */
  readonly writes: { cmd: "hset" | "expire" | "zadd" | "zremrangebyscore"; key: string; fields?: string[]; option?: string }[] = [];

  async set(key: string, value: unknown, options?: { nx?: boolean }) {
    if (options?.nx && this.values.has(key)) return null;
    this.values.set(key, structuredClone(value));
    return "OK";
  }

  async get<T>(key: string): Promise<T | null> {
    const value = this.values.get(key);
    return value === undefined ? null : structuredClone(value) as T;
  }

  async hgetall<T>(key: string): Promise<T | null> {
    const value = this.hashes.get(key);
    return value ? structuredClone(value) as T : null;
  }

  async hsetnx(key: string, field: string, value: string) {
    const hash = this.hashes.get(key) ?? {};
    if (Object.hasOwn(hash, field)) return 0;
    hash[field] = value;
    this.hashes.set(key, hash);
    return 1;
  }

  async hkeys(key: string) {
    return Object.keys(this.hashes.get(key) ?? {});
  }

  /** Like Redis HSET: stores strings as they are and JSON-encodes other values (the Upstash client does the same). Returns the number of new fields. Keeps the key's TTL. */
  async hset(key: string, kv: Record<string, unknown>) {
    const hash = this.hashes.get(key) ?? {};
    let added = 0;
    for (const [field, value] of Object.entries(kv)) {
      if (!Object.hasOwn(hash, field)) added++;
      hash[field] = typeof value === "string" ? value : JSON.stringify(value);
    }
    this.hashes.set(key, hash);
    this.writes.push({ cmd: "hset", key, fields: Object.keys(kv) });
    return added;
  }

  /** Like Redis EXPIRE: 1 and the TTL is recorded when the key exists, 0 and nothing recorded otherwise. With "NX" (Redis 7): the TTL is set only when the key has none; 0 when it has one or the key is missing. */
  async expire(key: string, seconds: number, option?: string) {
    this.writes.push({ cmd: "expire", key, option });
    const exists = this.values.has(key) || this.hashes.has(key) || this.zsets.has(key);
    if (!exists) return 0;
    if (option === "NX" && this.ttls.has(key)) return 0;
    this.ttls.set(key, seconds);
    return 1;
  }

  ttlOf(key: string): number | undefined {
    return this.ttls.get(key);
  }

  /** Like Redis ZADD: `zadd(key, {score, member})` or `zadd(key, {nx: true}, {score, member})`. With NX an existing member keeps its score and nothing is written (returns 0). */
  async zadd(key: string, options: { nx?: boolean } | { score: number; member: string }, scoreMember?: { score: number; member: string }) {
    const nx = !("member" in options) && options.nx === true;
    const { score, member } = ("member" in options ? options : scoreMember!) as { score: number; member: string };
    const set = this.zsets.get(key) ?? new Map<string, number>();
    const isNew = !set.has(member);
    this.writes.push({ cmd: "zadd", key, option: nx ? "NX" : undefined });
    if (nx && !isNew) return 0;
    set.set(member, score);
    this.zsets.set(key, set);
    return isNew ? 1 : 0;
  }

  /** Members ordered by score, then name. Negative indexes count from the end (-1 = last). */
  async zrange<T = string>(key: string, start: number, stop: number): Promise<T[]> {
    const set = this.zsets.get(key);
    if (!set) return [];
    const sorted = [...set.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([member]) => member);
    const len = sorted.length;
    let from = start < 0 ? Math.max(0, len + start) : start;
    let to = stop < 0 ? len + stop : Math.min(stop, len - 1);
    if (from > to || from >= len) return [];
    return sorted.slice(from, to + 1) as T[];
  }

  async zremrangebyscore(key: string, min: number | string, max: number | string) {
    this.writes.push({ cmd: "zremrangebyscore", key });
    const set = this.zsets.get(key);
    if (!set) return 0;
    const lo = min === "-inf" ? -Infinity : Number(min);
    const hi = max === "+inf" ? Infinity : Number(max);
    let removed = 0;
    for (const [member, score] of [...set.entries()]) {
      if (score >= lo && score <= hi) { set.delete(member); removed++; }
    }
    return removed;
  }

  /** Queues commands and runs them in order on exec(), like a Redis pipeline. */
  pipeline() {
    const queued: (() => Promise<unknown>)[] = [];
    const chain = {
      hset: (key: string, kv: Record<string, unknown>) => { queued.push(() => this.hset(key, kv)); return chain; },
      expire: (key: string, seconds: number, option?: string) => { queued.push(() => this.expire(key, seconds, option)); return chain; },
      zadd: (key: string, options: { nx?: boolean } | { score: number; member: string }, scoreMember?: { score: number; member: string }) => {
        queued.push(() => this.zadd(key, options, scoreMember));
        return chain;
      },
      zremrangebyscore: (key: string, min: number | string, max: number | string) => { queued.push(() => this.zremrangebyscore(key, min, max)); return chain; },
      exec: async () => {
        const results: unknown[] = [];
        for (const run of queued) results.push(await run());
        return results;
      },
    };
    return chain;
  }

  async eval(script: string, keys: string[], args: string[]) {
    const key = keys[0];
    const room = await this.get<StoredRoom>(key);
    if (script.includes("Another player already claimed that answer.")) {
      if (!room) return { error: "Room not found." };
      const player = room.players.find((entry) => entry.token === args[0]);
      if (!player) return { error: "This browser is not in that room.", status: 403 };
      if (room.status !== "playing" || room.startedAt === null || Number(args[3]) >= room.startedAt + Number(args[4])) {
        return { error: "The round has ended.", status: 409 };
      }
      const claims = this.hashes.get(keys[1]) ?? {};
      const owner = claims[args[1]];
      if (owner) return { error: owner === player.id ? "You already claimed that answer." : "Another player already claimed that answer.", status: 409 };
      claims[args[1]] = player.id;
      this.hashes.set(keys[1], claims);
      const guesses = this.hashes.get(keys[2]) ?? {};
      guesses[args[1]] = args[2];
      this.hashes.set(keys[2], guesses);
      return { ok: true };
    }
    if (script.includes("tonumber(room.empireVersion or 0) ~= tonumber(ARGV[1])")) {
      // Compare-and-set on the Empire version, mirroring EMPIRE_CAS_SCRIPT (atomic: no await between read and write).
      const current = this.values.get(key) as (StoredRoom & { empireVersion?: number }) | undefined;
      if (!current) return { error: "Room not found." };
      if (current.status !== "playing" || (current.empireVersion ?? 0) !== Number(args[0])) return { conflict: true };
      this.values.set(key, JSON.parse(args[1]));
      return { ok: true };
    }
    if (script.includes("tonumber(room.turn.number) ~= tonumber(ARGV[1])")) {
      // Compare-and-set on the turn number, mirroring TURN_CAS_SCRIPT.
      // Real Lua runs atomically: read and write with no await in between.
      const current = this.values.get(key) as StoredRoom | undefined;
      if (!current) return { error: "Room not found." };
      if (current.status !== "playing" || !current.turn || current.turn.number !== Number(args[0])) return { conflict: true };
      this.values.set(key, JSON.parse(args[1]));
      return { ok: true };
    }
    if (script.includes("Only the host can start this round.")) {
      if (!room) return { error: "Room not found. Check the code." };
      const host = room.players.find((player) => player.token === args[0]);
      if (!host?.host) return { error: "Only the host can start this round." };
      if (room.status !== "waiting") return { error: "This round has already started." };
      if (room.players.length < 2) return { error: "At least two players must join before starting." };
      room.status = "playing";
      room.startedAt = Number(args[1]);
      if (room.mode === "turns" && args[3]) {
        // Mirrors the start script: one 0-point round-0 claim per player from the starts list, and the first card seeds the card history.
        room.turn = { ...JSON.parse(args[3]), order: room.players.map((player) => player.id) };
        const starts = JSON.parse(args[4] || "[]") as string[];
        room.claims = [];
        room.startCountries = {};
        room.players.forEach(({ id }, index) => {
          if (!starts[index]) return;
          room.claims!.push({ code: starts[index], playerId: id, points: 0, round: 0, turn: -1, at: Number(args[1]) });
          room.startCountries![id] = starts[index];
        });
        room.recentCards = [...((room.turn as { deal?: unknown[] }).deal ?? [])];
        room.recentGuesses = [];
      }
      await this.set(key, room);
      return {
        ok: true, gameId: room.gameId ?? "countries", mode: room.mode ?? "live", status: room.status, startedAt: room.startedAt,
        players: room.players.map(({ id, name, host: isHost }) => ({ id, name, host: isHost }))
      };
    }

    if (script.includes("Only the host can end this round.")) {
      if (!room) return { error: "Room not found. Check the code." };
      const host = room.players.find((player) => player.token === args[0]);
      if (!host?.host) return { error: "Only the host can end this round." };
      if (room.status !== "playing") return { error: "This round is not in progress." };
      room.status = "ended";
      await this.set(key, room);
      return { ok: true, status: room.status };
    }

    if (script.includes("name=ARGV[3], host=false")) {
      if (!room) return { error: "Room not found. Check the code." };
      if (room.status !== "waiting") return { error: "That round has already started." };
      if (room.players.length >= 3) return { error: "This room is full." };
      room.players.push({ id: args[0], token: args[1], name: args[2], host: false });
      await this.set(key, room);
      return {
        ok: true, gameId: room.gameId ?? "countries", mode: room.mode ?? "live", turnSeconds: room.turnSeconds, rounds: room.rounds, status: room.status, startedAt: room.startedAt,
        players: room.players.map(({ id, name, host }) => ({ id, name, host }))
      };
    }
    throw new Error(`Unexpected Redis Lua script: ${script.slice(0, 80)}`);
  }
}
