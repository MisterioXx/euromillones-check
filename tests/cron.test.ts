import test from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createCronHandler, validCronAuthorization } from "../api/cron";
import { runScheduledChecks, emptyCronCounters, type CronStore } from "../src/server/cron";
import { checkStateBatch } from "../src/server/checkBatch";
import { initialState } from "../src/lib/seed";
import { HttpError } from "../src/server/http";
import type { WorkspaceRow } from "../src/server/workspaces";
import type { AppState, OfficialCheckResponse } from "../src/types";

const NOW = new Date("2026-10-18T12:00:00Z").getTime();
const SECRET = "test-secret-for-cron-only-123456789";

function workspace(id = "one"): WorkspaceRow {
  const state = structuredClone(initialState);
  state.draws = state.draws.filter((draw) => ["2026-05-05", "2026-10-16"].includes(draw.date));
  state.draws = state.draws.map((draw) => ({ ...draw, status: "pending", grossPrize: 0, prizeSource: undefined }));
  return { id, name: "Private name", owner_id: "private-owner", state, revision: 1, background_enabled: true,
    updated_at: new Date(NOW), last_checked_at: null, lease_token: null, lease_until: null };
}

function fakeStore(rows = [workspace()]) {
  const records = new Map(rows.map((row) => [row.id, structuredClone(row)]));
  const events: string[] = [];
  const store: CronStore = {
    list: async () => [...records.keys()],
    claim: async (id, token) => {
      const row = records.get(id)!;
      if (row.lease_token || !row.background_enabled) return undefined;
      row.lease_token = token; row.lease_until = new Date(NOW + 120_000);
      events.push(`claim:${id}`); return structuredClone(row);
    },
    save: async (row, state, token, checkedAt) => {
      const current = records.get(row.id)!;
      if (current.revision !== row.revision || current.lease_token !== token || !current.background_enabled) throw new HttpError(409, "Conflict");
      Object.assign(current, { state: structuredClone(state), revision: current.revision + 1, last_checked_at: checkedAt });
      events.push(`save:${row.id}`);
    },
    complete: async (id, token, checkedAt) => {
      const row = records.get(id)!;
      assert.equal(row.lease_token, token); row.last_checked_at = checkedAt; events.push(`complete:${id}`);
    },
    release: async (id, token) => {
      const row = records.get(id)!;
      if (row.lease_token === token) { row.lease_token = null; row.lease_until = null; }
      events.push(`release:${id}`);
    },
  };
  return { store, records, events };
}

const noPrize = async (date: string): Promise<OfficialCheckResponse> => ({ ok: true, date, requestedDate: date,
  source: "https://www.loteriasyapuestas.es/servicios/buscadorSorteos", fetchedAt: new Date(NOW).toISOString(),
  numbers: [1, 2, 3, 4, 5], stars: [1, 2], prizes: [], prizesVerified: true });

const testBatch: typeof checkStateBatch = (state, options) => checkStateBatch(state, { ...options, deadline: undefined });

test("cron auth rejects missing, malformed and short secrets and compares exact Bearer credentials", () => {
  assert.equal(validCronAuthorization(`Bearer ${SECRET}`, SECRET), true);
  assert.equal(validCronAuthorization(`Bearer ${SECRET}x`, SECRET), false);
  assert.equal(validCronAuthorization(`bearer ${SECRET}`, SECRET), false);
  assert.equal(validCronAuthorization(undefined, SECRET), false);
  assert.equal(validCronAuthorization([`Bearer ${SECRET}`], SECRET), false);
  assert.equal(validCronAuthorization("Bearer undefined", undefined), false);
  assert.equal(validCronAuthorization("Bearer short", "short"), false);
});

test("cron route is GET-only, requires auth, returns counters and never leaks private state", async () => {
  let runs = 0;
  const handler = createCronHandler({ secret: () => SECRET, configured: () => true,
    run: async () => { runs++; return { ...emptyCronCounters(), workspacesChecked: 1 }; } });
  const invoke = async (method: string, authorization?: string) => {
    const headers: Record<string, string> = {}; let body = "";
    const reply = { statusCode: 0, setHeader: (key: string, value: string) => { headers[key] = value; }, end: (value: string) => { body = value; } };
    await handler({ method, headers: { authorization } } as IncomingMessage, reply as unknown as ServerResponse);
    return { status: reply.statusCode, headers, body: JSON.parse(body) };
  };
  assert.equal((await invoke("POST", `Bearer ${SECRET}`)).status, 405);
  assert.equal((await invoke("GET")).status, 401);
  assert.equal(runs, 0);
  const success = await invoke("GET", `Bearer ${SECRET}`);
  assert.equal(success.status, 200);
  assert.equal(success.headers["Cache-Control"], "no-store");
  assert.equal(success.body.workspacesChecked, 1);
  assert.ok(Object.values(success.body).every((value) => typeof value === "number"));
  assert.equal(runs, 1);
});

