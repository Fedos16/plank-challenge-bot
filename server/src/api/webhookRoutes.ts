import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../lib/config';
import { verifyWhoopSignature } from '../lib/crypto';
import { parseWhoopWebhook } from '../services/parsers/whoop';
import { handleWhoopEvent, isWhoopEnabled } from '../services/whoop';

/**
 * Насколько метка времени вебхука может отличаться от «сейчас». WHOOP повторяет доставку около
 * часа, поэтому окно широкое. Повтор старого события безвреден: оно несёт только id, а саму
 * тренировку мы идемпотентно перечитываем из API.
 */
const MAX_SKEW_MS = 2 * 3600_000;

type RawRequest = FastifyRequest & { rawBody?: Buffer };

/** Вебхуки облачных провайдеров. Авторизация — подпись тела секретом приложения. */
export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  // Подпись считается по сырым байтам, а общий JSON-парсер приложения их не сохраняет. Подменяем
  // парсер только внутри этого плагина: в Fastify парсеры инкапсулированы, остальных роутов
  // замена не касается. Просто добавить второй нельзя — тип уже занят унаследованным.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    (req as RawRequest).rawBody = body as Buffer;
    try {
      const text = (body as Buffer).toString('utf8').trim();
      done(null, text ? JSON.parse(text) : {});
    } catch (err) {
      (err as { statusCode?: number }).statusCode = 400;
      done(err as Error);
    }
  });

  app.post('/whoop', async (req, reply) => {
    if (!isWhoopEnabled()) return reply.code(404).send({ error: 'not_found' });

    const timestamp = String(req.headers['x-whoop-signature-timestamp'] ?? '');
    const signature = String(req.headers['x-whoop-signature'] ?? '');
    const rawBody = (req as RawRequest).rawBody ?? Buffer.alloc(0);
    const fresh = Math.abs(Date.now() - Number(timestamp)) <= MAX_SKEW_MS;
    if (!fresh || !verifyWhoopSignature(rawBody, timestamp, signature, config.whoop.clientSecret)) {
      return reply.code(401).send({ error: 'bad_signature' });
    }

    const event = parseWhoopWebhook(req.body);
    if (!event) return reply.code(400).send({ error: 'bad_payload' });

    // WHOOP ждёт ответ за секунду, а обработка — это поход в его же API. Отвечаем сразу,
    // работаем после; если обработка упадёт, тренировку подберёт регулярная сверка.
    setImmediate(() => {
      handleWhoopEvent(event).catch((err) => console.error('[whoop] вебхук не обработан:', err));
    });
    return reply.code(204).send();
  });
}
