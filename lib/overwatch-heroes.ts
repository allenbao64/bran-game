export type OverwatchHeroAnswer = { code: string; name: string };

// English hero names based on Blizzard's live Hero Stats roster (checked 2026-10-02).
const names = [
  "Ana", "Anran", "Ashe", "Baptiste", "Bastion", "Brigitte", "Cassidy", "D.Mon", "D.Va", "Domina",
  "Doomfist", "Echo", "Emre", "Freja", "Genji", "Hanzo", "Hazard", "Illari", "Jetpack Cat", "Junker Queen",
  "Junkrat", "Juno", "Kiriko", "Lifeweaver", "Lúcio", "Mauga", "Mei", "Mercy", "Mizuki", "Moira",
  "Orisa", "Pharah", "Ramattra", "Reaper", "Reinhardt", "Roadhog", "Shion", "Sierra", "Sigma", "Sojourn",
  "Soldier: 76", "Sombra", "Symmetra", "Torbjörn", "Tracer", "Vendetta", "Venture", "Widowmaker", "Winston",
  "Wrecking Ball", "Wuyang", "Zarya", "Zenyatta",
];

export function normalizeHeroName(value: string) {
  return value.toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export const overwatchHeroAnswers: OverwatchHeroAnswer[] = names.map((name) => ({
  code: normalizeHeroName(name).replace(/ /g, "-"),
  name,
}));

const byName = new Map(overwatchHeroAnswers.map((answer) => [normalizeHeroName(answer.name), answer]));
const byCode = new Map(overwatchHeroAnswers.map((answer) => [answer.code, answer]));
const aliases: Record<string, string> = {
  dva: "d va",
  dmon: "d mon",
  jetpackcat: "jetpack cat",
  "junkerqueen": "junker queen",
  lucio: "lucio",
  "soldier 76": "soldier 76",
  soldier76: "soldier 76",
  torbjorn: "torbjorn",
  "wreckingball": "wrecking ball",
};

export function resolveOverwatchHero(value: string) {
  const normalized = normalizeHeroName(value);
  return byName.get(aliases[normalized] ?? normalized) ?? null;
}

export function overwatchHeroByCode(code: string) {
  return byCode.get(code.toLowerCase()) ?? null;
}
