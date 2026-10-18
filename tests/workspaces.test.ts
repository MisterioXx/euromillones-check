import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import type { WorkspaceRow } from '../src/server/workspaces';
import { createWorkspace, listWorkspaceBackups, readWorkspaceBackup, saveWorkspace, saveWorkspaceFromCron } from '../src/server/workspaces';
import { getPool } from '../src/server/database';
import { HttpError, bodyJson, requireSameOrigin, type ApiRequest } from '../src/server/http';
import { initialState } from '../src/lib/seed';

const originalDatabase = process.env.DATABASE_URL;
const originalOrigin = process.env.APP_ORIGIN;
let calls: Array<{ sql: string; values: unknown[] }>;
let releaseError: unknown;
let responder: (sql: string, values: unknown[]) => { rows: any[]; rowCount: number };
const result = (rows: any[] = [], rowCount = rows.length) => ({ rows, rowCount, command: '', oid: 0, fields: [] });
const workspace = (): WorkspaceRow => ({
  id: 'workspace-a', name: 'Peña', owner_id: 'owner', state: structuredClone(initialState), revision: 4,
  background_enabled: true, updated_at: new Date('2026-10-18T10:00:00Z'), last_checked_at: null,
  lease_token: 'active-lease', lease_until: new Date(Date.now() + 120_000),
});

beforeEach(() => {
  process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/test';
  process.env.APP_ORIGIN = 'https://euromillones.example/';
  calls = []; releaseError = undefined;
  responder = () => result();
  const query = async (sql: string, values: unknown[] = []) => { calls.push({ sql, values }); return responder(sql, values); };
  const client = { query, release: (error: unknown) => { releaseError = error; } };
  mock.method(getPool(), 'connect', async () => client);
  mock.method(getPool(), 'query', query);
});