test("source failure is persisted in Logs and does not stop the other draw", async () => {
  const fake = fakeStore();
  const counts = await runScheduledChecks({ store: fake.store, now: () => NOW, batch: testBatch,
    checker: async (date) => { if (date === "2026-05-05") throw new Error("upstream"); return noPrize(date); } });
  const row = fake.records.get("one")!;
  assert.equal(counts.drawsAttempted, 2);
  assert.equal(counts.drawsFailed, 1);
  assert.equal(counts.workspacesUpdated, 1);
  assert.equal(row.state.draws.find((draw) => draw.date === "2026-10-16")?.status, "checked");
  assert.equal(row.state.draws.find((draw) => draw.date === "2026-05-05")?.status, "error");
  assert.ok(row.state.logs.some((log) => log.level === "error" || log.level === "warning"));
  assert.equal(row.last_checked_at?.getTime(), NOW);
  assert.equal(row.lease_token, null);
});

test("overlapping cron deliveries cannot process the same active lease", async () => {
  const fake = fakeStore(); let calls = 0;
  const batch: typeof checkStateBatch = async (state) => { calls++; await Promise.resolve(); return { state, attempted: 0, failed: 0, remaining: 0 }; };
  const results = await Promise.all([
    runScheduledChecks({ store: fake.store, now: () => NOW, token: () => "first", batch }),
    runScheduledChecks({ store: fake.store, now: () => NOW, token: () => "second", batch }),
  ]);
  assert.equal(calls, 1);
  assert.equal(results.reduce((sum, result) => sum + result.workspacesSkipped, 0), 1);
  assert.equal(fake.events.filter((value) => value.startsWith("complete")).length, 1);
});

test("CAS conflicts preserve user changes and do not stop the next workspace", async () => {
  const fake = fakeStore([workspace("one"), workspace("two")]);
  const originalSave = fake.store.save;
  fake.store.save = async (row, ...args) => {
    if (row.id === "one") {
      const current = fake.records.get("one")!; current.revision++; current.state.draws[0].notes = "User edit";
    }
    await originalSave(row, ...args);
  };
  const counts = await runScheduledChecks({ store: fake.store, now: () => NOW, batch: testBatch, checker: noPrize });
  assert.equal(counts.conflicts, 1);
  assert.equal(counts.workspacesUpdated, 1);
  assert.equal(fake.records.get("one")?.state.draws[0].notes, "User edit");
  assert.equal(fake.records.get("one")?.state.draws[0].status, "pending");
  assert.equal(fake.records.get("two")?.state.draws[0].status, "checked");
  assert.ok(fake.events.includes("release:one"));
});

test("no pending draws updates last_checked_at without unnecessary revisions", async () => {
  const row = workspace(); row.state.draws = [];
  const fake = fakeStore([row]);
  const result = await runScheduledChecks({ store: fake.store, now: () => NOW, batch: testBatch, checker: noPrize });
  assert.equal(result.workspacesChecked, 1);
  assert.equal(result.workspacesUpdated, 0);
  assert.equal(fake.records.get("one")?.revision, 1);
  assert.equal(fake.records.get("one")?.last_checked_at?.getTime(), NOW);
});

test("the batch receives limit 12 and budget reserves 15 seconds for save and release", async () => {
  const fake = fakeStore([workspace("one"), workspace("two")]); let clock = NOW;
  const originalSave = fake.store.save;
  fake.store.save = async (row, state, token, checkedAt, deadline) => {
    assert.equal(deadline, NOW + 40_000);
    await originalSave(row, state, token, checkedAt, deadline);
  };
  const result = await runScheduledChecks({ store: fake.store, now: () => clock, batch: async (state, options) => {
    assert.equal(options?.limit, 12);
    assert.equal(options?.deadline, NOW + 30_000);
    clock = NOW + 31_000;
    return { state, attempted: 1, failed: 1, remaining: 2 };
  } });
  assert.equal(result.deadlineReached, 1);
  assert.equal(result.workspacesUpdated, 1);
  assert.ok(fake.events.includes("release:one"));
  assert.ok(!fake.events.includes("claim:two"));
});

test("the final five seconds are reserved for releasing the lease", async () => {
  const fake = fakeStore(); let clock = NOW;
  const result = await runScheduledChecks({ store: fake.store, now: () => clock, batch: async (state) => {
    clock = NOW + 40_001; return { state, attempted: 1, failed: 0, remaining: 0 };
  } });
  assert.equal(result.deadlineReached, 1);
  assert.equal(result.workspacesUpdated, 0);
  assert.ok(!fake.events.includes("save:one"));
  assert.ok(fake.events.includes("release:one"));
});

test("an exhausted total budget does not begin another save", async () => {
  const fake = fakeStore(); let clock = NOW;
  const result = await runScheduledChecks({ store: fake.store, now: () => clock, batch: async (state) => {
    clock = NOW + 45_001; return { state, attempted: 1, failed: 0, remaining: 0 };
  } });
  assert.equal(result.deadlineReached, 1);
  assert.equal(result.workspacesUpdated, 0);
  assert.ok(!fake.events.includes("save:one"));
  // The bounded lease expires on its own if there is no time left to release it.
  assert.equal(fake.records.get("one")?.lease_until?.getTime(), NOW + 120_000);
});

test("a failed workspace is isolated and released", async () => {
  const fake = fakeStore([workspace("one"), workspace("two")]); let first = true;
  const result = await runScheduledChecks({ store: fake.store, now: () => NOW, batch: async (state: AppState) => {
    if (first) { first = false; throw new Error("unexpected internal failure"); }
    return { state, attempted: 0, failed: 0, remaining: 0 };
  } });
  assert.equal(result.workspacesFailed, 1);
  assert.equal(result.workspacesChecked, 1);
  assert.ok(fake.events.includes("release:one"));
});
