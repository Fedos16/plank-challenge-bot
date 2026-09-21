import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampWindow,
  closedWeekIndexes,
  requiredFor,
  weekCloseInstant,
  weekIndexOf,
  weekRange,
} from '../src/lib/weeks';

const START = '2026-10-01'; // четверг: недели челленджа не совпадают с календарными
const END_100 = '2027-01-08'; // день 100

test('weekIndexOf: 7-дневки от даты старта', () => {
  assert.equal(weekIndexOf(START, '2026-10-01'), 0);
  assert.equal(weekIndexOf(START, '2026-10-07'), 0);
  assert.equal(weekIndexOf(START, '2026-10-08'), 1);
  assert.equal(weekIndexOf(START, END_100), 14);
  assert.equal(weekIndexOf(START, '2026-09-30'), -1);
});

test('weekIndexOf: переход на зимнее время не сдвигает границу', () => {
  // 25 октября 2026 в Европе часы переводят назад — сутки длятся 25 часов
  assert.equal(weekIndexOf('2026-10-19', '2026-10-25'), 0);
  assert.equal(weekIndexOf('2026-10-19', '2026-10-26'), 1);
});

test('weekRange: полная неделя', () => {
  assert.deepEqual(weekRange(START, 0, END_100), { start: '2026-10-01', end: '2026-10-07', days: 7 });
  assert.deepEqual(weekRange(START, 1, END_100), { start: '2026-10-08', end: '2026-10-14', days: 7 });
});

test('weekRange: хвост челленджа на 100 дней — два дня', () => {
  assert.deepEqual(weekRange(START, 14, END_100), { start: '2027-01-07', end: '2027-01-08', days: 2 });
  assert.equal(weekRange(START, 15, END_100), null);
});

test('weekRange: бессрочный челлендж не обрезается', () => {
  assert.deepEqual(weekRange(START, 50, null)?.days, 7);
  assert.equal(weekRange(START, -1, null), null);
});

test('clampWindow: вступивший посреди недели отвечает за остаток', () => {
  const week = weekRange(START, 0, END_100)!;
  assert.deepEqual(clampWindow(week, '2026-10-05'), { start: '2026-10-05', end: '2026-10-07', days: 3 });
  assert.deepEqual(clampWindow(week, '2026-09-20'), week); // вступил до старта — полная неделя
  assert.deepEqual(clampWindow(week, '2026-10-01'), week);
  assert.deepEqual(clampWindow(week, null), week);
  assert.equal(clampWindow(week, '2026-10-08'), null); // вступил уже после этой недели
});

test('requiredFor: неполная неделя — пропорционально с округлением вверх', () => {
  assert.equal(requiredFor(3, 7), 3);
  assert.equal(requiredFor(3, 2), 1); // хвост на 100 дней
  assert.equal(requiredFor(3, 4), 2);
  assert.equal(requiredFor(3, 1), 1);
  assert.equal(requiredFor(5, 3), 3);
  assert.equal(requiredFor(3, 0), 0);
  assert.equal(requiredFor(0, 7), 0);
});

test('requiredFor: норма достижима при одной тренировке в день', () => {
  for (let weekly = 1; weekly <= 7; weekly++) {
    for (let days = 1; days <= 7; days++) {
      assert.ok(requiredFor(weekly, days) <= days, `норма ${weekly} на ${days} дн.`);
    }
  }
});

test('weekCloseInstant: на следующий день после конца недели в TZ челленджа', () => {
  const week = weekRange(START, 0, END_100)!;
  // 8 октября 12:00 по Москве = 09:00 UTC
  assert.equal(
    weekCloseInstant(week, '12:00', 'Europe/Moscow').toISOString(),
    '2026-10-08T09:00:00.000Z',
  );
});

test('closedWeekIndexes: неделя закрывается только после зазора', () => {
  const base = { startDay: START, endDay: END_100, tz: 'Europe/Moscow', closeTime: '12:00' };
  assert.deepEqual(closedWeekIndexes({ ...base, now: new Date('2026-10-08T08:59:00Z') }), []);
  assert.deepEqual(closedWeekIndexes({ ...base, now: new Date('2026-10-08T09:00:00Z') }), [0]);
});

test('closedWeekIndexes: догоняет простой и останавливается на конце челленджа', () => {
  const base = { startDay: START, endDay: END_100, tz: 'Europe/Moscow', closeTime: '12:00' };
  assert.deepEqual(closedWeekIndexes({ ...base, now: new Date('2026-10-25T00:00:00Z') }), [0, 1, 2]);
  const all = closedWeekIndexes({ ...base, now: new Date('2027-06-01T00:00:00Z') });
  assert.equal(all.length, 15);
  assert.equal(all.at(-1), 14);
});

test('closedWeekIndexes: до старта закрытых недель нет', () => {
  const base = { startDay: START, endDay: END_100, tz: 'Europe/Moscow', closeTime: '12:00' };
  assert.deepEqual(closedWeekIndexes({ ...base, now: new Date('2026-09-01T00:00:00Z') }), []);
});
