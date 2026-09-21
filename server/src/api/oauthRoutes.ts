import type { FastifyInstance, FastifyReply } from 'fastify';
import { verifyState } from '../lib/crypto';
import { miniAppLink } from '../lib/links';
import { escapeHtml } from '../services/report';
import { connectWhoop, type ConnectError } from '../services/whoop';

const ERROR_TEXT: Record<ConnectError | 'denied' | 'bad_state', string> = {
  denied: 'Вы не дали доступ к WHOOP. Если передумаете — начните подключение заново из приложения.',
  bad_state: 'Ссылка подключения устарела или повреждена. Откройте приложение и нажмите «Подключить WHOOP» ещё раз.',
  whoop_disabled: 'Интеграция с WHOOP на сервере не настроена.',
  whoop_exchange_failed: 'WHOOP не подтвердил подключение. Попробуйте ещё раз из приложения.',
  whoop_account_taken: 'Этот браслет WHOOP уже подключён к другому участнику.',
};

/** Имя бота для ссылки «вернуться в приложение»; без бота (локально) ссылки просто нет. */
async function backLink(): Promise<string | null> {
  try {
    const { bot } = await import('../bot/bot');
    return bot ? miniAppLink(bot.botInfo.username) : null;
  } catch {
    return null;
  }
}

async function page(reply: FastifyReply, ok: boolean, title: string, text: string) {
  const link = await backLink();
  const button = link ? `<a class="btn" href="${escapeHtml(link)}">Вернуться в приложение</a>` : '';
  reply
    .code(ok ? 200 : 400)
    .type('text/html; charset=utf-8')
    .send(`<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f7;color:#1a1a1a;
display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:20px}
.card{background:#fff;border-radius:16px;padding:28px 24px;max-width:380px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.ico{font-size:48px}h1{font-size:20px;margin:12px 0 8px}p{color:#6b6b70;line-height:1.5;margin:0 0 20px}
.btn{display:inline-block;background:#2f6feb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:12px;font-weight:600}
</style></head><body><div class="card"><div class="ico">${ok ? '✅' : '⚠️'}</div>
<h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p>${button}</div></body></html>`);
}

/**
 * Возврат из OAuth провайдера. Запрос приходит из обычного браузера, без initData Telegram:
 * кто начал подключение, знает только подписанный state.
 */
export async function oauthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/whoop/callback', async (req, reply) => {
    const q = (req.query ?? {}) as { code?: string; state?: string; error?: string };
    if (q.error) return page(reply, false, 'WHOOP не подключён', ERROR_TEXT.denied);

    const userId = typeof q.state === 'string' ? verifyState(q.state) : null;
    if (!userId || typeof q.code !== 'string' || !q.code) {
      return page(reply, false, 'WHOOP не подключён', ERROR_TEXT.bad_state);
    }

    const result = await connectWhoop(userId, q.code);
    if (typeof result === 'string') return page(reply, false, 'WHOOP не подключён', ERROR_TEXT[result]);
    return page(
      reply,
      true,
      'WHOOP подключён',
      'Тренировки будут приходить сами. История с начала челленджа подтянется в течение пары минут.',
    );
  });
}
