import type { FastifyInstance } from 'fastify';
import { authPreHandler } from './auth';
import { getBank } from '../services/bank';
import { getProfile } from '../services/profile';
import { getLeaderboard } from '../services/leaderboard';
import { challengeDayNumber, dateToDay, todayDay } from '../lib/time';

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authPreHandler);

  // Публичная информация о челлендже + банк
  app.get('/challenge', async (req, reply) => {
    const ch = req.ctx?.challenge;
    if (!ch) return reply.code(404).send({ error: 'no_active_challenge' });
    const bank = await getBank(ch.id);
    const today = todayDay(ch.timezone);
    return {
      id: ch.id,
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
  });

  // Профиль текущего пользователя
  app.get('/me', async (req, reply) => {
    if (!req.ctx?.challenge || !req.ctx.participation) {
      return reply.code(404).send({ error: 'no_active_challenge' });
    }
    return getProfile(req.ctx.challenge, req.ctx.participation, req.ctx.user);
  });

  // Таблица лидеров
  app.get('/leaderboard', async (req, reply) => {
    const ch = req.ctx?.challenge;
    if (!ch) return reply.code(404).send({ error: 'no_active_challenge' });
    return { rows: await getLeaderboard(ch) };
  });
}
