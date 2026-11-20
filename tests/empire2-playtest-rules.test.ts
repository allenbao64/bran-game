import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createGame, EMPIRE2_RULES, empire2Geo } from "@/lib/empire2";
import { EMPIRE2_TURN_SPEEDS, playtestRules } from "@/lib/empire2-playtest";

test("playtestRules matches scripts/empire2-sim/rules-candidate.json on top of EMPIRE2_PLAY_RULES", () => {
  const candidate = JSON.parse(readFileSync(`${process.cwd()}/scripts/empire2-sim/rules-candidate.json`, "utf8")) as Record<string, number>;
  const rules = playtestRules(false) as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(candidate)) assert.equal(rules[key], value, key);
  assert.equal(playtestRules(false).maxExpandsPerTurn, 2);
  assert.equal(playtestRules(false).turnOrder, "leaderLast");
});

test("createGame with playtestRules keeps the play rules (the resolveRules trap)", () => {
  let seed = 3;
  const rng = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const created = createGame({ playerIds: ["a", "b"], turnMs: 30000, rules: playtestRules(false) }, { geo: empire2Geo, rng, now: 0 });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.state.rules.winPoints, 16);
  assert.equal(created.state.rules.maxExpandsPerTurn, 2);
  assert.equal(created.state.rules.turnOrder, "leaderLast");
});

test("the speed options are the engine's allowed turn lengths", () => {
  for (const speed of EMPIRE2_TURN_SPEEDS) {
    assert.ok(EMPIRE2_RULES.allowedTurnMs.includes(speed.seconds * 1000), `${speed.label} is ${speed.seconds} seconds`);
  }
});
