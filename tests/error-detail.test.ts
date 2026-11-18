import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { NextRequest } from "next/server";
import type { Redis } from "@upstash/redis";
import { POST as roomPost } from "@/app/api/room/route";
import { errorDetail } from "@/lib/error-detail";
import { setRedisForTests } from "@/lib/redis";

afterEach(() => setRedisForTests(null));

test("errorDetail names the error and trims a long message", () => {
  assert.equal(errorDetail(new TypeError("x is not a function")), " (TypeError: x is not a function)");
  assert.equal(errorDetail("plain\nstring"), " (Error: plain string)");
  assert.ok(errorDetail(new Error("a".repeat(500))).length < 150);
});

test("when the database call throws, the 503 says which error it was", async () => {
  const broken = { get: async () => { throw new RangeError("boom"); }, eval: async () => { throw new RangeError("boom"); } };
  setRedisForTests(broken as unknown as Redis);
  const response = await roomPost(new NextRequest("http://localhost/api/room", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "start", code: "ABC234", token: "a".repeat(64), name: "Host" })
  }));
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /^The room service is unavailable \(RangeError: boom\)\. Try again in a moment\.$/);
});
