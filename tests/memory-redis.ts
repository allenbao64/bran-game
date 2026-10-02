type StoredRoom = {
  code: string;
  gameId?: "countries" | "champions" | "overwatch";
  status: "waiting" | "playing" | "ended";
  createdAt: number;
  startedAt: number | null;
  players: { id: string; token: string; name: string; host: boolean }[];
};

/** A small Redis test double for the commands used by the API routes. */
export class MemoryRedis {
  private values = new Map<string, unknown>();
  private hashes = new Map<string, Record<string, string>>();

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

  async expire() { return 1; }

  async eval(script: string, keys: string[], args: string[]) {
    const key = keys[0];
    const room = await this.get<StoredRoom>(key);
    if (script.includes("Only the host can start this round.")) {
      if (!room) return { error: "Room not found. Check the code." };
      const host = room.players.find((player) => player.token === args[0]);
      if (!host?.host) return { error: "Only the host can start this round." };
      if (room.status !== "waiting") return { error: "This round has already started." };
      if (room.players.length < 2) return { error: "At least two players must join before starting." };
      room.status = "playing";
      room.startedAt = Number(args[1]);
      await this.set(key, room);
      return {
        ok: true, gameId: room.gameId ?? "countries", status: room.status, startedAt: room.startedAt,
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
        ok: true, gameId: room.gameId ?? "countries", status: room.status, startedAt: room.startedAt,
        players: room.players.map(({ id, name, host }) => ({ id, name, host }))
      };
    }
    throw new Error(`Unexpected Redis Lua script: ${script.slice(0, 80)}`);
  }
}
