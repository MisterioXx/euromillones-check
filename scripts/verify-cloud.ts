import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { getPool, transaction } from "../src/server/database";
import { initialState } from "../src/lib/seed";

// Explicit integration test; only use against an isolated development database.
const base = process.env.TEST_ORIGIN ?? "http://localhost:5173";
if (process.env.CONFIRM_PREVIEW_TEST !== "yes") throw new Error("Set CONFIRM_PREVIEW_TEST=yes for a disposable preview test.");
const protectionHeaders: Record<string, string> = process.env.TEST_VERCEL_OIDC && new URL(base).hostname.endsWith(".vercel.app") ? { "x-vercel-trusted-oidc-idp-token": process.env.TEST_VERCEL_OIDC } : {};
const users: string[] = [];
const workspaces: string[] = [];
async function call(path: string, cookie = "", body?: unknown, method = body === undefined ? "GET" : "POST", origin = base) {
  const response = await fetch(`${base}${path}`, { method, headers: { ...protectionHeaders, Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  return { status: response.status, data, cookie: response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ") };
}
async function account(label: string) {
  const result = await call("/api/auth/sign-up/email", "", { name: `QA ${label}`, email: `qa-${randomUUID()}@example.invalid`, password: randomBytes(24).toString("base64url") });
  assert.equal(result.status, 200, `sign-up ${label}`);
  users.push(result.data.user.id);
  assert.ok(result.cookie, "session cookie");
  return result.cookie;
}
try {
  assert.equal((await call("/api/cloud?action=status")).data.configured, true);
  assert.equal((await call("/api/cloud")).status, 401);
  const a = await account("owner");
  const b = await account("outsider");
  const c = await account("member");
  const official = await call("/api/check-euromillones?date=2026-10-16");
  assert.equal(official.data.ok, true);
  const verified = official.data.prizesVerified === true;
  if (!verified && process.env.ALLOW_PENDING_SOURCE !== "yes") throw new Error("El servidor no obtuvo cuotas verificadas. No se completó la prueba de premios.");
  const numbers: number[] = official.data.numbers;
  const stars: number[] = official.data.stars;
  const misses = Array.from({length:50},(_,i)=>i+1).filter((n)=>!numbers.includes(n)).slice(0,3);
  const missedStars = Array.from({length:12},(_,i)=>i+1).filter((n)=>!stars.includes(n)).slice(0,2);
  const state = structuredClone(initialState);
  state.config.autoCheckOnOpen = false;
  state.draws = [{ ...state.draws.find((draw)=>draw.date==="2026-10-16")!, betNumbers:[...numbers.slice(0,2),...misses],betStars:missedStars,status:"pending",grossPrize:0 }];
  state.logs = [];
  const created = await call("/api/cloud?action=create", a, { state, expectedUserId:users[0], confirmMigration:true,backgroundEnabled:false });
  assert.equal(created.status,201);
  const workspaceId = created.data.workspace.id;
  workspaces.push(workspaceId);
  assert.equal((await call("/api/cloud",b)).data.workspace,null);
  assert.equal((await call("/api/cloud?action=create",a,{state,expectedUserId:users[0],confirmMigration:true})).status,409);
  assert.equal((await call("/api/cloud",a,{state,workspaceId,revision:1},"PUT","https://other.invalid")).status,403);
  assert.equal((await call("/api/cloud",a,{state:{bad:true},workspaceId,revision:1},"PUT")).status,400);
  const saved = await call("/api/cloud",a,{state,workspaceId,revision:1},"PUT");
  assert.equal(saved.status,200);
  assert.equal((await call("/api/cloud",a,{state,workspaceId,revision:1},"PUT")).status,409);
  const backups = await call("/api/cloud?action=backups",a);
  assert.ok(backups.data.backups.some((item:{reason:string})=>item.reason==="import"));
  const id=backups.data.backups[0].id;
  assert.equal((await call(`/api/cloud?action=backup&id=${id}`,b)).status,404);
  assert.equal((await call(`/api/cloud?action=backup&id=${id}`,a)).status,200);
  const invite = await call("/api/cloud?action=invite",a,{workspaceId});
  assert.equal((await call("/api/cloud?action=join",c,{token:invite.data.token,expectedUserId:users[2]})).status,200);
  assert.equal((await call("/api/cloud?action=join",b,{token:invite.data.token,expectedUserId:users[1]})).status,400);
  assert.equal((await call("/api/cloud?action=create",b,{state,expectedUserId:users[0],confirmMigration:true})).status,409);
  assert.equal((await call("/api/cloud?action=join",b,{token:invite.data.token,expectedUserId:users[0]})).status,409);
  const outsiderState = structuredClone(state);
  outsiderState.draws[0].notes = "Copia privada de otra cuenta";
  const outsiderCreated = await call("/api/cloud?action=create",b,{state:outsiderState,expectedUserId:users[1],confirmMigration:true,backgroundEnabled:false});
  assert.equal(outsiderCreated.status,201);
  workspaces.push(outsiderCreated.data.workspace.id);
  // An old tab still carries A's identity and revision, but the browser cookie now belongs to B.
  assert.equal(outsiderCreated.data.workspace.revision,1);
  assert.equal((await call("/api/cloud",b,{state,workspaceId,revision:1},"PUT")).status,409);
  assert.equal((await call("/api/cloud",b,{state,revision:1},"PUT")).status,409);
  assert.equal((await call("/api/cloud?action=schedule",b,{enabled:true,workspaceId})).status,409);
  assert.equal((await call("/api/cloud?action=invite",b,{workspaceId})).status,409);
  const unchanged = (await call("/api/cloud",b)).data.workspace;
  assert.equal(unchanged.revision,1);
  assert.deepEqual(unchanged.state,outsiderCreated.data.workspace.state);
  assert.equal((await call("/api/cloud?action=schedule",c,{enabled:true,workspaceId})).status,403);
  assert.equal((await call("/api/cloud",c)).data.workspace.id,workspaces[0]);
  assert.equal((await call("/api/cron")).status,401);
  const others = await getPool().query("SELECT count(*)::int n FROM ec_workspaces WHERE background_enabled AND id<>$1",[workspaces[0]]);
  assert.equal(others.rows[0].n,0,"Do not trigger cron while unrelated enabled workspaces exist in this test database.");
  assert.equal((await call("/api/cloud?action=schedule",a,{enabled:true,workspaceId})).status,200);
  const cron = await fetch(`${base}/api/cron`,{headers:{...protectionHeaders,Authorization:`Bearer ${process.env.CRON_SECRET}`}});
  assert.equal(cron.status,200);
  const after = (await call("/api/cloud",a)).data.workspace;
  assert.equal(after.state.draws[0].grossPrize,verified ? 3.67 : 0);
  assert.equal(after.state.draws[0].status,verified ? "checked" : "awaiting-prize");
  assert.ok(after.lastCheckedAt);
  assert.equal((await fetch(`${base}/api/cron`,{headers:{...protectionHeaders,Authorization:`Bearer ${process.env.CRON_SECRET}`}})).status,200);
  const repeated = (await call("/api/cloud",a)).data.workspace;
  assert.equal(repeated.state.draws[0].grossPrize,verified ? 3.67 : 0);
  console.log(`OK: acceso privado, aislamiento, migración, CAS, origen, backups, invitación de un uso, cron real. ${verified ? "Premio idempotente 3,67 €." : "Fuente de cuotas no disponible: se conserva importe cero y estado pendiente sin acreditar dinero."}`);
} finally {
  await transaction(async (client) => {
    for (const id of workspaces) {
      await client.query("DELETE FROM ec_invites WHERE workspace_id=$1",[id]);
      await client.query("DELETE FROM ec_snapshots WHERE workspace_id=$1",[id]);
      await client.query("DELETE FROM ec_members WHERE workspace_id=$1",[id]);
      await client.query("DELETE FROM ec_workspaces WHERE id=$1",[id]);
    }
    for (const id of users) {
      await client.query('DELETE FROM "session" WHERE "userId"=$1',[id]);
      await client.query('DELETE FROM "account" WHERE "userId"=$1',[id]);
      await client.query('DELETE FROM "user" WHERE id=$1',[id]);
    }
  });
  await getPool().end();
}
