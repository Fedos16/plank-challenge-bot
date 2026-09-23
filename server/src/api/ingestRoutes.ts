import type { FastifyInstance, FastifyRequest } from 'fastify';
import { notifyNewMeasurement, saveMeasurements, type WeightMeasurement } from '../services/weight';
import { findHubByToken, touchHub, type HubProvider } from '../services/integrations';
import { ingestWorkouts } from '../services/fitness/ingest';
import { recordIngest, summarizeBody } from '../services/ingestLog';
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

/** Размер тела запроса: телефон его сообщает, считать самим незачем — выгрузка бывает тяжёлой. */
function bodyBytes(req: FastifyRequest): number {
  const header = req.headers['content-length'];
  const n = typeof header === 'string' ? Number(header) : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Токен из запроса. Приложения-хабы шлют произвольный заголовок Authorization, поэтому
 * принимаем и «Bearer xxx», и голый токен; query-параметр — на случай клиента, который
 * заголовки задавать не умеет.
 */
function extractToken(req: FastifyRequest): string {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.trim()) {
    return auth.replace(/^Bearer\s+/i, '').trim();
  }
  const header = req.headers['x-ingest-token'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  const query = (req.query as { token?: string } | undefined)?.token;
  return typeof query === 'string' ? query.trim() : '';
}

/**
 * Приём данных с телефона: тренировки и взвешивания. Авторизация — личный токен участника,
 * а не Telegram: запрос идёт с телефона, а не из Web App, поэтому роуты вынесены из userRoutes.
 */
export async function ingestRoutes(app: FastifyInstance): Promise<void> {
  // ---- Тренировки и состав тела с телефонных хабов ----
  type HubParsers = [
    string,
    HubProvider,
    (body: unknown) => ExternalWorkout[] | null,
    (body: unknown) => WeightMeasurement[],
  ];
  const hubs: HubParsers[] = [
    ['/health-auto-export', 'hae', parseHaePayload, parseHaeBody],
    ['/health-connect', 'health_connect', parseHealthConnectPayload, parseHealthConnectBody],
  ];
  for (const [path, provider, parse, parseBody] of hubs) {
    app.post(path, { bodyLimit: HUB_BODY_LIMIT }, async (req, reply) => {
      const hub = await findHubByToken(extractToken(req), provider);
      if (!hub) {
        // Чей это телефон — неизвестно, писать отказ в чей-то журнал нельзя: только в лог
        console.warn(`[${provider}] отказ: токен не найден`);
        return reply.code(401).send({ error: 'unauthorized' });
      }

      const bytes = bodyBytes(req);
      const summary = summarizeBody(provider, req.body);

      const workouts = parse(req.body);
      if (!workouts) {
        await recordIngest({ userId: hub.userId, provider, status: 'bad_payload', bytes, summary });
        console.warn(`[${provider}] пользователь=${hub.userId} тело не распознано, байт=${bytes}`);
        return reply.code(400).send({ error: 'bad_payload' });
      }

      // Приложения шлют скользящее окно, поэтому одна тренировка приходит много раз —
      // сохранение идемпотентно, а удалённое пользователем не возвращается
      const saved = await ingestWorkouts(hub.userId, provider, workouts);
      await touchHub(hub.id);
      console.log(
        `[${provider}] пользователь=${hub.userId} в запросе=${workouts.length} новых=${saved.created.length} обновлено=${saved.updated.length}`,
      );

      // Оба хаба в той же выгрузке присылают состав тела: вес, жир, мышцы и воду пишут туда
      // умные весы со своим приложением, отдельный приёмник для них не нужен
      let body = { received: 0, created: 0, updated: 0 };
      const measurements = parseBody(req.body);
      if (measurements.length > 0) {
        const result = await saveMeasurements(hub.userId, measurements);
        body = { received: measurements.length, created: result.created.length, updated: result.updated.length };
        console.log(
          `[${provider}] пользователь=${hub.userId} взвешиваний=${measurements.length} новых=${result.created.length}`,
        );
        // Телефон шлёт скользящее окно, поэтому в выгрузке бывают и старые взвешивания. Пишем
        // в ЛС только о самом свежем из новых — о старых notifyNewMeasurement промолчит сам
        const newest = [...result.created].sort((a, b) => b.measuredAt.getTime() - a.measuredAt.getTime())[0];
        if (newest) await notifyNewMeasurement(newest);
      }

      // Журнал переживает деплой, в отличие от логов контейнера: по нему потом видно,
      // что именно прислал телефон и включены ли в приложении нужные галочки
      await recordIngest({
        userId: hub.userId,
        provider,
        status: 'ok',
        bytes,
        summary,
        counts: {
          workouts: workouts.length,
          workoutsCreated: saved.created.length,
          workoutsUpdated: saved.updated.length,
          measurements: body.received,
          measurementsCreated: body.created,
          measurementsUpdated: body.updated,
        },
      });

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
