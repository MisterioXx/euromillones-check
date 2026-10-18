import test from "node:test";
import assert from "node:assert/strict";
import { initialState } from "../src/lib/seed";
import { checkStateBatch } from "../src/server/checkBatch";
import type { AppState, OfficialCheckResponse } from "../src/types";

function state(): AppState {
  const copy = structuredClone(initialState);
  copy.draws = copy.draws.filter((draw) => ["2026-05-05", "2026-10-16"].includes(draw.date));
  copy.draws = copy.draws.map((draw) => ({ ...draw, status: "pending", grossPrize: 0, prizeSource: undefined }));
  return copy;
}

function withoutPrize(date: string): OfficialCheckResponse {
  return { ok: true, date, requestedDate: date, fetchedAt: "2026-10-18T12:00:00.000Z", source: "https://www.loteriasyapuestas.es/", numbers: [1, 2, 3, 4, 5], stars: [1, 2], prizesVerified: true };
}

test("an unavailable historical draw does not stop a later result, including thrown errors", async () => {
  const calls: string[] = [];
  const result = await checkStateBatch(state(), {
    now: new Date("2026-10-18T12:00:00Z"),
    check: async (date) => {
      calls.push(date);
      if (date === "2026-05-05") throw new Error("upstream unavailable");
      return withoutPrize(date);
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(result.attempted, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.state.draws.find((draw) => draw.date === "2026-10-16")?.status, "checked");
  assert.ok(result.state.logs.some((log) => log.level === "warning" || log.level === "error"));
});

test("bounded batches prioritise unattempted draws over repeated source failures", async () => {
  const copy = state();
  copy.draws[1].lastAttemptAt = "2026-10-18T11:00:00Z";
  const calls: string[] = [];
  const result = await checkStateBatch(copy, {
    now: new Date("2026-10-18T12:00:00Z"), limit: 1,
    check: async (date) => { calls.push(date); return withoutPrize(date); },
  });
  assert.deepEqual(calls, ["2026-05-05"]);
  assert.equal(result.attempted, 1);
  assert.equal(result.remaining, 1);
});

test("expired execution budget leaves pending data intact", async () => {
  const copy = state();
  const result = await checkStateBatch(copy, { deadline: 0, check: async () => { throw new Error("must not run"); } });
  assert.equal(result.attempted, 0);
  assert.deepEqual(result.state, copy);
});
