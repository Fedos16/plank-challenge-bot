import type { FastifyInstance, FastifyRequest } from 'fastify';
import { parseScaleWebhook } from '../services/openscale';
import {
  deleteMeasurement,
  findUserByScaleToken,
  notifyNewMeasurement,
  saveMeasurements,
} from '../services/weight';

/**
 * Токен из запроса. openScale sync умеет слать произвольный заголовок Authorization,
 * поэтому принимаем и «Bearer xxx», и голый токен; query-параметр — на случай клиента,
 * который заголовки задавать не умеет.
 */
function extractToken(req: FastifyRequest): string {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.trim()) {
    return auth.replace(/^Bearer\s+/i, '').trim();
  }
  const header = req.headers['x-scale-token'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  const query = (req.query as { token?: string } | undefined)?.token;
  return typeof query === 'string' ? query.trim() : '';
}

/**
 * Приём данных с умных весов. Авторизация — личный токен пользователя, а не Telegram:
 * запрос идёт с телефона, а не из Web App, поэтому роуты вынесены из userRoutes.
 *
 * Токен привязан к телефону. Если в openScale заведено несколько людей, взвешивания
 * раскладываются по профилям, которые владелец сопоставляет участникам в кабинете.
 */
export async function ingestRoutes(app: FastifyInstance): Promise<void> {
  app.post('/openscale', async (req, reply) => {
    const owner = await findUserByScaleToken(extractToken(req));
    if (!owner) return reply.code(401).send({ error: 'unauthorized' });

    const event = parseScaleWebhook(req.body);
    if (!event) return reply.code(400).send({ error: 'bad_payload' });

    switch (event.kind) {
      // Кнопка «Проверить соединение» в приложении — отвечаем 200, ничего не пишем.
      case 'test':
        return { ok: true };

      case 'upsert': {
        const { created, updated } = await saveMeasurements(owner.id, event.measurements);
        console.log(
          `[scale] телефон=${owner.id} новых=${created.length} обновлено=${updated.length}`,
        );
        // О пачке молчим: так приходит первая выгрузка всей истории из openScale.
        const single = created.length === 1 && event.measurements.length === 1;
        if (single) await notifyNewMeasurement(created[0]!);
        return { ok: true, created: created.length, updated: updated.length };
      }

      case 'delete': {
        const deleted = await deleteMeasurement(owner.id, event.scaleUserId, event.measuredAt);
        return { ok: true, deleted };
      }

      // «Очистить всё» в openScale не должно стирать историю здесь — это не отменяемо,
      // а приложение шлёт clear и при смене пользователя на телефоне.
      case 'clear':
        console.warn(`[scale] телефон=${owner.id} прислал clear — историю не трогаем`);
        return { ok: true, ignored: 'clear' };

      default:
        return { ok: true, ignored: event.event };
    }
  });
}
