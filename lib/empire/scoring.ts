import {
  EMPIRE_RULES,
  setBonus,
  type EmpireGeo,
  type EmpireScoring,
  type EmpireState,
  type ScoreBreakdown
} from "@/lib/empire/types";

type ScoreState = Pick<EmpireState, "players" | "owners" | "empireHolder" | "log">;
type ScoreGeo = Pick<EmpireGeo, "neighbours" | "regionOf" | "regionMembers" | "regionNames">;
type ProtectGeo = Pick<EmpireGeo, "regionOf" | "regionMembers" | "regionNames">;

/** The largest connected group of `owner`'s countries (land borders and sea routes via geo.neighbours); the first found wins a tie. */
function largestGroupCodes(owner: string, owners: Record<string, string>, geo: Pick<EmpireGeo, "neighbours">): string[] {
  const seen = new Set<string>();
  let best: string[] = [];
  for (const start of Object.keys(owners)) {
    if (owners[start] !== owner || seen.has(start)) continue;
    const group: string[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const code = stack.pop() as string;
      group.push(code);
      for (const next of geo.neighbours(code)) {
        if (owners[next] === owner && !seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    if (group.length > best.length) best = group;
  }
  return best;
}

/** Size of the largest connected group of `owner`'s countries, linked through geo.neighbours. */
const largestGroup = (owner: string, owners: Record<string, string>, geo: Pick<EmpireGeo, "neighbours">) => largestGroupCodes(owner, owners, geo).length;

/** Each player's largest connected empire (the group the largest-empire bonus is measured on), as sorted country codes. */
export function largestEmpireGroups(state: Pick<EmpireState, "players" | "owners">, geo: Pick<EmpireGeo, "neighbours">): Record<string, string[]> {
  return Object.fromEntries(state.players.map((player) => [player.id, largestGroupCodes(player.id, state.owners, geo).sort()]));
}

/** Largest-empire holder: strictly biggest qualifier wins; a tie keeps the previous holder only if they are among the tied. */
function pickEmpireHolder(sizes: [string, number][], previous: string | null): string | null {
  let best = 0;
  let top: string[] = [];
  for (const [id, size] of sizes) {
    if (size < EMPIRE_RULES.empireMin) continue;
    if (size > best) {
      best = size;
      top = [id];
    } else if (size === best) {
      top.push(id);
    }
  }
  if (top.length === 1) return top[0];
  if (top.length > 1 && previous !== null && top.includes(previous)) return previous;
  return null;
}

const scoreEmpire: EmpireScoring["scoreEmpire"] = (state: ScoreState, geo: ScoreGeo) => {
  const { players, owners, log } = state;
  const regions = geo.regionNames()
    .map((region) => ({ region, members: geo.regionMembers(region) }))
    .filter((r) => r.members.length > 0)
    .map(({ region, members }) => {
      const counts = new Map<string, number>();
      for (const code of members) {
        const owner = owners[code];
        if (owner !== undefined) counts.set(owner, (counts.get(owner) ?? 0) + 1);
      }
      return { region, members, counts };
    });

  const countries = new Map<string, number>();
  for (const owner of Object.values(owners)) countries.set(owner, (countries.get(owner) ?? 0) + 1);

  const sizes: [string, number][] = players.map((p) => [p.id, largestGroup(p.id, owners, geo)]);
  const empireHolder = pickEmpireHolder(sizes, state.empireHolder);

  const scores: Record<string, ScoreBreakdown> = {};
  for (const p of players) {
    const id = p.id;
    const goldRush = log.reduce((sum, entry) => {
      const rushed = entry.kind === "claim" && entry.playerId === id && (entry.points ?? 0) > 1
        && entry.code !== undefined && owners[entry.code] === id;
      return rushed ? sum + ((entry.points as number) - 1) : sum;
    }, 0);

    const sets = regions
      .filter((r) => r.members.every((code) => owners[code] === id))
      .map((r) => ({ region: r.region, points: setBonus(r.members.length) }));

    const majorities = regions
      .filter((r) => {
        const mine = r.counts.get(id) ?? 0;
        if (mine < EMPIRE_RULES.majorityMin) return false;
        let rival = 0;
        for (const [owner, n] of r.counts) if (owner !== id && n > rival) rival = n;
        return mine > rival;
      })
      .map((r) => r.region);

    const size = sizes.find(([pid]) => pid === id)?.[1] ?? 0;
    const empire = empireHolder === id ? EMPIRE_RULES.empireBonus : 0;
    const count = countries.get(id) ?? 0;
    const total = count + goldRush + empire + sets.reduce((s, x) => s + x.points, 0) + majorities.length;

    scores[id] = { countries: count, goldRush, empireSize: size, empire, sets, majorities, total };
  }

  return { scores, empireHolder };
};

const protectedCodes: EmpireScoring["protectedCodes"] = (state: Pick<EmpireState, "players" | "owners">, geo: ProtectGeo) => {
  const out = new Set<string>();
  for (const p of state.players) {
    out.add(p.capital);
    for (const fort of p.forts) out.add(fort);
  }
  for (const region of geo.regionNames()) {
    const members = geo.regionMembers(region);
    if (members.length === 0) continue;
    const owner = state.owners[members[0]];
    if (owner !== undefined && members.every((code) => state.owners[code] === owner)) {
      for (const code of members) out.add(code);
    }
  }
  return out;
};

const winners: EmpireScoring["winners"] = (scores, _reason) => {
  const entries = Object.entries(scores);
  if (entries.length === 0) return [];
  const topTotal = Math.max(...entries.map(([, s]) => s.total));
  const pool = entries.filter(([, s]) => s.total === topTotal);
  const topCountries = Math.max(...pool.map(([, s]) => s.countries));
  return pool.filter(([, s]) => s.countries === topCountries).map(([id]) => id);
};

export const scoring: EmpireScoring = { scoreEmpire, protectedCodes, winners };