afterEach(() => {
  mock.restoreAll();
  if (originalDatabase === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalDatabase;
  if (originalOrigin === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = originalOrigin;
});

function status(error: unknown, expected: number): boolean {
  assert(error instanceof HttpError); assert.equal(error.status, expected); return true;
}

function noStateWrites() {
  assert.equal(calls.some(({ sql }) => /^UPDATE ec_workspaces|^INSERT INTO ec_snapshots/.test(sql)), false);
  assert(calls.some(({ sql }) => sql === 'ROLLBACK'));
  assert.equal(calls.some(({ sql }) => sql === 'COMMIT'), false);
}

test('saving another workspace cannot bypass membership even with a known revision', async () => {
  await assert.rejects(saveWorkspace('workspace-a', initialState, 4, 'outsider'), (error) => status(error, 404));
  const lookup = calls.find(({ sql }) => sql.includes('FOR UPDATE OF w'))!;
  assert(lookup.sql.includes('JOIN ec_members'));
  assert(lookup.sql.includes('m.user_id=$2'));
  assert.deepEqual(lookup.values, ['workspace-a', 'outsider']);
  noStateWrites();
});

test('a user named cron has no scheduler bypass', async () => {
  await assert.rejects(saveWorkspace('workspace-a', initialState, 4, 'cron'), (error) => status(error, 404));
  assert(calls.some(({ sql, values }) => sql.includes('JOIN ec_members') && values[1] === 'cron'));
  noStateWrites();
});

test('stale revisions are rejected without changing data or creating misleading snapshots', async () => {
  responder = (sql) => sql.includes('FOR UPDATE OF w') ? result([workspace()]) : result();
  await assert.rejects(saveWorkspace('workspace-a', initialState, 3, 'member'), (error) => status(error, 409));
  noStateWrites();
});

test('an authorised save snapshots the previous state and preserves original migration backups', async () => {
  const current = workspace();
  current.state.draws[0].notes = 'Antes de editar';
  const edited = structuredClone(current.state); edited.draws[0].notes = 'Después de editar';
  responder = (sql) => {
    if (sql.includes('FOR UPDATE OF w')) return result([current]);
    if (sql.startsWith('UPDATE ec_workspaces')) return result([{ ...current, state: edited, revision: 5 }]);
    return result();
  };
  const saved = await saveWorkspace(current.id, edited, 4, 'member');
  assert.equal(saved.revision, 5);
  const backup = calls.find(({ sql }) => sql.startsWith('INSERT INTO ec_snapshots'))!;
  assert.equal(JSON.parse(backup.values[2] as string).draws[0].notes, 'Antes de editar');
  assert.equal(backup.values[3], 'member');
  assert.equal(backup.values[4], 'edit');
  const prune = calls.find(({ sql }) => sql.startsWith('DELETE FROM ec_snapshots'))!;
  assert.match(prune.sql, /reason<>'import'/);
  assert(calls.some(({ sql }) => sql === 'COMMIT'));
  assert.equal(current.state.draws[0].notes, 'Antes de editar');
});

test('initial migration keeps a validated original version and creates membership atomically', async () => {
  const original: any = structuredClone(initialState); original.version = 1;
  original.draws[0].status = 'checked'; original.draws[0].grossPrize = 3;
  responder = (sql) => {
    if (sql.startsWith('SELECT id FROM "user"')) return result([{ id: 'owner' }]);
    if (sql.startsWith('INSERT INTO ec_workspaces')) return result([workspace()]);
    return result();
  };
  await createWorkspace('owner', original, true);
  const working = calls.find(({ sql }) => sql.startsWith('INSERT INTO ec_workspaces'))!;
  assert.equal(JSON.parse(working.values[3] as string).version, 2);
  const backup = calls.find(({ sql }) => sql.startsWith('INSERT INTO ec_snapshots'))!;
  assert.equal(JSON.parse(backup.values[1] as string).version, 1);
  assert.equal(JSON.parse(backup.values[1] as string).draws[0].grossPrize, 3);
  assert(calls.some(({ sql }) => sql.startsWith('INSERT INTO ec_members')));
  assert(calls.some(({ sql }) => sql === 'COMMIT'));
});

test('expired, disabled or superseded cron leases cannot save', async () => {
  for (const patch of [
    { lease_token: 'other-run' }, { lease_until: new Date(Date.now() - 1) }, { background_enabled: false },
  ]) {
    calls = [];
    responder = (sql) => sql === 'SELECT * FROM ec_workspaces WHERE id=$1 FOR UPDATE' ? result([{ ...workspace(), ...patch }]) : result();
    await assert.rejects(saveWorkspaceFromCron('workspace-a', initialState, 4, { leaseToken: 'active-lease', checkedAt: new Date() }), (error) => status(error, 409));
    noStateWrites();
  }
});

test('scheduled state and last-checked time are saved together under the active lease', async () => {
  const checkedAt = new Date();
  responder = (sql) => {
    if (sql === 'SELECT * FROM ec_workspaces WHERE id=$1 FOR UPDATE') return result([workspace()]);
    if (sql.startsWith('UPDATE ec_workspaces')) return result([{ ...workspace(), revision: 5, last_checked_at: checkedAt }]);
    return result();
  };
  await saveWorkspaceFromCron('workspace-a', initialState, 4, { leaseToken: 'active-lease', checkedAt, deadline: Date.now() + 15_000 });
  const update = calls.find(({ sql }) => sql.startsWith('UPDATE ec_workspaces'))!;
  assert.match(update.sql, /last_checked_at=\$3/);
  assert.match(update.sql, /lease_token=\$4/);
  assert.match(update.sql, /lease_until>clock_timestamp\(\)/);
  assert.equal(update.values[2], checkedAt);
  assert.equal(update.values[3], 'active-lease');
  assert(calls.some(({ sql }) => sql === 'COMMIT'));
});

test('a cron deadline that has already passed never opens a transaction', async () => {
  await assert.rejects(saveWorkspaceFromCron('workspace-a', initialState, 4, { leaseToken: 'active-lease', checkedAt: new Date(), deadline: Date.now() - 1 }), (error) => status(error, 409));
  assert.equal(calls.length, 0);
});

test('backup listing and download are scoped to the authenticated membership', async () => {
  responder = (sql, values) => {
    if (sql.includes('FROM ec_snapshots') && values.includes('member')) return result([{ id: '7', revision: 4, actor: 'owner', reason: 'edit', created_at: new Date('2026-10-18T10:00:00Z'), ...(sql.startsWith('SELECT s.*') ? { state: initialState } : {}) }]);
    return result();
  };
  const backups = await listWorkspaceBackups('member');
  assert.equal(backups[0].id, '7');
  assert.equal('state' in backups[0], false);
  const restored = await readWorkspaceBackup('member', '7');
  assert.equal(restored.state.version, 2);
  assert.equal(restored.backup.id, '7');
  await assert.rejects(readWorkspaceBackup('outsider', '7'), (error) => status(error, 404));
  assert(calls.every(({ sql }) => sql.includes('JOIN ec_members') && sql.includes('m.user_id=')));
  await assert.rejects(readWorkspaceBackup('member', '7 OR true'), (error) => status(error, 400));
  await assert.rejects(readWorkspaceBackup('member', '9999999999999999999'), (error) => status(error, 400));
});

test('rollback failure discards the broken connection while retaining the original error', async () => {
  responder = (sql) => { if (sql === 'ROLLBACK') throw new Error('Connection lost'); return result(); };
  await assert.rejects(saveWorkspace('workspace-a', initialState, 4, 'outsider'), (error) => status(error, 404));
  assert(releaseError instanceof Error);
  assert.equal(releaseError.message, 'Connection lost');
});

test('cloud mutations require an exact allowed Origin, normalized without trailing slash', () => {
  assert.doesNotThrow(() => requireSameOrigin({ headers: { origin: 'https://euromillones.example' } } as ApiRequest));
  for (const origin of [undefined, 'null', 'https://attacker.example', 'https://euromillones.example.attacker.example']) {
    assert.throws(() => requireSameOrigin({ headers: { origin } } as ApiRequest), (error) => status(error, 403));
  }
});

test('cloud JSON parser rejects arrays, oversized bodies and non-serializable pre-parsed input', async () => {
  await assert.rejects(bodyJson({ body: [] } as ApiRequest), (error) => status(error, 400));
  await assert.rejects(bodyJson({ body: { huge: 'x'.repeat(1_000_001) } } as ApiRequest), (error) => status(error, 413));
  await assert.rejects(bodyJson({ body: { impossible: 1n } } as ApiRequest), (error) => status(error, 400));
  assert.deepEqual(await bodyJson({ body: '{"state":"safe"}' } as ApiRequest), { state: 'safe' });
});

test('a deadline reached just before commit rolls back the scheduled save', async () => {
  const baseline = Date.now();
  let time = baseline;
  mock.method(Date, 'now', () => time);
  let queryBudgets = 0;
  responder = (sql) => {
    if (sql === 'SELECT * FROM ec_workspaces WHERE id=$1 FOR UPDATE') return result([workspace()]);
    if (sql.startsWith('UPDATE ec_workspaces')) return result([{ ...workspace(), revision: 5 }]);
    if (sql.startsWith("SELECT set_config('statement_timeout'")) {
      queryBudgets += 1;
      // Four limits protect the writes. The fifth limit is the transaction's COMMIT guard.
      if (queryBudgets === 5) time = baseline + 15_001;
    }
    return result();
  };
  await assert.rejects(saveWorkspaceFromCron('workspace-a', initialState, 4, { leaseToken: 'active-lease', checkedAt: new Date(), deadline: baseline + 15_000 }), /agotado el tiempo/);
  assert(calls.some(({ sql }) => sql === 'ROLLBACK'));
  assert.equal(calls.some(({ sql }) => sql === 'COMMIT'), false);
});
