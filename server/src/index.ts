import './lib/serialize';
import { webhookCallback } from 'grammy';
import { config } from './lib/config';
import { bot } from './bot/bot';
import { registerHandlers } from './bot/handlers';
import { buildServer } from './api/server';
import { startScheduler } from './jobs/scheduler';
import { prisma } from './lib/prisma';

const WEBHOOK_PATH = '/webhook';

async function setBotCommands(): Promise<void> {
  if (!bot) return;
  await bot.api.setMyCommands([
    { command: 'start', description: 'Открыть приложение и участвовать' },
    { command: 'sick', description: 'Сообщить о болезни на сегодня' },
    { command: 'app', description: 'Открыть приложение челленджа' },
    { command: 'rules', description: 'Правила челленджа' },
    { command: 'id', description: 'Узнать свой Telegram ID' },
  ]);
}

/** Кнопка-меню бота (слева от поля ввода) открывает Web App. Требует https-URL. */
async function setMenuButton(): Promise<void> {
  if (!bot) return;
  if (config.webAppUrl.startsWith('https://')) {
    await bot.api.setChatMenuButton({
      menu_button: { type: 'web_app', text: 'Открыть', web_app: { url: config.webAppUrl } },
    });
    console.log(`[bot] Menu-кнопка открывает Web App: ${config.webAppUrl}`);
  } else {
    // сбрасываем на обычное меню команд, если https-URL не задан
    await bot.api.setChatMenuButton({ menu_button: { type: 'commands' } });
    console.warn('[bot] WEBAPP_URL не https — menu-кнопка не привязана к Web App.');
  }
}

async function main(): Promise<void> {
  const app = await buildServer();

  if (bot && config.useWebhook) {
    // Режим webhook: Telegram шлёт апдейты на наш HTTPS-эндпоинт
    app.post(
      WEBHOOK_PATH,
      webhookCallback(bot, 'fastify', {
        secretToken: config.webhookSecret || undefined,
      }),
    );
  }

  await app.listen({ host: config.host, port: config.port });
  console.log(`[server] HTTP слушает на ${config.host}:${config.port}`);

  if (bot) {
    registerHandlers();
    await bot.init();

    if (config.useWebhook) {
      const url =
        config.webhookUrl ||
        (config.publicDomain ? `https://${config.publicDomain}${WEBHOOK_PATH}` : '');
      if (!url) {
        console.error('[bot] USE_WEBHOOK=true, но не задан WEBHOOK_URL/PUBLIC_DOMAIN');
      } else {
        await bot.api.setWebhook(url, {
          secret_token: config.webhookSecret || undefined,
          drop_pending_updates: false,
        });
        console.log(`[bot] Webhook установлен: ${url}`);
      }
    } else {
      // Локальная разработка: long polling
      await bot.api.deleteWebhook({ drop_pending_updates: false });
      bot.start({ onStart: (me) => console.log(`[bot] Long polling запущен: @${me.username}`) });
    }

    await setBotCommands();
    await setMenuButton();
  } else {
    console.warn('[bot] BOT_TOKEN не задан — бот выключен. Работает только API + Web App.');
  }

  startScheduler();
}

async function shutdown(signal: string): Promise<void> {
  console.log(`\n[server] Получен ${signal}, останавливаюсь...`);
  try {
    if (bot && !config.useWebhook) await bot.stop();
  } catch {
    /* ignore */
  }
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

main().catch((err) => {
  console.error('[server] Фатальная ошибка запуска:', err);
  process.exit(1);
});
