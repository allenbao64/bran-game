import type { Empire2Geo } from "./geo-adapter";

export type PlayerId = string;
export type CountryCode = string;          // ISO alpha-2, uppercase
export type Rng = () => number;            // returns [0, 1)

/** Turn order within a round (see order.ts roundOrder). "snake" is the current rule. */
export type TurnOrder = "snake" | "clockwise" | "rotate" | "leaderLast";
/** When a win counts: at the end of the winner's own turn (current), or at the end of a round. */
export type WinCheck = "endOfTurn" | "endOfRound";
/** Stuck-colonize relief: every stuck turn (current), or once per player per game. */
export type CheapColonize = "everyStuckTurn" | "oncePerGame";

export type Rules = {
  startInfluence: number;          // 3
  baseIncome: number;              // 2
  countriesPerTerritory: number;   // 4  (income AND victory points: 1 per this many countries, floored)
  cityIncome: number;              // 1
  goldenAgeCityIncome: number;     // 2
  boomRegionCount: number;         // 3
  boomIncome: number;              // 1
  boomCityIncome: number;          // 2
  underdogGap: number;             // 2
  underdogIncome: number;          // 2
  bountyCount: number;             // 2
  bountyPay: number;               // 2
  goldRushBountyPay: number;       // 4
  bountyMinFits: number;           // 3  (a bounty is only drawn if at least this many free countries fit it)
  eventEvery: number;              // 4
  freeExpandsPerTurn: number;      // 1
  maxExpandsPerTurn: number;       // 3
  expandCost: number;              // 1  (cost of each paid expand)
  closedBordersExtra: number;      // 1
  colonizeCost: number;            // 4
  colonizeReliefCost: number;      // 2
  tradeWindsColonizeCost: number;  // 2
  minColonizeCost: number;         // 2  (floor; costs never go below)
  cityCost: number;                // 3
  maxCities: number;               // 4
  annexCost: number;               // 5
  cityPoints: number;              // 1  (victory points per city)
  largestEmpireMin: number;        // 6
  largestEmpirePoints: number;     // 2
  explorerMinContinents: number;   // 4
  explorerPoints: number;          // 2
  winPoints: number;               // 10
  roundCap: number;                // 20
  capitalOffers: number;           // 3
  capitalMinNeighbours: number;    // 3
  minPlayers: number;              // 2
  maxPlayers: number;              // 4
  defaultTurnMs: number;           // 30000
  allowedTurnMs: number[];         // [20000, 30000, 45000]  (host options)
  turnOrder: TurnOrder;            // "snake"  (today: ascending odd rounds, descending even rounds)
  winCheck: WinCheck;              // "endOfTurn"  (today: a win is checked at the end of each turn)
  territoryPoints: boolean;        // true  (today: territory scores 1 point per countriesPerTerritory)
  cheapColonize: CheapColonize;    // "everyStuckTurn"  (today: the relief price applies on every stuck turn)
};

export type PlayerState = {
  id: PlayerId;
  seat: number;                    // 0-based position in config.playerIds, fixed for the game
  influence: number;               // integer >= 0
  capital: CountryCode | null;     // null until picked
  foothold: CountryCode | null;    // null until picked
};

export type SetupState = {
  step: "capital" | "foothold";
  order: number[];                 // seats in pick order for this step (see 7.1)
  cursor: number;                  // index into order of the player who must pick now
  offers: CountryCode[];           // capital step: the current picker's offers (length 3, or fewer only if the map is too small); [] on the foothold step
};

export type TurnActionRecord = {
  type: "expand" | "colonize" | "city" | "annex";
  code: CountryCode;
  cost: number;                    // influence spent (>= 0)
  bounty: number;                  // influence gained from a bounty on this action (0 if none)
};

export type TurnState = {
  playerId: PlayerId;
  seat: number;
  indexInRound: number;            // 0-based position in this round's order
  isSecondOfTwo: boolean;          // the back-to-back flag (see 7.2)
  startedAt: number;               // ms; the clock start of this turn
  noFrontierAtStart: boolean;      // no free country bordered the empire when the turn began
  expands: number;                 // expands done this turn (free + paid), 0..3
  colonizes: number;               // colonizes done this turn
  annexed: boolean;                // an annex succeeded this turn
  actions: TurnActionRecord[];     // successful paid/free actions this turn, in order
};

export type BountyKind = "letter" | "short" | "long" | "landlocked" | "island" | "continent" | "region";
export type BountyCard = {
  id: string;                      // `r${round}-${slot}`, e.g. "r1-0"
  kind: BountyKind;
  /** letter: uppercase letter; short: max letters (5..7); long: min letters (9..11);
   *  continent: engine continent name; region: region name; landlocked/island: null. */
  value: string | number | null;
};

