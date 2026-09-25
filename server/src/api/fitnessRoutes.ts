import type { FastifyInstance } from 'fastify';
import { authPreHandler } from './auth';
import { parseId, resolveWith } from './resolve';
import {
  deleteMeasurement,
  getBodyProfile,
  listMeasurements,
  saveBodyProfile,
  saveGoal,
  upsertMeasurement,
} from '../services/fitness/goals';
import { getFitnessOverview } from '../services/fitness/overview';
import { getFitnessFeed, getFitnessLeaderboard } from '../services/fitness/fitnessLeaderboard';
import { getWeekReport } from '../services/fitness/weekReport';
import { can, getChallengeById } from '../services/challenge';
import {
  SPORTS,
  createManualWorkout,
  deleteWorkout,
  listWorkouts,
  updateManualWorkout,
} from '../services/fitness/workouts';

/** Фитнес-челлендж: личная цель, анкета и замеры участника. */
export async function fitnessRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authPreHandler);

  // Всё для экрана челленджа одним запросом
  app.get('/challenges/:id/fitness', async (req, reply) => {
    const r = await resolveWith('goals', req, reply);
    if (!r) return;
    return getFitnessOverview(r.challenge, r.participation, req.ctx!.user);
  });

  // Цель и стартовые замеры. Возвращает обновлённую сводку, чтобы фронт не перезапрашивал
  app.put('/challenges/:id/goal', async (req, reply) => {
    const r = await resolveWith('goals', req, reply);
    if (!r) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await saveGoal(r.challenge, r.participation, body);
    if (typeof result === 'string') return reply.code(400).send({ error: result });
    return getFitnessOverview(r.challenge, r.participation, req.ctx!.user);
  });

  // ---- Тренировки ----
  // Журнал за время челленджа: у каждой записи — идёт ли она в зачёт недели и почему нет
  app.get('/challenges/:id/fitness/workouts', async (req, reply) => {
    const r = await resolveWith('weeklyWorkouts', req, reply);
    if (!r) return;
    return { workouts: await listWorkouts(r.challenge, r.participation), sports: SPORTS };
  });

  // Отчёт недели. Ссылку на него бот кидает в общий чат, поэтому открыть его может любой, кто
  // вошёл через Telegram, а не только участник: в отчёте нет ничего сверх прежней текстовой сводки
  app.get('/challenges/:id/fitness/report', async (req, reply) => {
    const id = parseId((req.params as { id: string }).id, reply);
    if (id === null) return;
    const ch = await getChallengeById(id);
    if (!ch || !can(ch, 'weeklyWorkouts')) return reply.code(404).send({ error: 'challenge_not_found' });
    const raw = (req.query as { week?: string }).week;
    const week = raw === undefined || raw === '' ? undefined : Number(raw);
    const report = await getWeekReport(ch, req.ctx!.user.id, week);
    if (typeof report === 'string') return reply.code(400).send({ error: report });
    return report;
  });

  // Рейтинг и общая лента: тренировки друг друга видят все участники
  app.get('/challenges/:id/fitness/leaderboard', async (req, reply) => {
    const r = await resolveWith('weeklyWorkouts', req, reply);
    if (!r) return;
    const meId = req.ctx!.user.id;
    const [rows, feed] = await Promise.all([
      getFitnessLeaderboard(r.challenge, meId),
      getFitnessFeed(r.challenge, meId),
    ]);
    return { rows, feed };
  });

  // Тренировка принадлежит человеку, а не челленджу — поэтому роуты без :id челленджа
  app.post('/workouts', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await createManualWorkout(req.ctx!.user.id, body);
    if (typeof result === 'string') return reply.code(400).send({ error: result });
    return { ok: true, id: result.id };
  });

  app.patch('/workouts/:id', async (req, reply) => {
    const id = parseId((req.params as { id: string }).id, reply);
    if (id === null) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await updateManualWorkout(req.ctx!.user.id, id, body);
    if (result === 'not_found') return reply.code(404).send({ error: result });
    if (typeof result === 'string') return reply.code(400).send({ error: result });
    return { ok: true, id: result.id };
  });

  app.delete('/workouts/:id', async (req, reply) => {
    const id = parseId((req.params as { id: string }).id, reply);
    if (id === null) return;
    const ok = await deleteWorkout(req.ctx!.user.id, id);
    if (!ok) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  // ---- Анкета: рост, пол, год рождения. Личная, от челленджа не зависит ----
  app.get('/body-profile', async (req) => getBodyProfile(req.ctx!.user.id));

  app.put('/body-profile', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await saveBodyProfile(req.ctx!.user.id, body);
    if (typeof result === 'string') return reply.code(400).send({ error: result });
    return result;
  });

  // ---- Обхваты ----
  app.get('/measurements', async (req) => ({ rows: await listMeasurements(req.ctx!.user.id) }));

  app.put('/measurements', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await upsertMeasurement(req.ctx!.user.id, body);
    if (typeof result === 'string') return reply.code(400).send({ error: result });
    return { rows: await listMeasurements(req.ctx!.user.id) };
  });

  app.delete('/measurements/:id', async (req, reply) => {
    const id = parseId((req.params as { id: string }).id, reply);
    if (id === null) return;
    const ok = await deleteMeasurement(req.ctx!.user.id, id);
    if (!ok) return reply.code(404).send({ error: 'not_found' });
    return { rows: await listMeasurements(req.ctx!.user.id) };
  });
}
