import type { FastifyInstance, FastifyRequest } from 'fastify';
import { parseScaleWebhook, type ScaleMeasurement } from '../services/openscale';
import {
  deleteMeasurement,
  findUserByScaleToken,
  notifyNewMeasurement,
  saveMeasurements,
} from '../services/weight';
import { findHubByToken, touchHub, type HubProvider } from '../services/integrations';
import { ingestWorkouts } from '../services/fitness/ingest';
import type { ExternalWorkout } from '../services/fitness/workouts';
import { parseHaePayload } from '../services/parsers/hae';
import { parseHaeBody } from '../services/parsers/haeBody';
import { parseHealthConnectPayload } from '../services/parsers/healthConnect';
import { parseHealthConnectBody } from '../services/parsers/healthConnectBody';

/**
 * Выгрузка с телефона бывает тяжёлой: Health Auto Export кладёт в тренировку пульс по секундам
 * и маршрут. Стандартного мегабайта Fastify не хватает — запрос отбивался бы с 413.
 */
const HUB_BODY_LIMIT = 25 * 1024 * 1024;

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
  for (const name of ['x-scale-token', 'x-ingest-token']) {
    const header = req.headers[name];
    if (typeof header === 'string' && header.trim()) return header.trim();
  }
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

  // ---- Тренировки и состав тела с телефонных хабов ----
  type HubParsers = [
    string,
    HubProvider,
    (body: unknown) => ExternalWorkout[] | null,
    (body: unknown) => ScaleMeasurement[],
  ];
  const hubs: HubParsers[] = [
    ['/health-auto-export', 'hae', parseHaePayload, parseHaeBody],
    ['/health-connect', 'health_connect', parseHealthConnectPayload, parseHealthConnectBody],
  ];
  for (const [path, provider, parse, parseBody] of hubs) {
    app.post(path, { bodyLimit: HUB_BODY_LIMIT }, async (req, reply) => {
      const hub = await findHubByToken(extractToken(req), provider);
      if (!hub) return reply.code(401).send({ error: 'unauthorized' });

      const workouts = parse(req.body);
      if (!workouts) return reply.code(400).send({ error: 'bad_payload' });

      // Приложения шлют скользящее окно, поэтому одна тренировка приходит много раз —
      // сохранение идемпотентно, а удалённое пользователем не возвращается
      const saved = await ingestWorkouts(hub.userId, provider, workouts);
      await touchHub(hub.id);
      console.log(
        `[${provider}] пользователь=${hub.userId} в запросе=${workouts.length} новых=${saved.created.length} обновлено=${saved.updated.length}`,
      );

      // Оба хаба в той же выгрузке присылают состав тела (вес, жир, мышцы, вода) — это те же
      // взвешивания, что и с openScale, только без второго токена и без отдельного приложения
      let body = { received: 0, created: 0, updated: 0 };
      const measurements = parseBody(req.body);
      if (measurements.length > 0) {
        const result = await saveMeasurements(hub.userId, measurements);
        body = { received: measurements.length, created: result.created.length, updated: result.updated.length };
        console.log(
          `[${provider}] пользователь=${hub.userId} взвешиваний=${measurements.length} новых=${result.created.length}`,
        );
        // Как и у весов: о пачке молчим, о свежем одиночном замере пишем в ЛС
        if (result.created.length === 1 && measurements.length === 1) await notifyNewMeasurement(result.created[0]!);
      }

      return {
        ok: true,
        received: workouts.length,
        created: saved.created.length,
        updated: saved.updated.length,
        skippedDeleted: saved.skippedDeleted,
        body,
      };
    });
  }
}
