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
