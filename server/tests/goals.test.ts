import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentMetric, goalProgress } from '../src/services/fitness/goals';
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

test('currentMetric: среднее по трём последним замерам', () => {
  const entries = [
    entry('2026-10-10T07:00:00Z', 84.0),
    entry('2026-10-09T07:00:00Z', 85.0),
    entry('2026-10-08T07:00:00Z', 86.0),
    entry('2026-10-07T07:00:00Z', 99.0), // четвёртый в выборку не идёт
  ];
  assert.equal(currentMetric(entries, 'weightKg'), 85);
});

test('currentMetric: порядок входа не важен', () => {
  const entries = [
    entry('2026-10-08T07:00:00Z', 86.0),
    entry('2026-10-10T07:00:00Z', 84.0),
    entry('2026-10-09T07:00:00Z', 85.0),
  ];
  assert.equal(currentMetric(entries, 'weightKg'), 85);
});

test('currentMetric: замеры старше недели от последнего не усредняются', () => {
  const entries = [
    entry('2026-10-20T07:00:00Z', 82.0),
    entry('2026-10-05T07:00:00Z', 90.0), // 15 дней до последнего
  ];
  assert.equal(currentMetric(entries, 'weightKg'), 82);
});

test('currentMetric: окно считается от последнего замера, а не от сегодня', () => {
  // человек не взвешивался год — прогресс остаётся на последней известной точке
  const entries = [entry('2025-01-02T07:00:00Z', 88.0), entry('2025-01-01T07:00:00Z', 89.0)];
  assert.equal(currentMetric(entries, 'weightKg'), 88.5);
});

test('currentMetric: пропуски показателя пропускаются', () => {
  const entries = [
    entry('2026-10-10T07:00:00Z', 84.0, null), // весы не измерили жир
    entry('2026-10-09T07:00:00Z', 85.0, 21.0),
    entry('2026-10-08T07:00:00Z', 86.0, 22.0),
  ];
  assert.equal(currentMetric(entries, 'bodyFat'), 21.5);
  assert.equal(currentMetric(entries, 'muscle'), null);
  assert.equal(currentMetric([], 'weightKg'), null);
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
  assert.equal(currentMetric(entries, 'muscle', 'kg'), 37);
  // проценты — прежнее поведение, и оно же по умолчанию
  assert.equal(currentMetric(entries, 'muscle', 'percent'), 41.3);
  assert.equal(currentMetric(entries, 'muscle'), 41.3);
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
