import '../lib/serialize';
import path from 'node:path';
import fs from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { userRoutes } from './userRoutes';
import { adminRoutes } from './adminRoutes';

export function resolveWebDist(): string {
  return process.env.WEB_DIST ?? path.resolve(__dirname, '../../../web/dist');
}

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: true });

  // Допускаем пустое тело при Content-Type: application/json (POST без полей, напр. /sick)
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const str = (body as string).trim();
    if (str.length === 0) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(str));
    } catch (err) {
      (err as { statusCode?: number }).statusCode = 400;
      done(err as Error);
    }
  });

  app.get('/health', async () => ({ ok: true }));

  await app.register(userRoutes, { prefix: '/api' });
  await app.register(adminRoutes, { prefix: '/api/admin' });

  const webDist = resolveWebDist();
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/' });
    // SPA-фолбэк: всё, что не /api, отдаём index.html
    app.setNotFoundHandler((req, reply) => {
      const url = req.raw.url ?? '';
      if (url.startsWith('/api')) {
        reply.code(404).send({ error: 'not_found' });
        return;
      }
      reply.sendFile('index.html');
    });
  } else {
    console.warn(`[server] Каталог web/dist не найден (${webDist}). Фронт не раздаётся.`);
  }

  return app;
}
