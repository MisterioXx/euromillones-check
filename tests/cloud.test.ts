import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import type { ServerResponse } from "node:http";
import handler from "../api/cloud";
import { getAuth } from "../src/server/auth";
import { getPool } from "../src/server/database";
import type { ApiRequest } from "../src/server/http";
import { initialState } from "../src/lib/seed";

const environment = { DATABASE_URL: process.env.DATABASE_URL, BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET, APP_ORIGIN: process.env.APP_ORIGIN };
const current = {
  id: "workspace-b", name: "Peña B", owner_id: "account-b", state: structuredClone(initialState), revision: 1,
  background_enabled: false, updated_at: new Date("2026-10-18T10:00:00Z"), last_checked_at: null,
};
let queries: string[];

beforeEach(() => {
  process.env.DATABASE_URL = "postgres://test:test@127.0.0.1:1/test";
  process.env.BETTER_AUTH_SECRET = "cloud-regression-test-secret-no-real-credentials";
  process.env.APP_ORIGIN = "https://euromillones.example";
  queries = [];
  mock.method(getPool(), "query", async (sql: string, values: unknown[]) => {
    queries.push(sql);
    assert.match(sql, /^SELECT w\.\* FROM ec_workspaces/);
    assert.deepEqual(values, ["account-b"]);
    return { rows: [current], rowCount: 1 };
  });
  mock.method(getPool(), "connect", async () => { throw new Error("No transaction should start for a mismatched workspace."); });
  const auth = getAuth();
  // Only the HTTP handler is under test; authentication and database access are stubbed.
  Object.assign(auth.options, { advanced: { database: { validateSchema: false } } });
  mock.method(auth.api, "getSession", async () => ({ user: { id: "account-b" } }));
});

afterEach(() => {
  mock.restoreAll();
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

async function request(body: unknown, method = "PUT", action = "") {
  const response = { statusCode: 0, payload: "", setHeader() {}, end(value: string) { this.payload = value; } };
  await handler({ method, url: `/api/cloud${action ? `?action=${action}` : ""}`, headers: { origin: "https://euromillones.example" }, body } as ApiRequest, response as unknown as ServerResponse);
  return { status: response.statusCode, data: JSON.parse(response.payload) };
}

test("a tab from another account cannot overwrite the active workspace even when revisions match", async () => {
  const before = JSON.stringify(current);
  const result = await request({ state: initialState, workspaceId: "workspace-a", revision: 1 });
  assert.equal(result.status, 409);
  assert.match(result.data.error, /sesión o la copia compartida ha cambiado/);
  assert.equal(JSON.stringify(current), before);
  assert.equal(queries.length, 1);
});

test("requests without workspace context cannot write or change another account's schedule or invitations", async () => {
  for (const workspaceId of [undefined, "workspace-a"]) {
    assert.equal((await request({ state: initialState, revision: 1, workspaceId })).status, 409);
    assert.equal((await request({ enabled: true, workspaceId }, "POST", "schedule")).status, 409);
    assert.equal((await request({ workspaceId }, "POST", "invite")).status, 409);
  }
  assert.equal(queries.length, 6);
});

test("matching workspace context reaches state validation rather than the identity conflict guard", async () => {
  const result = await request({ state: { invalid: true }, workspaceId: "workspace-b", revision: 1 });
  assert.equal(result.status, 400);
  assert.match(result.data.error, /version/);
  assert.equal(queries.length, 1);
});

test("a changed session cannot create or join a workspace under an unintended account", async () => {
  for (const expectedUserId of [undefined, "account-a"]) {
    assert.equal((await request({ state: initialState, confirmMigration: true, expectedUserId }, "POST", "create")).status, 409);
    assert.equal((await request({ token: "invitation", expectedUserId }, "POST", "join")).status, 409);
  }
  assert.equal(queries.length, 0);
});
