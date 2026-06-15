import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Challenge, Participation } from '@prisma/client';
import { authPreHandler } from './auth';
import { getBank } from '../services/bank';
import { getProfile } from '../services/profile';
import { getLeaderboard } from '../services/leaderboard';
import { getMyChallenges } from '../services/myChallenges';
import {
  addSet,
  createPersonalChallenge,
  deletePersonal,
  deleteSet,
  getPersonalDetail,
  listPersonal,
} from '../services/personal';
import { getChallengeById } from '../services/challenge';
import { getActiveParticipation, displayName } from '../services/users';
import { reportSick } from '../services/sick';
import { challengeDayNumber, dateToDay, todayDay } from '../lib/time';

function challengePublicDTO(ch: Challenge, bank: number) {
  const today = todayDay(ch.timezone);
  return {
    id: ch.id,
    key: ch.key,
    title: ch.title,
    description: ch.description,
    rulesText: ch.rulesText,
    timezone: ch.timezone,
    startDate: dateToDay(ch.startDate),
    dayNumber: challengeDayNumber(dateToDay(ch.startDate), today),
    dailyDeadline: ch.dailyDeadline,
    sickDeadline: ch.sickDeadline,
    minDurationSec: ch.minDurationSec,
    fineAmount: ch.fineAmount,
    fakeFineMultiplier: ch.fakeFineMultiplier,
    bank,
  };
}

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authPreHandler);

  /** Резолвит челлендж по :id и активное участие текущего пользователя. */
  async function resolve(
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<{ challenge: Challenge; participation: Participation } | null> {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      reply.code(400).send({ error: 'bad_id' });
      return null;
    }
    const challenge = await getChallengeById(id);
    if (!challenge || !challenge.isActive) {
      reply.code(404).send({ error: 'challenge_not_found' });
      return null;
    }
    const participation = await getActiveParticipation(id, req.ctx!.user.id);
    if (!participation) {
      reply.code(403).send({ error: 'not_participant' });
      return null;
    }
    return { challenge, participation };
  }

  // Список челленджей текущего пользователя + инфо о пользователе (для выбора в профиле)
  app.get('/my/challenges', async (req) => {
    const u = req.ctx!.user;
    return {
      user: {
        name: displayName(u),
        username: u.username,
        photoUrl: u.photoUrl,
        isAdmin: u.isAdmin,
      },
      challenges: await getMyChallenges(u.id),
    };
  });

  // Информация о конкретном челлендже + банк (только для участника)
  app.get('/challenges/:id', async (req, reply) => {
    const r = await resolve(req, reply);
    if (!r) return;
    return challengePublicDTO(r.challenge, await getBank(r.challenge.id));
  });

  // Профиль пользователя в конкретном челлендже
  app.get('/challenges/:id/me', async (req, reply) => {
    const r = await resolve(req, reply);
    if (!r) return;
    return getProfile(r.challenge, r.participation, req.ctx!.user);
  });

  // Рейтинг конкретного челленджа
  app.get('/challenges/:id/leaderboard', async (req, reply) => {
    const r = await resolve(req, reply);
    if (!r) return;
    return { rows: await getLeaderboard(r.challenge) };
  });

  // Сообщить о болезни на сегодня в конкретном челлендже
  app.post('/challenges/:id/sick', async (req, reply) => {
    const r = await resolve(req, reply);
    if (!r) return;
    const result = await reportSick({
      challenge: r.challenge,
      participationId: r.participation.id,
      reportedAt: new Date(),
    });
    return {
      ok: true,
      valid: result.valid,
      day: result.day,
      sickDeadline: r.challenge.sickDeadline,
    };
  });

  // ---- Личные челленджи (только владелец) ----
  app.get('/personal', async (req) => {
    return { challenges: await listPersonal(req.ctx!.user.id) };
  });

  app.post('/personal', async (req, reply) => {
    const body = (req.body ?? {}) as { title?: string; unit?: string };
    if (!body.title || !body.title.trim()) return reply.code(400).send({ error: 'empty_title' });
    const c = await createPersonalChallenge(req.ctx!.user.id, body.title, body.unit);
    return { id: c.id };
  });

  app.get('/personal/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const detail = await getPersonalDetail(id, req.ctx!.user.id);
    if (!detail) return reply.code(404).send({ error: 'not_found' });
    return detail;
  });

  app.post('/personal/:id/sets', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as { reps?: number };
    const reps = Math.trunc(Number(body.reps));
    if (!Number.isInteger(reps) || reps <= 0 || reps > 100000) {
      return reply.code(400).send({ error: 'bad_reps' });
    }
    const ok = await addSet(id, req.ctx!.user.id, reps);
    if (!ok) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  app.delete('/personal/:id/sets/:setId', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const setId = Number((req.params as { setId: string }).setId);
    const ok = await deleteSet(id, req.ctx!.user.id, setId);
    if (!ok) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  app.delete('/personal/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const ok = await deletePersonal(id, req.ctx!.user.id);
    if (!ok) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  // ---- Совместимость: активный челлендж (одиночный режим) ----
  app.get('/challenge', async (req, reply) => {
    const ch = req.ctx?.challenge;
    if (!ch) return reply.code(404).send({ error: 'no_active_challenge' });
    return challengePublicDTO(ch, await getBank(ch.id));
  });

  app.get('/me', async (req, reply) => {
    if (!req.ctx?.challenge || !req.ctx.participation) {
      return reply.code(404).send({ error: 'no_active_challenge' });
    }
    return getProfile(req.ctx.challenge, req.ctx.participation, req.ctx.user);
  });

  app.get('/leaderboard', async (req, reply) => {
    const ch = req.ctx?.challenge;
    if (!ch) return reply.code(404).send({ error: 'no_active_challenge' });
    return { rows: await getLeaderboard(ch) };
  });
}
