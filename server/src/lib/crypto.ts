import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from './config';

/**
 * Ключ нужной длины из произвольной строки. Контекст разводит назначения: ключ шифрования
 * токенов и ключ подписи state не должны совпадать, даже если секрет один.
 */
function deriveKey(context: string, secret: string): Buffer {
  return createHash('sha256').update(`${context}:${secret}`).digest();
}

function requireSecret(secret: string): string {
  if (!secret) throw new Error('TOKEN_ENC_KEY не задан');
  return secret;
}

/** Шифрует секрет для хранения в базе: AES-256-GCM, формат `v1.iv.tag.data` в base64url. */
export function encryptSecret(plain: string, secret = config.tokenEncKey): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey('enc', requireSecret(secret)), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), data]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

/** Расшифровывает; на подменённых или битых данных бросает исключение (GCM проверяет целостность). */
export function decryptSecret(enc: string, secret = config.tokenEncKey): string {
  const [version, iv, tag, data] = enc.split('.');
  if (version !== 'v1' || !iv || !tag || data === undefined) throw new Error('bad ciphertext');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveKey('enc', requireSecret(secret)),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

/** Сколько живёт state: пользователь успевает залогиниться у провайдера, а перехваченная ссылка быстро тухнет. */
const STATE_TTL_MS = 10 * 60_000;

function stateSignature(payload: string, secret: string): string {
  return createHmac('sha256', deriveKey('state', secret)).update(payload).digest('base64url').slice(0, 22);
}

/**
 * OAuth state: кто начал подключение и до какого момента ссылка годна. Подписан, поэтому
 * в callback ему можно верить без хранения на сервере — callback приходит из браузера,
 * без авторизации Telegram, и state там единственное, что связывает запрос с пользователем.
 */
export function signState(userId: number, now = Date.now(), secret = config.tokenEncKey): string {
  const payload = [userId.toString(36), (now + STATE_TTL_MS).toString(36), randomBytes(6).toString('base64url')].join('.');
  return `${payload}.${stateSignature(payload, requireSecret(secret))}`;
}

/** Возвращает id пользователя либо null, если state подделан или просрочен. */
export function verifyState(state: string, now = Date.now(), secret = config.tokenEncKey): number | null {
  const parts = state.split('.');
  if (parts.length !== 4 || !secret) return null;
  const [uid, exp, nonce, sig] = parts as [string, string, string, string];

  const expected = Buffer.from(stateSignature(`${uid}.${exp}.${nonce}`, secret));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  if (parseInt(exp, 36) < now) return null;
  const userId = parseInt(uid, 36);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

/**
 * Подпись вебхука WHOOP: base64(HMAC-SHA256(timestamp + сырое тело, client secret)).
 * Сверяется по сырым байтам тела — после JSON.parse и обратно подпись уже не сойдётся.
 */
export function verifyWhoopSignature(
  rawBody: Buffer,
  timestamp: string,
  signature: string,
  clientSecret: string,
): boolean {
  if (!timestamp || !signature || !clientSecret) return false;
  const expected = createHmac('sha256', clientSecret)
    .update(Buffer.concat([Buffer.from(timestamp, 'utf8'), rawBody]))
    .digest();
  const actual = Buffer.from(signature, 'base64');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
