import assert from 'node:assert/strict';
import test from 'node:test';
import type { AppState, OfficialCheckResponse } from '../src/types';
import { initialState } from '../src/lib/seed';
import { validateState, parseNumberList } from '../src/lib/validation';
import { drawNetPrize, totals } from '../src/lib/domain';
import { isResultDue, todayIso, parseIsoDate, isoWeek } from '../src/lib/dates';
import { applyCheckResult, getPendingDraws, renewPeriod } from '../src/lib/reconciliation';

function fixture(): AppState {
  const state = structuredClone(initialState);
  const draw = state.draws.find((entry) => entry.date === '2026-10-16')!;
  state.draws = [{ ...draw, notes: 'Nota de la peña.' }];
  return state;
}

function response(patch: Partial<OfficialCheckResponse> = {}): OfficialCheckResponse {
  return {
    ok: true, source: 'https://www.loteriasyapuestas.es/', sourceName: 'SELAE',
    fetchedAt: '2026-10-18T10:00:00.000Z', requestedDate: '2026-10-16', date: '2026-10-16',
    numbers: [7, 14, 20, 30, 40], stars: [1, 2], prizesVerified: true,
    prizes: [{ category: '13a categoria', amount: 3.67, formattedAmount: '3,67 €' }], ...patch,
  };
}

function check(state: AppState, result = response()): AppState {
  return applyCheckResult(state, state.draws[0].id, result);
}

test('migrates v1 without changing money, user notes, existing logs or pending dates', () => {
  const legacy: any = structuredClone(initialState);
  legacy.version = 1;
  legacy.draws[0].status = 'pending';
  legacy.draws[0].grossPrize = 8.42;
  legacy.draws[0].notes = 'Corrección conservada';
  for (const draw of legacy.draws) { delete draw.betNumbers; delete draw.betStars; }
  legacy.logs = [{ id: 'old', at: '2026-01-27T10:00:00.000Z', level: 'warning', message: 'Aviso antiguo' }];
  const before = JSON.stringify(legacy);
  const migrated = validateState(legacy);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.draws[0].status, 'pending');
  assert.equal(migrated.draws[0].grossPrize, 8.42);
  assert.equal(migrated.draws[0].notes, 'Corrección conservada');
  assert.deepEqual(migrated.logs, legacy.logs);
  assert.deepEqual(migrated.draws[0].betNumbers, legacy.config.numbers);
  assert.equal(JSON.stringify(legacy), before);
});

test('migrates legacy checked-without-amount into a retryable state', () => {
  const legacy: any = fixture(); legacy.version = 1;
  legacy.draws[0].status = 'checked';
  legacy.draws[0].grossPrize = 2.15;
  legacy.draws[0].notes = '13a categoria. Importe pendiente: la fuente no incluyo tabla de premios.';
  const migrated = validateState(legacy);
  assert.equal(migrated.draws[0].status, 'awaiting-prize');
  assert.equal(migrated.draws[0].grossPrize, 2.15);
  assert.equal(migrated.draws[0].notes, legacy.draws[0].notes);
});

test('rejects missing schema, invalid dates, fractional money and duplicate draws', () => {
  assert.throws(() => validateState({ version: 1, draws: [] }), /config/);
  const invalidDate = fixture(); invalidDate.draws[0].date = '2026-02-30';
  assert.throws(() => validateState(invalidDate), /fecha real/);
  const fractional = fixture(); fractional.draws[0].grossPrize = 3.675;
  assert.throws(() => validateState(fractional), /decimales/);
  const duplicate = fixture(); duplicate.draws.push(structuredClone(duplicate.draws[0]));
  assert.throws(() => validateState(duplicate), /duplicados/);
  const infinite = fixture(); infinite.draws[0].grossPrize = Infinity;
  assert.throws(() => validateState(infinite), /finito/);
  const oversized = fixture(); oversized.draws[0].lines = Number.MAX_SAFE_INTEGER;
  assert.throws(() => validateState(oversized), /coste total/);
});

test('combination parser rejects decimals, duplicate or extra tokens, and accepts formatted lists', () => {
  for (const input of ['1.5 2 3 4 5', '1 1 2 3 4 5', '1 2 3 4 5 texto', '1 2 3 4', '0 2 3 4 5']) {
    assert.equal(parseNumberList(input, 1, 50, 5), null, input);
  }
  assert.deepEqual(parseNumberList(' 07, 14,17 25 33 ', 1, 50, 5), [7, 14, 17, 25, 33]);
});

