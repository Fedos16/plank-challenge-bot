import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ParticipantGoal, WeightEntry } from '@prisma/client';
import { currentMetric, goalProgress, goalStartsFrom, progressFor, startMetric } from '../src/services/fitness/goals';
import { muscleKgOf, musclePctOf } from '../src/services/weight';

test('goalProgress: похудение — движение вниз', () => {
  assert.equal(goalProgress(90, 80, 90), 0);
  assert.equal(goalProgress(90, 80, 85), 50);
  assert.equal(goalProgress(90, 80, 80), 100);
});

test('goalProgress: набор мышц — движение вверх той же формулой', () => {
  assert.equal(goalProgress(38, 42, 38), 0);
  assert.equal(goalProgress(38, 42, 40), 50);
  assert.equal(goalProgress(38, 42, 42), 100);
});

test('goalProgress: откат дальше старта — 0, перевыполнение — 100', () => {
  assert.equal(goalProgress(90, 80, 93), 0);
  assert.equal(goalProgress(90, 80, 76), 100);
  assert.equal(goalProgress(38, 42, 36), 0);
});

test('goalProgress: без данных или с целью, равной старту, процента нет', () => {
  assert.equal(goalProgress(null, 80, 85), null);
  assert.equal(goalProgress(90, null, 85), null);
  assert.equal(goalProgress(90, 80, null), null);
  assert.equal(goalProgress(80, 80, 80), null);
});

const at = (iso: string) => new Date(iso);
const entry = (iso: string, weightKg: number, bodyFat: number | null = null) => ({
  measuredAt: at(iso),
  weightKg,
  bodyFat,
  muscle: null,
});

test('currentMetric: последнее взвешивание, порядок входа не важен', () => {
  const entries = [
    entry('2026-10-08T07:00:00Z', 86.0),
    entry('2026-10-10T07:00:00Z', 84.0),
    entry('2026-10-09T07:00:00Z', 85.0),
  ];
  assert.equal(currentMetric(entries, 'weightKg'), 84);
});

test('currentMetric: кто давно не взвешивался — остаётся последняя известная точка', () => {
  const entries = [entry('2025-01-02T07:00:00Z', 88.0), entry('2025-01-01T07:00:00Z', 89.0)];
  assert.equal(currentMetric(entries, 'weightKg'), 88);
});

test('currentMetric: показатель берётся из последнего замера, где он есть', () => {
  const entries = [
    entry('2026-10-10T07:00:00Z', 84.0, null), // весы не измерили жир
    entry('2026-10-09T07:00:00Z', 85.0, 21.0),
    entry('2026-10-08T07:00:00Z', 86.0, 22.0),
  ];
  assert.equal(currentMetric(entries, 'weightKg'), 84);
  assert.equal(currentMetric(entries, 'bodyFat'), 21);
  assert.equal(currentMetric(entries, 'muscle'), null);
  assert.equal(currentMetric([], 'weightKg'), null);
});

test('currentMetric: округление до десятых', () => {
  assert.equal(currentMetric([entry('2026-10-10T07:00:00Z', 82.55)], 'weightKg'), 82.6);
});

const withMuscle = (iso: string, weightKg: number, muscle: number | null) => ({
  ...entry(iso, weightKg),
  muscle,
});

test('currentMetric: мышцы в килограммах считаются от веса того же замера', () => {
  const entries = [
    withMuscle('2026-10-10T07:00:00Z', 80.0, 45.0), // 36,0 кг
    withMuscle('2026-10-09T07:00:00Z', 90.0, 40.0), // 36,0 кг
    withMuscle('2026-10-08T07:00:00Z', 100.0, 39.0), // 39,0 кг
  ];
  assert.equal(currentMetric(entries, 'muscle', 'kg'), 36);
  // проценты — прежнее поведение, и оно же по умолчанию
  assert.equal(currentMetric(entries, 'muscle', 'percent'), 45);
  assert.equal(currentMetric(entries, 'muscle'), 45);
});

test('currentMetric: единица мышц не трогает остальные показатели', () => {
  const entries = [withMuscle('2026-10-10T07:00:00Z', 80.0, 45.0)];
  assert.equal(currentMetric(entries, 'weightKg', 'kg'), 80);
  assert.equal(currentMetric([withMuscle('2026-10-10T07:00:00Z', 80.0, null)], 'muscle', 'kg'), null);
});

