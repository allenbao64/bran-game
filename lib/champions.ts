export type ChampionAnswer = { code: string; name: string };

// Names follow Riot's English League of Legends champion roster. Data Dragon's
// published champion.json is the canonical source for roster updates.
export const CHAMPION_DATA_VERSION = "16.18.1";

const names = [
  "Aatrox", "Ahri", "Akali", "Akshan", "Alistar", "Ambessa", "Amumu", "Anivia", "Annie", "Aphelios", "Ashe", "Aurelion Sol",
  "Aurora", "Azir", "Bard", "Bel'Veth", "Blitzcrank", "Brand", "Braum", "Briar", "Caitlyn", "Camille", "Cassiopeia",
  "Cho'Gath", "Corki", "Darius", "Diana", "Dr. Mundo", "Draven", "Ekko", "Elise", "Evelynn", "Ezreal", "Fiddlesticks",
  "Fiora", "Fizz", "Galio", "Gangplank", "Garen", "Gnar", "Gragas", "Graves", "Gwen", "Hecarim", "Heimerdinger", "Hwei",
  "Illaoi", "Irelia", "Ivern", "Janna", "Jarvan IV", "Jax", "Jayce", "Jhin", "Jinx", "K'Sante", "Kai'Sa", "Kalista",
  "Karma", "Karthus", "Kassadin", "Katarina", "Kayle", "Kayn", "Kennen", "Kha'Zix", "Kindred", "Kled", "Kog'Maw",
  "LeBlanc", "Lee Sin", "Leona", "Lillia", "Lissandra", "Locke", "Lucian", "Lulu", "Lux", "Malphite", "Malzahar", "Maokai",
  "Master Yi", "Mel", "Milio", "Miss Fortune", "Mordekaiser", "Morgana", "Naafiri", "Nami", "Nasus", "Nautilus", "Neeko",
  "Nidalee", "Nilah", "Nocturne", "Nunu & Willump", "Olaf", "Orianna", "Ornn", "Pantheon", "Poppy", "Pyke", "Qiyana",
  "Quinn", "Rakan", "Rammus", "Rek'Sai", "Rell", "Renata Glasc", "Renekton", "Rengar", "Riven", "Rumble", "Ryze",
  "Samira", "Sejuani", "Senna", "Seraphine", "Sett", "Shaco", "Shen", "Shyvana", "Singed", "Sion", "Sivir", "Skarner",
  "Smolder", "Sona", "Soraka", "Swain", "Sylas", "Syndra", "Tahm Kench", "Taliyah", "Talon", "Taric", "Teemo", "Thresh",
  "Tristana", "Trundle", "Tryndamere", "Twisted Fate", "Twitch", "Udyr", "Urgot", "Varus", "Vayne", "Veigar", "Vel'Koz",
  "Vex", "Vi", "Viego", "Viktor", "Vladimir", "Volibear", "Warwick", "Wukong", "Xayah", "Xerath", "Xin Zhao", "Yasuo",
  "Yone", "Yorick", "Yunara", "Yuumi", "Zaahen", "Zac", "Zed", "Zeri", "Ziggs", "Zilean", "Zoe", "Zyra",
];

export function normalizeChampionName(value: string) {
  return value.toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export const championAnswers: ChampionAnswer[] = names.map((name) => ({
  code: normalizeChampionName(name).replace(/ /g, "-"),
  name,
}));

const byName = new Map(championAnswers.map((answer) => [normalizeChampionName(answer.name), answer]));
const byCode = new Map(championAnswers.map((answer) => [answer.code, answer]));

const aliases: Record<string, string> = {
  "cho gath": "cho gath", "chogath": "cho gath", "dr mundo": "dr mundo", "doctor mundo": "dr mundo",
  "jarvan 4": "jarvan iv", "jarvan iv": "jarvan iv", "kai sa": "kai sa", "kaisa": "kai sa",
  "kha zix": "kha zix", "khazix": "kha zix", "kog maw": "kog maw", "kogmaw": "kog maw",
  "ksante": "k sante", "k sante": "k sante", "le blanc": "leblanc", "leblanc": "leblanc",
  "reksai": "rek sai", "rek sai": "rek sai", "vel koz": "vel koz", "velkoz": "vel koz",
  "nunu and willump": "nunu willump", "nunu willump": "nunu willump", "wukong": "wukong", "monkey king": "wukong",
};

export function resolveChampion(value: string) {
  const normalized = normalizeChampionName(value);
  return byName.get(aliases[normalized] ?? normalized) ?? null;
}

export function championByCode(code: string) {
  return byCode.get(code.toLowerCase()) ?? null;
}
