import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCompositionText } from '../src/services/composition';

test('состав текстом: два числа — жир и мышцы в единице по умолчанию', () => {
  assert.deepEqual(parseCompositionText('24,4 58,7', 'kg'), {
    bodyFat: 24.4,
    muscle: { value: 58.7, unit: 'kg' },
  });
  assert.deepEqual(parseCompositionText('24.4 71.7', 'percent'), {
    bodyFat: 24.4,
    muscle: { value: 71.7, unit: 'percent' },
  });
});

test('состав текстом: третье число — вода, разделители любые', () => {
  assert.deepEqual(parseCompositionText('24,4; 58,7 / 51,9', 'kg'), {
    bodyFat: 24.4,
    muscle: { value: 58.7, unit: 'kg' },
    water: 51.9,
  });
});

test('состав текстом: одно число — только жир', () => {
  assert.deepEqual(parseCompositionText(' 24,4% ', 'kg'), { bodyFat: 24.4 });
});

test('состав текстом: подписи задают поле, порядок не важен', () => {
  assert.deepEqual(parseCompositionText('Мышцы 58,7 кг, жир 24,4%', 'percent'), {
    muscle: { value: 58.7, unit: 'kg' },
    bodyFat: 24.4,
  });
  assert.deepEqual(parseCompositionText('вода: 51,9', 'kg'), { water: 51.9 });
});

test('состав текстом: явная единица мышц сильнее выбранной', () => {
  assert.deepEqual(parseCompositionText('24,4 71,7%', 'kg'), {
    bodyFat: 24.4,
    muscle: { value: 71.7, unit: 'percent' },
  });
});

test('состав текстом: обычная переписка с цифрами — не замер', () => {
  assert.equal(parseCompositionText('приду в 7', 'kg'), null);
  assert.equal(parseCompositionText('спасибо!', 'kg'), null);
  assert.equal(parseCompositionText('жир', 'kg'), null);
  assert.equal(parseCompositionText('', 'kg'), null);
});

test('состав текстом: лишние числа и жир в килограммах отбрасываются', () => {
  assert.equal(parseCompositionText('1 2 3 4', 'kg'), null);
  assert.equal(parseCompositionText('жир 20 жир 21', 'kg'), null);
  assert.equal(parseCompositionText('жир 20 кг', 'kg'), null);
});
