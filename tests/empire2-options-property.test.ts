// Random-play property test for the rule options (plan step 2). Plays seeded bot games under each non-default
// option value, on the mini map (fast) and on the real map (a few games), and runs the section 14.10 invariant
// checker after every step.
import assert from "node:assert/strict";
import test from "node:test";
import { empire2Geo } from "@/lib/empire2/geo-adapter";
import { isBackToBack } from "@/lib/empire2/order";
import type { EmpireState, Rules } from "@/lib/empire2/types";
import { KNOW_P } from "@/scripts/empire2-sim/config";
import { lineupFor, playGame } from "@/scripts/empire2-sim/runner";
import { assertInvariants, miniGeo, newTrackers } from "@/tests/empire2-support";

/**
 * Back-to-back check for one game, run after every step. The seat of the turn that just ended is tracked here,
 * from the states the game passes through; a new turn is one whose round or turn index differs from the last one
 * seen. Each new turn's isSecondOfTwo must equal isBackToBack(that previous seat, the new seat).
 */
function backToBackCheck() {
  let lastKey: string | null = null;
  let lastSeat: number | null = null;
  return (after: EmpireState): void => {
    if (after.phase !== "play" || after.turn === null) return;
    const key = `${after.round}:${after.turn.indexInRound}`;
    if (key === lastKey) return;
    const previousSeat = lastSeat;
    const seat = after.turn.seat;
    const expected = isBackToBack(previousSeat, seat);
    // Also pins the expected value to the seat rule itself (section 7.2), so a broken isBackToBack fails here too.
    assert.equal(expected, previousSeat !== null && previousSeat === seat, `isBackToBack(${previousSeat}, ${seat})`);
    assert.equal(
      after.turn.isSecondOfTwo,
      expected,
      `back-to-back flag at round ${after.round}, turn ${after.turn.indexInRound} (previous seat ${previousSeat}, seat ${seat})`,
    );
    lastKey = key;
    lastSeat = seat;
  };
}

const COMBOS: { name: string; rules: Partial<Rules>; slowP: number }[] = [
  { name: "turnOrder clockwise", rules: { turnOrder: "clockwise" }, slowP: 0 },
  { name: "turnOrder rotate", rules: { turnOrder: "rotate" }, slowP: 0 },
  { name: "turnOrder leaderLast", rules: { turnOrder: "leaderLast" }, slowP: 0 },
  { name: "winCheck endOfRound", rules: { winCheck: "endOfRound" }, slowP: 0 },
  { name: "territoryPoints off", rules: { territoryPoints: false }, slowP: 0 },
  { name: "cheapColonize oncePerGame", rules: { cheapColonize: "oncePerGame" }, slowP: 0 },
  {
    name: "all five non-default, with timeouts",
    rules: { turnOrder: "leaderLast", winCheck: "endOfRound", territoryPoints: false, cheapColonize: "oncePerGame" },
    slowP: 0.1,
  },
  { name: "rotate with endOfRound and timeouts", rules: { turnOrder: "rotate", winCheck: "endOfRound" }, slowP: 0.1 },
];

for (const combo of COMBOS) {
  test(`random play, ${combo.name}: every invariant holds after every action (mini map, 2 to 4 players)`, () => {
    let games = 0;
    for (const n of [2, 3, 4]) {
      for (let i = 0; i < 6; i++) {
        const seed = 1000 * n + i;
        const trackers = newTrackers();
        const checkBackToBack = backToBackCheck();
        const record = playGame({
          geo: miniGeo,
          lineup: lineupFor(i, n, "pure"),
          seed,
          knowP: KNOW_P,
          slowP: combo.slowP,
          rules: combo.rules,
          onStep: (before, after) => {
            assertInvariants(before, after, miniGeo, trackers);
            checkBackToBack(after);
          },
        });
        assert.ok(record.rounds >= 1 && record.rounds <= 20, `rounds ${record.rounds} out of range`);
        assert.ok(record.winners.length >= 1, "a game ends with a winner");
        games += 1;
      }
    }
    assert.equal(games, 18);
  });
}

test("random play, real map: the all-non-default combination holds every invariant (3 games)", () => {
  const combo = COMBOS[6];
  for (let i = 0; i < 3; i++) {
    const trackers = newTrackers();
    const checkBackToBack = backToBackCheck();
    const record = playGame({
      geo: empire2Geo,
      lineup: lineupFor(i, 3, "mixed"),
      seed: 7000 + i,
      knowP: KNOW_P,
      slowP: combo.slowP,
      rules: combo.rules,
      onStep: (before, after) => {
        assertInvariants(before, after, empire2Geo, trackers);
        checkBackToBack(after);
      },
    });
    assert.ok(record.winners.length >= 1);
  }
});
