import crypto from 'node:crypto';

export interface TelegramWebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
}

export interface ValidatedInitData {
  user: TelegramWebAppUser;
  authDate: number;
  raw: Record<string, string>;
}

/**
 * Валидация Telegram Web App initData по алгоритму из документации:
 * data_check_string из отсортированных key=value (кроме hash), соединённых \n;
 * secret_key = HMAC_SHA256(bot_token, "WebAppData");
 * сравниваем hash == HMAC_SHA256(data_check_string, secret_key).
 *
 * @param initData строка query (window.Telegram.WebApp.initData)
 * @param botToken токен бота
 * @param maxAgeSec максимальный возраст auth_date (по умолчанию 24 часа); 0 = не проверять
 */
export function validateInitData(
  initData: string,
  botToken: string,
  maxAgeSec = 86400,
): ValidatedInitData | null {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;

  const entries: [string, string][] = [];
  params.forEach((value, key) => {
    if (key !== 'hash') entries.push([key, value]);
  });
  entries.sort((a, b) => a[0].localeCompare(b[0]));

  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  // защита от тайминг-атак
  const a = Buffer.from(computedHash, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  const authDate = Number(params.get('auth_date') ?? 0);
  if (maxAgeSec > 0) {
    const now = Math.floor(Date.now() / 1000);
    if (!authDate || now - authDate > maxAgeSec) {
      return null;
    }
  }

  const rawUser = params.get('user');
  if (!rawUser) return null;

  let user: TelegramWebAppUser;
  try {
    user = JSON.parse(rawUser) as TelegramWebAppUser;
  } catch {
    return null;
  }
  if (!user?.id) return null;

  const raw: Record<string, string> = {};
  params.forEach((value, key) => {
    raw[key] = value;
  });

  return { user, authDate, raw };
}
