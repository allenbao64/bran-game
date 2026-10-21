export const GAME_CATALOG = {
  countries: {
    id: "countries",
    title: "Country Sprint",
    durationSeconds: 10 * 60,
    durationLabel: "10 MIN",
    answerLabel: "COUNTRIES",
    inputPlaceholder: "Type a country name…",
    rules: "Name as many countries as you can in ten minutes.",
  },
  champions: {
    id: "champions",
    title: "Champion Sprint",
    durationSeconds: 2 * 60,
    durationLabel: "2 MIN",
    answerLabel: "CHAMPIONS",
    inputPlaceholder: "Type a champion name…",
    rules: "Name as many League of Legends champions as you can in two minutes.",
  },
  overwatch: {
    id: "overwatch",
    title: "Overwatch Hero Sprint",
    durationSeconds: 2 * 60,
    durationLabel: "2 MIN",
    answerLabel: "HEROES",
    inputPlaceholder: "Type a hero name…",
    rules: "Name as many Overwatch heroes as you can in two minutes.",
  },
} as const;

export type GameId = keyof typeof GAME_CATALOG;
export type GameConfig = (typeof GAME_CATALOG)[GameId];

export function isGameId(value: unknown): value is GameId {
  return typeof value === "string" && Object.hasOwn(GAME_CATALOG, value);
}

export function gameConfig(value: unknown): GameConfig {
  return isGameId(value) ? GAME_CATALOG[value] : GAME_CATALOG.countries;
}