export type EventKind = "tradeWinds" | "ceasefire" | "goldenAge" | "goldRush" | "closedBorders";

export type Titles = {
  largestEmpire: PlayerId | null;
  explorer: PlayerId | null;
};

export type IncomeBreakdown = {
  base: number;
  territory: number;
  cities: number;
  boom: number;
  underdog: number;
  total: number;
};

export type VpBreakdown = {
  territory: number;
  cities: number;
  regionSets: { region: string; points: number }[];
  largestEmpire: number;           // 0 or rules.largestEmpirePoints
  explorer: number;                // 0 or rules.explorerPoints
  total: number;
};

export type LogType =
  | "capital" | "foothold" | "expand" | "colonize" | "city" | "annex"
  | "bounty" | "endTurn" | "timeout" | "roundStart" | "title" | "win" | "cap";
export type LogEntry = {
  type: LogType;
  round: number;
  playerId: PlayerId | null;
  code?: CountryCode;
  from?: PlayerId;                 // annex: previous owner
  amount?: number;                 // cost (negative) or payout (positive) where relevant
  second?: boolean;                // the actor's turn was a second-of-two turn
  note?: string;                   // title: "largestEmpire" | "explorer"; roundStart: event kind or ""
};

export type GameResult = {
  winners: PlayerId[];             // 1 normally; more than 1 only on a full tie (at the cap, or at the end of a round under winCheck "endOfRound")
  reason: "points" | "cap";
  round: number;
  vp: Record<PlayerId, number>;
  influence: Record<PlayerId, number>;
};

export type EmpireState = {
  version: 1;
  phase: "setup" | "play" | "finished";
  rules: Rules;
  turnMs: number;
  players: PlayerState[];          // in seat order
  owners: Record<CountryCode, PlayerId>;
  cities: CountryCode[];           // sorted ascending; each is owned by someone; never changes owner
  setup: SetupState | null;        // non-null only in phase "setup"
  round: number;                   // 0 during setup; 1.. in play
  turn: TurnState | null;          // non-null only in phase "play"
  roundStartVp: Record<PlayerId, number>;  // snapshot taken at the start of the current round ({} during setup)
  booms: string[];                 // booming region names this round, sorted ascending ([] during setup)
  bounties: BountyCard[];          // open bounty cards this round, in slot order
  event: EventKind | null;         // world event active THIS round
  titles: Titles;
  reliefUsed?: PlayerId[];         // players who have used the stuck-colonize relief (absent = none); only the once-per-game rule reads it
  waitingWin: PlayerId[];          // players who ended a second-of-two turn with >= winPoints and have not yet had their next turn end
  lastIncome: Record<PlayerId, IncomeBreakdown> | null;  // what each player collected at the start of this round
  log: LogEntry[];                 // append-only
  result: GameResult | null;       // non-null only in phase "finished"
};

export type EngineErrorCode =
  | "badPlayerCount" | "duplicatePlayer" | "badTurnMs"
  | "wrongPhase" | "gameOver" | "notYourTurn" | "turnExpired" | "unknownCountry"
  | "notOffered" | "countryTaken" | "bordersRival"
  | "notOnFrontier" | "expandCap" | "notEnoughInfluence"
  | "notOwned" | "alreadyCity" | "cityLimit" | "wrongCapital"
  | "notRival" | "notBordering" | "annexUsed" | "secondTurnNoAnnex" | "ceasefire"
  | "protectedCity" | "protectedStartingCapital" | "protectedFoothold" | "protectedRegionSet"
  | "targetBelow" | "unknownAction";
export type EngineError = { code: EngineErrorCode; message: string };   // message: short, plain (UI-ready), see 13.4

export type Ok<T> = { ok: true } & T;
export type Fail = { ok: false; error: EngineError };

export type Action =
  | { type: "pickCapital"; code: CountryCode }
  | { type: "pickFoothold"; code: CountryCode }
  | { type: "expand"; code: CountryCode }
  | { type: "colonize"; code: CountryCode }
  | { type: "city"; code: CountryCode; capital: string }
  | { type: "annex"; code: CountryCode; capital: string }
  | { type: "endTurn" };

export type Ctx = { geo: Empire2Geo; rng: Rng; now: number };   // Empire2Geo imported from geo-adapter (type import)
export type ActionResult = Ok<{ state: EmpireState }> | Fail;

export type GameConfig = {
  playerIds: PlayerId[];           // seat order = array order; the server shuffles before calling
  turnMs?: number;                 // default rules.defaultTurnMs; must be in rules.allowedTurnMs unless `rules.allowedTurnMs` is overridden (tests)
  rules?: Partial<Rules>;          // tests only (e.g. winPoints: 5)
};
