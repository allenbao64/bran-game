import type { Empire2Geo } from "./geo-adapter";
import type { CountryCode, EmpireState, EngineError, EngineErrorCode, PlayerId, PlayerState } from "./types";

// ---------- Engine error messages (section 13.4, exact strings) ----------
const MESSAGES: Record<EngineErrorCode, string> = {
  badPlayerCount: "Empire needs 2 to 4 players.",
  duplicatePlayer: "Two players have the same id.",
  badTurnMs: "Pick 20, 30 or 45 seconds.",
  wrongPhase: "That can't be done right now.",
  gameOver: "The game is over.",
  notYourTurn: "It's not your turn.",
  turnExpired: "Your time is up.",
  unknownCountry: "That isn't a country in the game.",
  notOffered: "Pick one of the three offered countries.",
  countryTaken: "That country is already taken.",
  bordersRival: "That country touches a rival.",
  notOnFrontier: "That country doesn't touch your empire.",
  expandCap: "You can only expand 2 times a turn.",
  notEnoughInfluence: "Not enough influence.",
  notOwned: "You don't own that country.",
  alreadyCity: "That country already has a stronghold.",
  cityLimit: "You can only have 4 strongholds.",
  wrongCapital: "That's not the capital city of that country.",
  notRival: "Name a country a rival owns.",
  notBordering: "That country doesn't touch your empire.",
  annexUsed: "You already took over a country this turn.",
  secondTurnNoAnnex: "No take-overs on a back-to-back turn.",
  ceasefire: "Ceasefire: no take-overs this round.",
  protectedCity: "Strongholds can't be taken over.",
  protectedStartingCapital: "Home countries can't be taken over.",
  protectedFoothold: "Outposts can't be taken over.",
  protectedRegionSet: "Countries in a full region can't be taken over.",
  targetBelow: "You can only take over from players with at least your points.",
  unknownAction: "Unknown action.",
  badRules: "A rule option has an invalid value.",
  notYourPick: "Only the player picking this round's boom can act now.",
  boomPickFirst: "Pick this round's boom region first.",
  unknownRegion: "That isn't a region in the game.",
};

/** A typed rejection with the exact UI message for its code (or `detail` in place of the default message). */
export function engineError(code: EngineErrorCode, detail?: string): { ok: false; error: EngineError } {
  return { ok: false, error: { code, message: detail ?? MESSAGES[code] } };
}

/** Owner of a country, or undefined when free. Safe against prototype keys. */
export function ownerOf(s: EmpireState, code: CountryCode): PlayerId | undefined {
  return Object.prototype.hasOwnProperty.call(s.owners, code) ? s.owners[code] : undefined;
}

export const playerById = (s: EmpireState, id: PlayerId): PlayerState | undefined =>
  s.players.find((p) => p.id === id);

/** True while the round's boom pick (underdogBoomPick) is waiting for the picker: play, no turn yet. */
export function isBoomPickPending(s: EmpireState): boolean {
  return s.phase === "play" && s.boomPick !== undefined && s.boomPick.region === null;
}

export function currentPlayerId(s: EmpireState): PlayerId | null {
  if (s.phase === "play") {
    if (s.turn) return s.turn.playerId;
    return isBoomPickPending(s) && s.boomPick ? s.boomPick.playerId : null;
  }
  if (s.phase === "setup" && s.setup) {
    const seat = s.setup.order[s.setup.cursor];
    const p = s.players.find((x) => x.seat === seat);
    return p ? p.id : null;
  }
  return null;
}

/** Countries owned by the player, sorted ascending. */
export function ownedBy(s: EmpireState, id: PlayerId): CountryCode[] {
  return Object.keys(s.owners).filter((c) => s.owners[c] === id).sort();
}

/** Codes of every country in the game that nobody owns, ascending. */
export function freeCountries(s: EmpireState, geo: Empire2Geo): CountryCode[] {
  return geo.codes().filter((c) => ownerOf(s, c) === undefined);
}

/** Free countries that border (land or sea) at least one country the player owns. Sorted, unique. */
export function frontier(s: EmpireState, id: PlayerId, geo: Empire2Geo): CountryCode[] {
  const out = new Set<string>();
  for (const c of ownedBy(s, id)) {
    for (const n of geo.neighbours(c)) {
      if (ownerOf(s, n) === undefined) out.add(n);
    }
  }
  return [...out].sort();
}

/** Size of the largest connected group (land borders and sea routes). Iterative BFS. */
export function largestGroupSize(owned: ReadonlySet<CountryCode>, geo: Empire2Geo): number {
  const seen = new Set<string>();
  let best = 0;
  for (const start of owned) {
    if (seen.has(start)) continue;
    seen.add(start);
    const queue: string[] = [start];
    let size = 0;
    while (queue.length > 0) {
      const cur = queue.pop() as string;
      size += 1;
      for (const n of geo.neighbours(cur)) {
        if (owned.has(n) && !seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    if (size > best) best = size;
  }
  return best;
}

/** Number of distinct engine continents among the owned countries. */
export function continentsOwned(owned: ReadonlySet<CountryCode>, geo: Empire2Geo): number {
  const names = new Set<string>();
  for (const c of owned) {
    const k = geo.continentOf(c);
    if (k !== "") names.add(k);
  }
  return names.size;
}

/** Regions fully owned by one player, evaluated from the current owners. Region names ascending. */
export function completedRegions(
  s: EmpireState,
  geo: Empire2Geo,
): { region: string; owner: PlayerId; size: number }[] {
  const out: { region: string; owner: PlayerId; size: number }[] = [];
  for (const region of geo.regionNames()) {
    const members = geo.regionMembers(region);
    if (members.length < 1) continue;
    const first = ownerOf(s, members[0]);
    if (first === undefined) continue;
    if (members.every((m) => ownerOf(s, m) === first)) {
      out.push({ region, owner: first, size: members.length });
    }
  }
  return out;
}

export function hasCityInRegion(s: EmpireState, id: PlayerId, region: string, geo: Empire2Geo): boolean {
  return s.cities.some((c) => s.owners[c] === id && geo.regionOf(c) === region);
}

/** Copy of the state with some top-level fields replaced. Never mutates the input. */
export function patchState(s: EmpireState, patch: Partial<EmpireState>): EmpireState {
  return { ...s, ...patch };
}

/** Copy of the state with one player's record replaced by `fn(player)`. */
export function updatePlayer(s: EmpireState, id: PlayerId, fn: (p: PlayerState) => PlayerState): EmpireState {
  return { ...s, players: s.players.map((p) => (p.id === id ? fn(p) : p)) };
}

/** Appends one log entry, returning a new state. */
export function appendLog(s: EmpireState, entry: EmpireState["log"][number]): EmpireState {
  return { ...s, log: [...s.log, entry] };
}

const codeSetCache = new WeakMap<Empire2Geo, Set<string>>();
/** True when the code (already normalised) is a game country. */
export function isKnownCode(geo: Empire2Geo, code: string): boolean {
  let set = codeSetCache.get(geo);
  if (!set) {
    set = new Set(geo.codes());
    codeSetCache.set(geo, set);
  }
  return set.has(code);
}

/** Normalises a country code from the wire: non-strings become null. */
export function normCode(raw: unknown): CountryCode | null {
  return typeof raw === "string" ? raw.trim().toUpperCase() : null;
}
