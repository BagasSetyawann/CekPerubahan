import test from 'node:test';
import assert from 'node:assert/strict';
import { periodOf, periodsInYear, evaluate, isDate } from './periods.js';

const noHoliday = new Set();

test('periode mengikuti kalender', () => {
  assert.deepEqual(periodOf('triwulan', '2026-05-20'), { key: '2026-T2', start: '2026-04-01', end: '2026-06-30', label: 'Triwulan II 2026' });
  assert.equal(periodOf('semester', '2026-07-01').label, 'Semester II 2026');
  assert.equal(periodOf('bulanan', '2028-02-10').end, '2028-02-29');
  assert.equal(periodsInYear('triwulan', 2026, noHoliday).length, 4);
  assert.equal(periodsInYear('bulanan', 2026, noHoliday).length, 12);
});

test('harian hanya hari kerja dan bukan hari libur', () => {
  const days = periodsInYear('harian', 2026, new Set(['2026-01-01']));
  assert.ok(!days.some((p) => p.start === '2026-01-01')); // libur
  assert.ok(!days.some((p) => p.start === '2026-01-03')); // Sabtu
  assert.equal(days[0].start, '2026-01-02');
});

test('status, target, keterlambatan, dan persentase', () => {
  const a = { frequency: 'triwulan', target: 1, start_date: '2026-01-01' };
  const r = evaluate(a, [
    { done_date: '2026-02-01', recorded_on: '2026-02-01' },
    { done_date: '2026-05-01', recorded_on: '2026-07-10' }, // dicatat terlambat
  ], 2026, '2026-08-15', noHoliday);
  assert.deepEqual(r.periods.map((p) => p.status), ['selesai', 'selesai', 'berjalan', 'akan']);
  assert.deepEqual(r.periods.map((p) => p.late), [false, true, false, false]);
  assert.equal(r.pct, 100);

  const two = { frequency: 'tahunan', target: 2, start_date: '2026-01-01' };
  const r2 = evaluate(two, [{ done_date: '2026-03-01', recorded_on: '2026-03-01' }], 2026, '2027-01-02', noHoliday);
  assert.equal(r2.periods[0].status, 'terlewat');
  assert.equal(r2.pct, 0);

  const late = { frequency: 'bulanan', target: 1, start_date: '2026-11-01' };
  assert.equal(evaluate(late, [], 2026, '2026-11-18', noHoliday).periods.length, 2); // mulai November
});

test('validasi tanggal', () => {
  assert.ok(isDate('2026-02-28'));
  assert.ok(!isDate('2026-02-30'));
  assert.ok(!isDate('28-02-2026'));
});
