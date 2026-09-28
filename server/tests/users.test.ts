import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CUSTOM_NAME_MAX, displayName, normalizeCustomName } from '../src/services/users';

const tg = { firstName: 'Олег', lastName: 'Федин', username: 'oleg' };

test('displayName: своё имя перебивает Telegram, без него — имя из Telegram', () => {
  assert.equal(displayName({ ...tg, customName: 'Капитан Планка' }), 'Капитан Планка');
  assert.equal(displayName({ ...tg, customName: null }), 'Олег Федин');
  assert.equal(displayName({ firstName: null, lastName: null, username: 'oleg' }), '@oleg');
});

test('normalizeCustomName: пустое и из одних пробелов — сброс к Telegram', () => {
  assert.equal(normalizeCustomName(''), null);
  assert.equal(normalizeCustomName('   \n\t '), null);
  assert.equal(normalizeCustomName('​‮'), null);
});

test('normalizeCustomName: пробелы схлопываются, управляющие символы вырезаются', () => {
  assert.equal(normalizeCustomName('  Олег \n  Ф. '), 'Олег Ф.');
  assert.equal(normalizeCustomName('Ол‮ег\u0007'), 'Олег');
});

test('normalizeCustomName: обрезка по символам не рвёт эмодзи, ZWJ-склейка цела', () => {
  const long = '💪'.repeat(CUSTOM_NAME_MAX + 5);
  assert.equal(Array.from(normalizeCustomName(long)!).length, CUSTOM_NAME_MAX);
  assert.equal(normalizeCustomName('👨‍👩‍👧 Семья'), '👨‍👩‍👧 Семья');
});