test('totals calculate in cents and retain the documented expense cap', () => {
  const state = fixture();
  state.participants = [{ id: 'p', name: 'Peña', annualContribution: 0.1, extraContribution: 0.2 }];
  state.draws[0].costPerLine = 0;
  assert.equal(totals(state, '2026-10-18').balanceToDate, 0.3);
  state.draws[0].grossPrize = 0.3;
  state.draws[0].expenses = 0.1;
  assert.equal(drawNetPrize(state.draws[0]), 0.2);
  assert.equal(totals(state, '2026-10-18').balanceToDate, 0.5);
  state.draws[0].expenses = 5;
  assert.equal(drawNetPrize(state.draws[0]), 0);
  assert.equal(totals(state, '2026-10-18').balanceToDate, 0.3);
});

test('Madrid publication cutoff observes winter, summer and local midnight', () => {
  assert.equal(isResultDue('2026-10-16', new Date('2026-10-16T19:59:59Z')), false);
  assert.equal(isResultDue('2026-10-16', new Date('2026-10-16T20:00:00Z')), true);
  assert.equal(isResultDue('2026-11-03', new Date('2026-11-03T20:59:59Z')), false);
  assert.equal(isResultDue('2026-11-03', new Date('2026-11-03T21:00:00Z')), true);
  assert.equal(todayIso(new Date('2026-10-16T22:30:00Z')), '2026-10-17');
  assert.equal(isResultDue('2026-10-20', new Date('2026-10-18T12:00:00Z')), false);
  assert.equal(isoWeek('2027-01-01'), '2026-W53');
  assert.throws(() => parseIsoDate('2026-02-30'), /no válida/);
});

test('trusted result updates one award idempotently and preserves source, user notes and input', () => {
  const state = fixture();
  const before = JSON.stringify(state);
  const once = check(state);
  const twice = check(once);
  assert.equal(once.draws[0].grossPrize, 3.67);
  assert.equal(once.draws[0].status, 'checked');
  assert.equal(once.draws[0].prizeSource, 'automatic');
  assert.equal(once.draws[0].notes, 'Nota de la peña.');
  assert.equal(once.draws[0].resultSource, response().source);
  assert.match(once.logs[0].details!, /SELAE/);
  assert.equal(totals(twice, '2026-10-18').balanceToDate, totals(once, '2026-10-18').balanceToDate);
  assert.equal(twice.logs.length, once.logs.length);
  assert.equal(JSON.stringify(state), before);
});

test('reconciliation uses a draw snapshot even after the configured bet changes', () => {
  const state = fixture(); state.config.numbers = [1, 2, 3, 4, 5]; state.config.stars = [9, 10];
  assert.equal(check(state).draws[0].grossPrize, 3.67);
});

test('unknown or unverified prize amounts never enter the balance and remain retryable', () => {
  for (const patch of [
    { prizesVerified: undefined }, { prizesVerified: false }, { prizes: [] },
    { prizes: [{ category: '13a categoria', amount: 0, formattedAmount: '0,00 €' }] },
  ]) {
    const state = fixture(); const result = check(state, response(patch));
    assert.equal(result.draws[0].status, 'awaiting-prize');
    assert.equal(result.draws[0].grossPrize, 0);
    assert.equal(totals(result, '2026-10-18').balanceToDate, totals(state, '2026-10-18').balanceToDate);
    assert.equal(getPendingDraws(result, new Date('2026-10-18T12:00:00Z')).length, 1);
  }
});

test('rejects date mismatch, invalid numbers, duplicate categories and conflicting category', () => {
  const badResponses = [
    response({ date: '2026-10-13' }), response({ numbers: [7, 7, 20, 30, 40] }),
    response({ category: '12a categoria' }),
    response({ prizes: [response().prizes![0], response().prizes![0]] }),
    response({ prizes: [{ category: '13a categoria', amount: NaN, formattedAmount: '' }] }),
  ];
  for (const result of badResponses) {
    const checked = check(fixture(), result);
    assert.equal(checked.draws[0].status, 'error');
    assert.equal(checked.draws[0].grossPrize, 0);
    assert.equal(checked.logs[0].level, 'error');
  }
});

