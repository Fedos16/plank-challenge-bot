import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Challenge } from '@prisma/client';
import { authPreHandler } from './auth';
import { resolveParticipant, resolveWith } from './resolve';
import { getBank } from '../services/bank';
import { getProfile } from '../services/profile';
import {
  NOTIFICATION_TYPES,
  getNotificationSettings,
  updateNotificationSetting,
  type NotificationType,
} from '../services/notifications';
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
import {
  addManualWeight,
  assignProfile,
  deleteEntry,
  getWeightOverview,
  rotateScaleToken,
} from '../services/weight';
import {
  challengeTimeline,
  getChallengeById,
  listJoinableChallenges,
} from '../services/challenge';
import { displayName, ensureParticipation, leaveChallenge } from '../services/users';
import { reportSick } from '../services/sick';
import { getFreezeOverview, useFreeze } from '../services/freezes';
import { challengeDayNumber, dateToDay, todayDay } from '../lib/time';

function challengePublicDTO(ch: Challenge, bank: number) {
  const today = todayDay(ch.timezone);
  const timeline = challengeTimeline(ch);
  return {
    endDate: timeline.endDate,
    daysTotal: timeline.daysTotal,
    phase: timeline.phase,
    id: ch.id,
    key: ch.key,
    kind: ch.kind,
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
    freezeEveryDays: ch.freezeEveryDays,
    maxFreezes: ch.maxFreezes,
    bank,
  };
}

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authPreHandler);

  const resolve = resolveParticipant;

  /** Только для челленджей с планкой: кружки, штрафы, серии, больничные. */
  const resolvePlank = (req: FastifyRequest, reply: FastifyReply) =>
    resolveWith('dailyCheckin', req, reply);

  // Список челленджей текущего пользователя + инфо о пользователе (для выбора в профиле)
  app.get('/my/challenges', async (req) => {
    const u = req.ctx!.user;
    const joinable = await listJoinableChallenges(u.id);
    return {
      user: {
        name: displayName(u),
        username: u.username,
        photoUrl: u.photoUrl,
        isAdmin: u.isAdmin,
      },
      challenges: await getMyChallenges(u.id),
      available: joinable.map((c) => ({
        id: c.id,
        key: c.key,
        kind: c.kind,
        title: c.title,
        description: c.description,
      })),
    };
  });

  // Вступить в челлендж: участие всегда явное — ни /start, ни вход в приложение
  // сами в челлендж не записывают.
  app.post('/challenges/:id/join', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'bad_id' });
    const challenge = await getChallengeById(id);
    if (!challenge || !challenge.isActive) {
      return reply.code(404).send({ error: 'challenge_not_found' });
    }
    if (!challenge.joinOpen) return reply.code(403).send({ error: 'join_closed' });
    await ensureParticipation(challenge.id, req.ctx!.user.id);
    return { ok: true, id: challenge.id };
  });

  app.post('/challenges/:id/leave', async (req, reply) => {
    const r = await resolveWith('leave', req, reply);
    if (!r) return;
    await leaveChallenge(r.challenge.id, req.ctx!.user.id);
    return { ok: true };
  });

  // Информация о конкретном челлендже + банк (только для участника)
  app.get('/challenges/:id', async (req, reply) => {
    const r = await resolve(req, reply);
    if (!r) return;
    return challengePublicDTO(r.challenge, await getBank(r.challenge.id));
  });

  // Профиль пользователя в конкретном челлендже
  app.get('/challenges/:id/me', async (req, reply) => {
    const r = await resolvePlank(req, reply);
    if (!r) return;
    return getProfile(r.challenge, r.participation, req.ctx!.user);
  });

  // Рейтинг конкретного челленджа
  app.get('/challenges/:id/leaderboard', async (req, reply) => {
    const r = await resolvePlank(req, reply);
    if (!r) return;
    return { rows: await getLeaderboard(r.challenge) };
  });

  // Сообщить о болезни на сегодня в конкретном челлендже
  app.post('/challenges/:id/sick', async (req, reply) => {
    const r = await resolvePlank(req, reply);
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

  // ---- Заморозки серии (только сам участник, только в кабинете) ----
  app.get('/challenges/:id/freezes', async (req, reply) => {
    const r = await resolvePlank(req, reply);
    if (!r) return;
    return getFreezeOverview(r.challenge, r.participation);
  });

  app.post('/challenges/:id/freezes', async (req, reply) => {
    const r = await resolvePlank(req, reply);
    if (!r) return;
    const body = (req.body ?? {}) as { day?: string };
    if (!body.day || !/^\d{4}-\d{2}-\d{2}$/.test(body.day)) {
      return reply.code(400).send({ error: 'bad_day' });
    }
    const result = await useFreeze(r.challenge, r.participation, body.day);
    if (!result.ok) {
      return reply.code(400).send({ error: result.error, freezes: result.state });
    }
    return { ok: true, day: result.day, earnedDay: result.earnedDay, freezes: result.state };
  });

  // ---- Личные уведомления в ЛС ----
  app.get('/challenges/:id/notifications', async (req, reply) => {
    const r = await resolvePlank(req, reply);
    if (!r) return;
    return getNotificationSettings(r.challenge, r.participation.id);
  });

  app.patch('/challenges/:id/notifications', async (req, reply) => {
    const r = await resolvePlank(req, reply);
    if (!r) return;
    const body = (req.body ?? {}) as {
      type?: string;
      enabled?: boolean | null;
      time?: string | null;
    };
    if (!NOTIFICATION_TYPES.includes(body.type as NotificationType)) {
      return reply.code(400).send({ error: 'bad_type' });
    }
    if (body.enabled !== undefined && body.enabled !== null && typeof body.enabled !== 'boolean') {
      return reply.code(400).send({ error: 'bad_enabled' });
    }
    if (body.time !== undefined && body.time !== null && typeof body.time !== 'string') {
      return reply.code(400).send({ error: 'bad_time' });
    }
    try {
      await updateNotificationSetting(r.challenge, r.participation.id, body.type as NotificationType, {
        enabled: body.enabled,
        time: body.time,
      });
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : 'bad_request' });
    }
    return getNotificationSettings(r.challenge, r.participation.id);
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

  // ---- Вес с умных весов (только владелец) ----
  app.get('/weight', async (req) => getWeightOverview(req.ctx!.user.id));

  // Взвешивание вручную — для тех, у кого нет умных весов
  app.post('/weight', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
    const measuredAt = typeof body.measuredAt === 'string' ? new Date(body.measuredAt) : undefined;

    const result = await addManualWeight(req.ctx!.user.id, {
      weightKg: Number(body.weightKg),
      bodyFat: num(body.bodyFat),
      water: num(body.water),
      muscle: num(body.muscle),
      measuredAt,
    });
    if (typeof result === 'string') return reply.code(400).send({ error: result });
    return getWeightOverview(req.ctx!.user.id);
  });

  // Перевыпуск токена: старый адрес вебхука сразу перестаёт приниматься
  app.post('/weight/token', async (req) => {
    await rotateScaleToken(req.ctx!.user.id);
    return getWeightOverview(req.ctx!.user.id);
  });

  // Чей это профиль весов: null — мой, иначе участник общего челленджа.
  // Вместе с профилем к нему переезжает и уже накопленная история.
  app.patch('/weight/profiles/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'bad_id' });
    const body = (req.body ?? {}) as { targetUserId?: number | null };
    const raw = body.targetUserId;
    const target = raw === null || raw === undefined ? null : Math.trunc(Number(raw));
    if (target !== null && (!Number.isInteger(target) || target <= 0)) {
      return reply.code(400).send({ error: 'bad_target' });
    }
    const result = await assignProfile(req.ctx!.user.id, id, target);
    if (!result.ok) return reply.code(400).send({ error: result.error });
    const overview = await getWeightOverview(req.ctx!.user.id);
    return { ...overview, moved: result.moved, skipped: result.skipped };
  });

  app.delete('/weight/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'bad_id' });
    const ok = await deleteEntry(req.ctx!.user.id, id);
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