test('мышцы: килограммы переживают хранение в процентах без потери десятых', () => {
  // 0,1 кг — шаг ввода; проверяем веса, на которых один знак после запятой в процентах врёт
  for (const weightKg of [48.3, 67.9, 84.6, 99.9, 123.4]) {
    for (let kg = 20; kg < weightKg * 0.6; kg += 0.7) {
      const entered = Math.round(kg * 10) / 10;
      assert.equal(muscleKgOf(weightKg, musclePctOf(weightKg, entered)), entered, `${entered} кг при весе ${weightKg}`);
    }
  }
});

test('progressFor: без замеров по показателю «сейчас» стоит на старте', () => {
  const goal = {
    goalType: 'lose_fat',
    targetValue: 18,
    startWeightKg: null,
    startBodyFat: 24,
    startMuscle: null,
    muscleUnit: 'percent',
  } as ParticipantGoal;
  // весы прислали вес, но без % жира
  const entries = [{ measuredAt: new Date('2026-09-20T08:00:00Z'), weightKg: 80, bodyFat: null }] as WeightEntry[];
  const p = progressFor(goal, entries);
  assert.equal(p.current, 24);
  assert.equal(p.percent, 0);
});

const startGoal = {
  goalType: 'lose_fat',
  targetValue: 20,
  muscleUnit: 'percent',
  startWeightKg: 83.5,
  startBodyFat: 24.7,
  startMuscle: null,
};

/** Старт 28.09 в полночь по Москве: пробная неделя — 21–27.09. */
const START_AT = at('2026-09-27T21:00:00Z');

test('goalStartsFrom: старт — среднее по всем замерам пробной недели, а не по трём последним', () => {
  // Рома из «Storm Fat fight 3.0»: худел всю неделю, по трём последним вышло бы 70.9 и 20.3
  const entries = [
    entry('2026-09-14T07:00:00Z', 73.0, 21.5), // до пробной недели — не в счёт
    entry('2026-09-21T07:00:00Z', 72.2, 21.0),
    entry('2026-09-22T07:00:00Z', 72.0, 20.8),
    entry('2026-09-23T20:44:00Z', 71.6, 20.6),
    entry('2026-09-24T05:38:00Z', 70.4, 20.0),
    entry('2026-09-25T08:20:00Z', 70.6, 20.4),
    entry('2026-09-28T06:00:00Z', 69.9, 19.9), // уже после старта — не в счёт
  ];
  assert.deepEqual(goalStartsFrom(startGoal, entries, START_AT), [
    { metric: 'weightKg', field: 'startWeightKg', before: 83.5, after: 71.4 },
    { metric: 'bodyFat', field: 'startBodyFat', before: 24.7, after: 20.6 },
  ]);
});

test('startMetric: жир усредняется только по замерам, где он есть', () => {
  // Павел: в один день весы прислали вес без жира
  const entries = [entry('2026-09-22T08:08:00Z', 112), entry('2026-09-23T08:26:00Z', 111.6, 32.7)];
  assert.equal(startMetric(entries, 'weightKg', 'percent', START_AT), 111.8);
  assert.equal(startMetric(entries, 'bodyFat', 'percent', START_AT), 32.7);
});

test('startMetric: без замеров за пробную неделю — последнее известное значение', () => {
  const entries = [entry('2026-09-10T06:00:00Z', 80, 25), entry('2026-09-12T06:00:00Z', 79, 24)];
  assert.equal(startMetric(entries, 'weightKg', 'percent', START_AT), 79);
  assert.equal(startMetric([], 'weightKg', 'percent', START_AT), null);
});

test('goalStartsFrom: без замеров старт не трогаем', () => {
  assert.deepEqual(goalStartsFrom(startGoal, [], START_AT), []);
});

test('goalStartsFrom: цель, достигнутая от нового старта, не пересчитывается', () => {
  // сушился до 20%, а за пробную неделю весы показали 19.8 — прогресс сломался бы
  const entries = [entry('2026-09-25T06:00:00Z', 80, 19.8)];
  assert.equal(goalStartsFrom(startGoal, entries, START_AT), null);
  // у набора мышц направление обратное
  const gain = { ...startGoal, goalType: 'gain_muscle', targetValue: 40, startMuscle: 38 };
  const muscle = [{ measuredAt: at('2026-09-25T06:00:00Z'), weightKg: 80, bodyFat: null, muscle: 41 }];
  assert.equal(goalStartsFrom(gain, muscle, START_AT), null);
});
