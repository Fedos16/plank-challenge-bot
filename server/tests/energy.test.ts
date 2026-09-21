import { test } from 'node:test';
import assert from 'node:assert/strict';
import { energyBaseline, mifflinStJeor } from '../src/services/fitness/energy';
import { normalizeFoodName } from '../src/services/food';

test('mifflinStJeor: 10·вес + 6,25·рост − 5·возраст, +5 мужчинам, −161 женщинам', () => {
  assert.equal(mifflinStJeor('male', 85, 180, 36), 1800);
  assert.equal(mifflinStJeor('female', 62, 168, 30), 1359);
  // у мужчины и женщины с одинаковыми данными разница ровно 166 ккал
  assert.equal(mifflinStJeor('male', 70, 175, 40) - mifflinStJeor('female', 70, 175, 40), 166);
});

test('energyBaseline: базовый обмен умножается на бытовую активность', () => {
  const facts = { sex: 'male' as const, weightKg: 85, heightCm: 180, birthYear: 1990, activityFactor: 1.2 };
  assert.deepEqual(energyBaseline(facts, 2026), { bmr: 1800, baseline: 2160, missing: [] });
  assert.equal(energyBaseline({ ...facts, activityFactor: 1.375 }, 2026).baseline, 2475);
});

test('energyBaseline: с годами базовый обмен падает', () => {
  const facts = { sex: 'male' as const, weightKg: 85, heightCm: 180, birthYear: 1990, activityFactor: 1.2 };
  assert.equal(energyBaseline(facts, 2036).bmr, 1750);
});

test('energyBaseline: без данных анкеты расчёта нет, зато ясно, чего не хватает', () => {
  const empty = { sex: null, weightKg: null, heightCm: null, birthYear: null, activityFactor: 1.2 };
  assert.deepEqual(energyBaseline(empty, 2026), {
    bmr: null,
    baseline: null,
    missing: ['sex', 'weight', 'height', 'birthYear'],
  });
  const noWeight = { sex: 'female' as const, weightKg: null, heightCm: 168, birthYear: 1996, activityFactor: 1.2 };
  assert.deepEqual(energyBaseline(noWeight, 2026).missing, ['weight']);
});

test('normalizeFoodName: регистр, «ё» и лишние пробелы', () => {
  assert.equal(normalizeFoodName('  Сёмга   слабосолёная '), 'семга слабосоленая');
  assert.equal(normalizeFoodName('ЙОГУРТ Греческий 2%'), 'йогурт греческий 2%');
});
