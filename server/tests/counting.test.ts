import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assignDuplicates,
  classify,
  classifyWorkouts,
  countInWindow,
  overlapRatio,
  type WorkoutLike,
} from '../src/services/fitness/counting';
import { clampWindow, requiredFor } from '../src/lib/weeks';

let nextId = 1;
/** Тренировка: время в UTC, длительность в минутах. */
function w(startIso: string, minutes: number, extra: Partial<WorkoutLike> = {}): WorkoutLike {
  return {
    id: nextId++,
    source: 'manual',
    startedAt: new Date(startIso),
    durationSec: minutes * 60,
    excluded: false,
    duplicateOfId: null,
    forceCounted: false,
    ...extra,
  };
}

const RULES = { minWorkoutMin: 20, maxWorkoutsPerDay: 1, tz: 'Europe/Moscow' };

test('overlapRatio: доля от более короткой записи', () => {
  const hour = w('2026-10-05T07:00:00Z', 60);
  assert.equal(overlapRatio(hour, w('2026-10-05T07:10:00Z', 40)), 1); // целиком внутри
  assert.equal(overlapRatio(hour, w('2026-10-05T07:30:00Z', 60)), 0.5);
  assert.equal(overlapRatio(hour, w('2026-10-05T08:00:00Z', 30)), 0); // встык — не пересечение
  assert.equal(overlapRatio(hour, w('2026-10-05T12:00:00Z', 30)), 0);
});

test('assignDuplicates: браслет главнее ручной записи, даже если она внесена раньше', () => {
  const manual = w('2026-10-05T07:05:00Z', 50);
  const whoop = w('2026-10-05T07:00:00Z', 55, { source: 'whoop' });
  const result = assignDuplicates([manual, whoop]);
  assert.equal(result.get(whoop.id), null);
  assert.equal(result.get(manual.id), whoop.id);
});

test('assignDuplicates: хаб главнее агрегатора, при равенстве — более ранняя запись', () => {
  const strava = w('2026-10-05T07:00:00Z', 60, { source: 'strava' });
  const hae = w('2026-10-05T07:00:00Z', 60, { source: 'hae' });
  assert.equal(assignDuplicates([strava, hae]).get(strava.id), hae.id);

  const first = w('2026-10-06T07:00:00Z', 60);
  const second = w('2026-10-06T07:00:00Z', 60);
  const result = assignDuplicates([second, first]);
  assert.deepEqual([result.get(first.id), result.get(second.id)], [null, first.id]);
});

test('assignDuplicates: слабое перекрытие и разные дни — не дубли', () => {
  const morning = w('2026-10-05T07:00:00Z', 60);
  const tail = w('2026-10-05T07:50:00Z', 60); // перекрытие 10 минут из 60
  const evening = w('2026-10-05T17:00:00Z', 45, { source: 'whoop' });
  const result = assignDuplicates([morning, tail, evening]);
  assert.deepEqual([...result.values()], [null, null, null]);
});

test('assignDuplicates: снятая админом запись остаётся основной для своего дубля', () => {
  const whoop = w('2026-10-05T07:00:00Z', 60, { source: 'whoop', excluded: true });
  const manual = w('2026-10-05T07:00:00Z', 60);
  assert.equal(assignDuplicates([whoop, manual]).get(manual.id), whoop.id);
});

test('classifyWorkouts: короткая, дубль и снятая в зачёт не идут', () => {
  const short = w('2026-10-05T07:00:00Z', 19);
  const exact = w('2026-10-06T07:00:00Z', 20);
  const dup = w('2026-10-07T07:00:00Z', 60, { duplicateOfId: 999 });
  const removed = w('2026-10-08T07:00:00Z', 60, { excluded: true });
  const v = classifyWorkouts([short, exact, dup, removed], RULES);
  assert.deepEqual(
    [v.get(short.id), v.get(exact.id), v.get(dup.id), v.get(removed.id)],
    ['too_short', 'counted', 'duplicate', 'excluded'],
  );
});

test('classifyWorkouts: лимит в день — в зачёт идёт самая ранняя', () => {
  const evening = w('2026-10-05T16:00:00Z', 40);
  const morning = w('2026-10-05T06:00:00Z', 40);
  const v = classifyWorkouts([evening, morning], RULES);
  assert.deepEqual([v.get(morning.id), v.get(evening.id)], ['counted', 'day_limit']);

  const two = classifyWorkouts([evening, morning], { ...RULES, maxWorkoutsPerDay: 2 });
  assert.deepEqual([two.get(morning.id), two.get(evening.id)], ['counted', 'counted']);
});

test('classifyWorkouts: короткая тренировка не съедает дневной лимит', () => {
  const short = w('2026-10-05T06:00:00Z', 5);
  const real = w('2026-10-05T16:00:00Z', 40);
  const v = classifyWorkouts([short, real], RULES);
  assert.deepEqual([v.get(short.id), v.get(real.id)], ['too_short', 'counted']);
});

test('classifyWorkouts: день считается в поясе челленджа', () => {
  // 22:30 UTC 5 октября — это уже 01:30 6 октября по Москве: две тренировки в разные дни
  const lateNight = w('2026-10-05T22:30:00Z', 40);
  const sameUtcDay = w('2026-10-05T10:00:00Z', 40);
  const v = classifyWorkouts([lateNight, sameUtcDay], RULES);
  assert.deepEqual([v.get(lateNight.id), v.get(sameUtcDay.id)], ['counted', 'counted']);
});

