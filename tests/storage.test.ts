import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { initialState } from '../src/lib/seed';
import { STORAGE_KEY, LEGACY_STORAGE_KEY, loadState, saveState, importState, getRecoveryBackup, getStorageIssue, listLocalBackups, readLocalBackup, exportLocalBackup } from '../src/lib/storage';

let memory: Map<string, string>;
let rejectWrites = false;
beforeEach(() => {
  memory = new Map(); rejectWrites = false;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: {
      get length() { return memory.size; },
      key: (index: number) => [...memory.keys()][index] ?? null,
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { if (rejectWrites) throw new Error('QuotaExceededError'); memory.set(key, value); },
    },
  } });
  loadState();
});

function legacyRaw(): string {
  return JSON.stringify({ ...initialState, version: 1, logs: [{ id: 'historical', at: '2026-01-27T10:00:00.000Z', level: 'info', message: 'Registro original' }] });
}

test('migration keeps original v1 untouched, creates a backup, and saves v2 separately', () => {
  const raw = legacyRaw(); memory.set(LEGACY_STORAGE_KEY, raw);
  const state = loadState();
  assert.equal(state.version, 2);
  assert(state.logs.some((log) => log.id === 'historical'));
  assert([...memory.entries()].some(([key, value]) => key.includes('backup:') && value === raw));
  saveState(state);
  assert.equal(memory.get(LEGACY_STORAGE_KEY), raw);
  assert.equal(JSON.parse(memory.get(STORAGE_KEY)!).version, 2);
});

test('corrupt data is retained verbatim and cannot be silently replaced by the seed', () => {
  memory.set(STORAGE_KEY, '{broken original');
  const fallback = loadState();
  assert.match(getStorageIssue()!, /guardado está bloqueado/);
  assert.deepEqual(getRecoveryBackup(), { key: STORAGE_KEY, raw: '{broken original' });
  assert.equal(fallback.logs[0].level, 'error');
  assert.throws(() => saveState(fallback), /bloqueado/);
  assert.equal(memory.get(STORAGE_KEY), '{broken original');
});

test('partial-schema backups trigger recovery instead of entering the application', () => {
  const raw = JSON.stringify({ version: 1, draws: [] }); memory.set(LEGACY_STORAGE_KEY, raw);
  loadState();
  assert.match(getStorageIssue()!, /config/);
  assert.throws(() => saveState(structuredClone(initialState)), /bloqueado/);
  assert.equal(memory.get(LEGACY_STORAGE_KEY), raw);
});

test('reviewed valid import backs up a corrupt original and unlocks saving', () => {
  const raw = '{broken original'; memory.set(STORAGE_KEY, raw); loadState();
  const imported = importState(structuredClone(initialState));
  assert.equal(getStorageIssue(), null);
  assert.equal(getRecoveryBackup(), null);
  assert([...memory.entries()].some(([key, value]) => key.includes('backup:import:') && value === raw));
  assert.doesNotThrow(() => saveState(imported));
});

test('invalid import cannot change either the saved data or the previous recovery lock', () => {
  const raw = JSON.stringify(initialState); memory.set(STORAGE_KEY, raw);
  assert.throws(() => importState({ version: 2 }), /config/);
  assert.equal(memory.get(STORAGE_KEY), raw);
});

test('if backup storage fails, migration cannot overwrite the original', () => {
  const raw = legacyRaw(); memory.set(LEGACY_STORAGE_KEY, raw); rejectWrites = true;
  const fallback = loadState();
  assert.match(getStorageIssue()!, /QuotaExceededError/);
  assert.throws(() => saveState(fallback), /bloqueado/);
  assert.equal(memory.get(LEGACY_STORAGE_KEY), raw);
  assert.equal(memory.has(STORAGE_KEY), false);
});

test('quota errors are surfaced and the existing saved state remains intact', () => {
  const raw = JSON.stringify(initialState); memory.set(STORAGE_KEY, raw);
  const state = loadState(); state.draws[0].notes = 'Nuevo cambio'; rejectWrites = true;
  assert.throws(() => saveState(state), /QuotaExceededError/);
  assert.match(getStorageIssue()!, /QuotaExceededError/);
  assert.equal(memory.get(STORAGE_KEY), raw);
});

test('a malformed copy written by another tab is not overwritten', () => {
  const state = loadState(); memory.set(STORAGE_KEY, '{other tab malformed');
  assert.throws(() => saveState(state), /No se sobrescribirá/);
  assert.equal(memory.get(STORAGE_KEY), '{other tab malformed');
  assert.equal(getRecoveryBackup()?.raw, '{other tab malformed');
});

test('repeated initial loading does not create duplicate migration backups', () => {
  memory.set(LEGACY_STORAGE_KEY, legacyRaw());
  loadState(); loadState();
  assert.equal([...memory.keys()].filter((key) => key.includes('backup:')).length, 1);
});

test('previous local copies and v1 can be inspected without replacing the current state', () => {
  const legacy = legacyRaw();
  memory.set(LEGACY_STORAGE_KEY, legacy);
  memory.set('unrelated-application:secret', 'not-a-backup');
  memory.set(STORAGE_KEY, JSON.stringify(initialState));
  memory.set('euromillones-control:backup:import:2026-10-18T10:00:00.000Z:id', JSON.stringify(initialState));
  const before = [...memory.entries()];
  const copies = listLocalBackups();
  assert.equal(copies.length, 2);
  assert.equal(copies[0].savedAt, '2026-10-18T10:00:00.000Z');
  assert(copies.some((copy) => copy.key === LEGACY_STORAGE_KEY && copy.label === 'Original de la versión 1'));
  assert.equal(readLocalBackup(LEGACY_STORAGE_KEY).version, 2);
  assert.deepEqual([...memory.entries()], before);
  assert.throws(() => readLocalBackup('unrelated-application:secret'), /no corresponde/);
});

test('a damaged historical backup remains downloadable verbatim', async (context) => {
  const raw = '{damaged but preserved';
  const key = 'euromillones-control:backup:before-v2';
  memory.set(key, raw);
  let exported: Blob | undefined;
  let clicked = false;
  context.mock.method(URL, 'createObjectURL', (blob: Blob) => { exported = blob; return 'blob:test'; });
  context.mock.method(URL, 'revokeObjectURL', () => {});
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ click: () => { clicked = true; } }) } });
  try {
    assert.throws(() => readLocalBackup(key));
    exportLocalBackup(key);
    assert.equal(clicked, true);
    assert.equal(await exported!.text(), raw);
    assert.equal(memory.get(key), raw);
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else Reflect.deleteProperty(globalThis, 'document');
  }
});
