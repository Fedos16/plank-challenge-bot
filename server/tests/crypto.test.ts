import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { decryptSecret, encryptSecret, signState, verifyState, verifyWhoopSignature } from '../src/lib/crypto';

const KEY = 'test-encryption-key';

test('encryptSecret: шифрует обратимо и каждый раз по-разному', () => {
  const a = encryptSecret('refresh-token-value', KEY);
  const b = encryptSecret('refresh-token-value', KEY);
  assert.notEqual(a, b); // случайный IV
  assert.ok(!a.includes('refresh-token-value'));
  assert.equal(decryptSecret(a, KEY), 'refresh-token-value');
  assert.equal(decryptSecret(b, KEY), 'refresh-token-value');
});

test('decryptSecret: чужой ключ и подмена данных не проходят', () => {
  const enc = encryptSecret('secret', KEY);
  assert.throws(() => decryptSecret(enc, 'another-key'));
  const parts = enc.split('.');
  parts[3] = Buffer.from('подмена').toString('base64url');
  assert.throws(() => decryptSecret(parts.join('.'), KEY));
  assert.throws(() => decryptSecret('мусор', KEY));
});

test('encryptSecret: без ключа не работает — токены нельзя хранить открыто', () => {
  assert.throws(() => encryptSecret('secret', ''));
});

test('state: подписанный state возвращает пользователя', () => {
  const now = Date.now();
  const state = signState(42, now, KEY);
  assert.ok(state.length >= 8, 'WHOOP требует state не короче 8 символов');
  assert.equal(verifyState(state, now + 60_000, KEY), 42);
});

test('state: просроченный, подделанный и чужой не проходят', () => {
  const now = Date.now();
  const state = signState(42, now, KEY);
  assert.equal(verifyState(state, now + 11 * 60_000, KEY), null); // живёт 10 минут
  assert.equal(verifyState(state, now, 'another-key'), null);

  // попытка подключить браслет к чужому аккаунту: меняем id, подпись остаётся старой
  const [, exp, nonce, sig] = state.split('.');
  assert.equal(verifyState(`${(43).toString(36)}.${exp}.${nonce}.${sig}`, now, KEY), null);
  assert.equal(verifyState('', now, KEY), null);
  assert.equal(verifyState('a.b.c', now, KEY), null);
});

test('state: два подключения одного человека дают разные state', () => {
  const now = Date.now();
  assert.notEqual(signState(42, now, KEY), signState(42, now, KEY));
});

test('verifyWhoopSignature: base64(HMAC-SHA256(timestamp + тело, client secret))', () => {
  const secret = 'whoop-client-secret';
  const timestamp = '1727000000000';
  const body = Buffer.from('{"user_id":9012,"id":"ecfc6a15","type":"workout.updated","trace_id":"t-1"}');
  const signature = createHmac('sha256', secret).update(timestamp).update(body).digest('base64');

  assert.equal(verifyWhoopSignature(body, timestamp, signature, secret), true);
  assert.equal(verifyWhoopSignature(Buffer.from(body.toString().replace('9012', '9013')), timestamp, signature, secret), false);
  assert.equal(verifyWhoopSignature(body, '1727000000001', signature, secret), false);
  assert.equal(verifyWhoopSignature(body, timestamp, signature, 'wrong-secret'), false);
  assert.equal(verifyWhoopSignature(body, timestamp, '', secret), false);
  assert.equal(verifyWhoopSignature(body, timestamp, 'не-base64!!', secret), false);
});