test('manual and imported prize conflicts preserve their money and notes', () => {
  for (const source of ['manual', 'imported'] as const) {
    const state = fixture();
    state.draws[0] = { ...state.draws[0], status: 'manual', prizeSource: source, grossPrize: 4.25 };
    const checked = check(state);
    assert.equal(checked.draws[0].grossPrize, 4.25);
    assert.equal(checked.draws[0].prizeSource, source);
    assert.equal(checked.draws[0].notes, 'Nota de la peña.');
    assert.equal(checked.draws[0].status, 'awaiting-prize');
    assert.match(checked.draws[0].checkError!, /conserva/);
  }
});

test('a matching protected prize stays manual and does not create another payment', () => {
  const state = fixture(); state.draws[0] = { ...state.draws[0], status: 'manual', prizeSource: 'imported', grossPrize: 3.67 };
  const checked = check(state);
  assert.equal(checked.draws[0].status, 'manual');
  assert.equal(checked.draws[0].prizeSource, 'imported');
  assert.equal(totals(state, '2026-10-18').balanceToDate, totals(checked, '2026-10-18').balanceToDate);
});

test('ambiguous multiple lines never receive an automatic amount', () => {
  const state = fixture(); state.draws[0].lines = 2;
  const checked = check(state);
  assert.equal(checked.draws[0].status, 'awaiting-prize');
  assert.equal(checked.draws[0].grossPrize, 0);
});

test('a valid losing combination can settle with no verified prize table', () => {
  const checked = check(fixture(), response({ numbers: [1, 2, 3, 4, 5], prizes: [], prizesVerified: false }));
  assert.equal(checked.draws[0].status, 'checked');
  assert.equal(checked.draws[0].grossPrize, 0);
});

test('error responses retain an existing award and can recover on a later verified result', () => {
  const state = check(fixture());
  const failed = check(state, response({ ok: false, message: 'Fuente temporalmente no disponible' }));
  assert.equal(failed.draws[0].grossPrize, 3.67);
  assert.equal(failed.draws[0].status, 'error');
  assert.equal(getPendingDraws(failed, new Date('2026-10-18T12:00:00Z')).length, 1);
  const recovered = check(failed, response({ fetchedAt: '2026-10-18T11:00:00.000Z' }));
  assert.equal(recovered.draws[0].status, 'checked');
  assert.equal(recovered.draws[0].checkError, undefined);
});

test('calendar renewal adds only future scheduled dates and preserves all existing records', () => {
  const state = structuredClone(initialState);
  const renewed = renewPeriod(state, '2027-02-02');
  assert.deepEqual(renewed.draws.slice(0, state.draws.length), state.draws);
  assert.deepEqual(renewed.participants, state.participants);
  assert.deepEqual(renewed.draws.slice(state.draws.length).map((draw) => draw.date), ['2027-01-29', '2027-02-02']);
  assert.equal(renewPeriod(renewed, '2027-02-02'), renewed);
  assert.throws(() => renewPeriod(state, '2026-12-31'), /acortar/);
});

test('legacy automatic amounts without exact provenance keep their balance and require protected reconciliation', () => {
  const legacy: any = fixture(); legacy.version = 1;
  legacy.draws[0] = { ...legacy.draws[0], status: 'checked', grossPrize: 3, notes: 'Importe anterior' };
  const oldBalance = totals(legacy, '2026-10-18').balanceToDate;
  const migrated = validateState(legacy);
  assert.equal(migrated.draws[0].status, 'awaiting-prize');
  assert.equal(migrated.draws[0].prizeSource, 'imported');
  assert.equal(totals(migrated, '2026-10-18').balanceToDate, oldBalance);
  const checked = check(migrated);
  assert.equal(checked.draws[0].grossPrize, 3);
  assert.equal(checked.draws[0].notes, 'Importe anterior');
  assert.match(checked.draws[0].checkError!, /3.67.*3.00/);
});

test('invalid timestamp cannot enter a result or an imported activity log', () => {
  const invalid = fixture();
  invalid.logs = [{ id: 'bad-time', at: '2026-02-30T10:00:00Z', level: 'info', message: 'Fecha inventada' }];
  assert.throws(() => validateState(invalid), /fecha y hora ISO/);
  const checked = check(fixture(), response({ fetchedAt: '2026-02-30T10:00:00Z' }));
  assert.equal(checked.draws[0].status, 'error');
  assert.equal(checked.draws[0].grossPrize, 0);
  assert.doesNotThrow(() => validateState(checked));
});