test('countInWindow: считает только засчитанные и только внутри окна', () => {
  const window = { start: '2026-10-05', end: '2026-10-11', days: 7 };
  const workouts = [
    w('2026-10-04T10:00:00Z', 40), // до окна
    w('2026-10-05T10:00:00Z', 40),
    w('2026-10-05T16:00:00Z', 40), // лимит дня
    w('2026-10-07T10:00:00Z', 10), // короткая
    w('2026-10-11T20:30:00Z', 40), // 23:30 по Москве — последний день окна
    w('2026-10-11T21:30:00Z', 40), // 00:30 12-го по Москве — уже следующая неделя
  ];
  const { done, byDay } = countInWindow(workouts, RULES, window);
  assert.equal(done, 2);
  assert.deepEqual([...byDay.entries()], [['2026-10-05', 1], ['2026-10-11', 1]]);
});

test('вступивший позже: норма за остаток недели, но тренировка до вступления засчитана', () => {
  // Правило из computeWeek: норму берём по окну участия, зачёт — по всей неделе челленджа.
  // Данные с часов приходят за прошедшие дни, а в приложение человек заходит позже, поэтому
  // привязка зачёта к моменту вступления теряла настоящую тренировку.
  const week = { start: '2026-10-05', end: '2026-10-11', days: 7 };
  const joined = clampWindow(week, '2026-10-06');
  assert.ok(joined);

  const workouts = [
    w('2026-10-05T06:00:00Z', 65), // накануне вступления
    w('2026-10-08T06:00:00Z', 65),
  ];

  assert.equal(joined.days, 6);
  assert.equal(requiredFor(3, joined.days), 3);
  assert.equal(countInWindow(workouts, RULES, week).done, 2);
  // привязка к окну участия теряла первую тренировку — ради этого правило и поменяли
  assert.equal(countInWindow(workouts, RULES, joined).done, 1);
});

test('classify: соседние записи — одна тренировка, длительность суммируется', () => {
  // источник режет занятие по видам активности: дорожка, сразу за ней силовая
  const treadmill = w('2026-10-05T17:03:00Z', 15);
  const strength = w('2026-10-05T17:18:10Z', 10);
  const { sessions, verdicts } = classify([treadmill, strength], RULES);

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].durationSec, 25 * 60);
  // по отдельности обе короче минимума, вместе — полноценная тренировка
  assert.deepEqual([verdicts.get(treadmill.id), verdicts.get(strength.id)], ['counted', 'counted']);
});

test('classify: длинная пауза разрывает тренировку на две', () => {
  const gym = w('2026-10-05T16:03:00Z', 27);
  const evening = w('2026-10-05T17:03:00Z', 25); // пауза 33 минуты
  const { sessions } = classify([gym, evening], RULES);

  assert.equal(sessions.length, 2);
  assert.deepEqual(sessions.map((s) => s.verdict), ['counted', 'day_limit']);
});

test('countInWindow: разрезанное занятие считается одной тренировкой', () => {
  const window = { start: '2026-10-05', end: '2026-10-11', days: 7 };
  const workouts = [w('2026-10-05T17:03:00Z', 15), w('2026-10-05T17:18:10Z', 10)];
  assert.equal(countInWindow(workouts, RULES, window).done, 1);
});

test('classify: ручной зачёт проводит мимо минимума и лимита дня', () => {
  const full = w('2026-10-05T07:00:00Z', 40); // занимает лимит дня
  const short = w('2026-10-05T17:00:00Z', 12, { forceCounted: true });
  const { verdicts } = classify([full, short], RULES);

  assert.deepEqual([verdicts.get(full.id), verdicts.get(short.id)], ['counted', 'counted']);
});

test('classify: зал из двух записей при часовом минимуме', () => {
  const rules = { ...RULES, minWorkoutMin: 60 };
  const treadmill = w('2026-09-21T17:03:00Z', 41.5);
  const strength = w('2026-09-21T17:44:50Z', 11.1);
  // вместе 52.6 минуты — до часа не дотягивает даже после склейки
  assert.equal(classify([treadmill, strength], rules).sessions[0].verdict, 'too_short');

  const forced = w('2026-09-21T17:44:50Z', 11.1, { forceCounted: true });
  assert.equal(classify([treadmill, forced], rules).sessions[0].verdict, 'counted');
});

test('assignDuplicates: при равном источнике главнее более длинная — исправленная — запись', () => {
  // WHOOP выгрузил силовую 09:45–10:17, потом в ней сдвинули начало на 09:10 — пришла новой записью
  const old = w('2026-09-23T06:45:00Z', 32, { source: 'hae' });
  const edited = w('2026-09-23T06:10:00Z', 66, { source: 'hae' });
  const result = assignDuplicates([old, edited]);
  assert.equal(result.get(edited.id), null);
  assert.equal(result.get(old.id), edited.id);
});

test('classify: перекрытие частей занятия считается один раз', () => {
  // ходьба до зала 08:49–09:25 заходит на силовую 09:10–10:16: занятие 08:49–10:16, 87 минут, а не 102
  const walk = w('2026-09-23T05:49:00Z', 36, { source: 'hae' });
  const gym = w('2026-09-23T06:10:00Z', 66, { source: 'hae' });
  const { sessions } = classify([walk, gym], { ...RULES, minWorkoutMin: 60 });
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]!.durationSec, 87 * 60);
  assert.equal(sessions[0]!.verdict, 'counted');
});
