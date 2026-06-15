import { Bot } from 'grammy';
import { config } from '../lib/config';

/**
 * Бот создаётся только если задан BOT_TOKEN.
 * Иначе null — сервер работает в режиме «только API + Web App» (удобно для локальной разработки).
 */
export const bot = config.botToken ? new Bot(config.botToken) : null;
