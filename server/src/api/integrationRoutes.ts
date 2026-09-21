import type { FastifyInstance } from 'fastify';
import { authPreHandler } from './auth';
import { prisma } from '../lib/prisma';
import { WHOOP, buildWhoopAuthUrl, disconnectWhoop, isWhoopEnabled, toIntegrationDTO } from '../services/whoop';

/** Подключения источников тренировок. Личные: принадлежат человеку, а не челленджу. */
export async function integrationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authPreHandler);

  app.get('/integrations', async (req) => {
    const rows = await prisma.integration.findMany({ where: { userId: req.ctx!.user.id } });
    return {
      // фронт не показывает то, что на сервере не настроено
      available: { whoop: isWhoopEnabled() },
      connected: rows.map(toIntegrationDTO),
    };
  });

  // Ссылка на страницу согласия WHOOP. Открывается во внешнем браузере: OAuth внутри WebView
  // Telegram не вернёт пользователя обратно в приложение.
  app.post('/integrations/whoop/connect', async (req, reply) => {
    if (!isWhoopEnabled()) return reply.code(400).send({ error: 'whoop_disabled' });
    return { url: buildWhoopAuthUrl(req.ctx!.user.id) };
  });

  app.delete('/integrations/whoop', async (req, reply) => {
    const ok = await disconnectWhoop(req.ctx!.user.id);
    if (!ok) return reply.code(404).send({ error: 'not_found' });
    return { ok: true, provider: WHOOP };
  });
}
