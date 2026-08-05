import { Agent } from 'https';
import { Bot } from 'grammy';
import { config } from '../lib/config';

/**
 * TELEGRAM_IP_FAMILY=6 заставляет ходить к api.telegram.org только по IPv6.
 * Нужно там, где до Telegram нет IPv4-маршрута. Глобально порядок резолва менять нельзя:
 * это сломает подключение к другим сервисам (например, Postgres слушает только IPv4).
 */
const ipFamily = Number(process.env.TELEGRAM_IP_FAMILY) || 0;
const client =
  ipFamily === 4 || ipFamily === 6
    ? { baseFetchConfig: { agent: new Agent({ family: ipFamily, keepAlive: true }) } }
    : undefined;

/**
 * Бот создаётся только если задан BOT_TOKEN.
 * Иначе null — сервер работает в режиме «только API + Web App» (удобно для локальной разработки).
 */
export const bot = config.botToken ? new Bot(config.botToken, { client }) : null;
