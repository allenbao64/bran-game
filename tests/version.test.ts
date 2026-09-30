import assert from "node:assert/strict";
import { test } from "node:test";
import { versionFromCommitSha } from "@/lib/version";

test("build version is the short commit SHA and changes with the deployed commit", () => {
  assert.equal(versionFromCommitSha("21c4530abcdef123"), "21c4530");
  assert.notEqual(versionFromCommitSha("21c4530abcdef123"), versionFromCommitSha("afa040babcdef123"));
});

test("local builds are clearly identified without a commit SHA", () => {
  assert.equal(versionFromCommitSha(undefined), "local");
  assert.equal(versionFromCommitSha(" "), "local");
});
