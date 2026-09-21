import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapOffProduct, takeRateSlot } from '../src/services/openFoodFacts';

const SAMPLE = {
  code: '4607025392408',
  product_name: 'Yogurt',
  product_name_ru: 'Йогурт  питьевой   клубника',
  brands: 'Чудо, Вимм-Билль-Данн',
  serving_quantity: '270',
  nutriments: { 'energy-kcal_100g': 84, proteins_100g: 2.8, fat_100g: 2.4, carbohydrates_100g: 12.7 },
};

test('mapOffProduct: русское название важнее, бренд — первый из списка', () => {
  assert.deepEqual(mapOffProduct(SAMPLE), {
    code: '4607025392408',
    name: 'Йогурт питьевой клубника',
    brand: 'Чудо',
    kcal100: 84,
    protein100: 2.8,
    fat100: 2.4,
    carbs100: 12.7,
    servingGrams: 270,
  });
});

test('mapOffProduct: энергия только в килоджоулях пересчитывается', () => {
  const p = mapOffProduct({ ...SAMPLE, nutriments: { energy_100g: 1464.4 } })!;
  assert.equal(p.kcal100, 350);
  assert.deepEqual([p.protein100, p.fat100, p.carbs100], [null, null, null]);
});

test('mapOffProduct: без русского названия берётся общее', () => {
  assert.equal(mapOffProduct({ ...SAMPLE, product_name_ru: '' })!.name, 'Yogurt');
});

test('mapOffProduct: записи без названия, калорий или штрихкода бесполезны для дневника', () => {
  assert.equal(mapOffProduct({ ...SAMPLE, product_name: '', product_name_ru: undefined }), null);
  assert.equal(mapOffProduct({ ...SAMPLE, nutriments: {} }), null);
  assert.equal(mapOffProduct({ ...SAMPLE, nutriments: undefined }), null);
  assert.equal(mapOffProduct({ ...SAMPLE, code: '' }), null);
  assert.equal(mapOffProduct(null), null);
});

test('mapOffProduct: мусорные значения из пользовательской базы отсекаются', () => {
  // 2500 ккал на 100 г не бывает: кто-то ввёл килоджоули в поле килокалорий
  assert.equal(mapOffProduct({ ...SAMPLE, nutriments: { 'energy-kcal_100g': 2500 } }), null);
  const p = mapOffProduct({ ...SAMPLE, serving_quantity: 'abc', nutriments: { 'energy-kcal_100g': 84, fat_100g: 250 } })!;
  assert.deepEqual([p.fat100, p.servingGrams], [null, null]);
});

test('takeRateSlot: не больше лимита запросов за скользящую минуту', () => {
  const calls: number[] = [];
  const t0 = 1_000_000;
  for (let i = 0; i < 8; i++) assert.equal(takeRateSlot(calls, t0 + i * 1000), true);
  assert.equal(takeRateSlot(calls, t0 + 9000), false);
  assert.equal(takeRateSlot(calls, t0 + 59_999), false);
  // первый запрос вышел из минутного окна — слот освободился
  assert.equal(takeRateSlot(calls, t0 + 60_000), true);
  assert.equal(takeRateSlot(calls, t0 + 60_500), false);
});
