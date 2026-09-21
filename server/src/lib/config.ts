import dotenv from 'dotenv';

dotenv.config();

function parseAdminIds(raw: string | undefined): bigint[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      try {
        return BigInt(s);
      } catch {
        return null;
      }
    })
    .filter((v): v is bigint => v !== null);
}

export const config = {
  botToken: process.env.BOT_TOKEN ?? '',
  /** Публичный HTTPS-URL Web App (например https://challenge.example.com) */
  webAppUrl: process.env.WEBAPP_URL ?? '',
  publicDomain: process.env.PUBLIC_DOMAIN ?? '',
  databaseUrl: process.env.DATABASE_URL ?? '',
  /** ID Telegram-пользователей, которым выдаётся флаг админа при первом входе */
  adminTelegramIds: parseAdminIds(process.env.ADMIN_TELEGRAM_IDS),
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  /** secret_token для защиты webhook от Telegram */
  webhookSecret: process.env.WEBHOOK_SECRET ?? '',
  /** Полный URL webhook (если не задан — выводится из PUBLIC_DOMAIN) */
  webhookUrl: process.env.WEBHOOK_URL ?? '',
  /** true → webhook (прод за HTTPS), false → long polling (локальная разработка) */
  useWebhook: (process.env.USE_WEBHOOK ?? 'false').toLowerCase() === 'true',
  defaultTimezone: process.env.TZ ?? 'Europe/Moscow',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  /** Короткое имя Mini App из BotFather (/newapp). Если пусто — используется ?startapp у Main Mini App. */
  miniAppShortName: process.env.MINIAPP_SHORT_NAME ?? '',
  /**
   * WHOOP: приложение с developer.whoop.com. Без ключей интеграция выключена целиком —
   * как бот без BOT_TOKEN. apiBase подменяется в smoke на локальную заглушку.
   */
  whoop: {
    clientId: process.env.WHOOP_CLIENT_ID ?? '',
    clientSecret: process.env.WHOOP_CLIENT_SECRET ?? '',
    apiBase: (process.env.WHOOP_API_BASE ?? 'https://api.prod.whoop.com').replace(/\/+$/, ''),
  },
  /** Ключ шифрования OAuth-токенов в базе. Любая длинная случайная строка. */
  tokenEncKey: process.env.TOKEN_ENC_KEY ?? '',
};

/** Публичный адрес приложения без хвостового слэша; пусто, если домен не настроен. */
export function publicBaseUrl(): string {
  const base = config.webAppUrl || (config.publicDomain ? `https://${config.publicDomain}` : '');
  return base.replace(/\/+$/, '');
}

export function assertBotToken(): void {
  if (!config.botToken) {
    throw new Error('BOT_TOKEN не задан. Укажите его в .env');
  }
}
