import type { FastifyInstance } from 'fastify';
import { adminPreHandler, authPreHandler } from './auth';
import { prisma } from '../lib/prisma';
import { dateToDay, dayToDate, yesterdayDay } from '../lib/time';
import { addAdjustment, addPayment, addSpend, getBank, removePayment } from '../services/bank';
import { getDebtsOverview } from '../services/debts';
import { getRecentDays } from '../services/recentDays';
import { applyDayOverride, type OverrideAction } from '../services/manual';
import { sendDailyReport } from '../services/report';
import { displayName } from '../services/users';
import { getParticipationStreaks } from '../services/streaks';
import { getFreezeState } from '../services/freezes';
import { resetAllData, resetLedger, resetParticipants, unbindChat } from '../services/reset';

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authPreHandler);
  app.addHook('preHandler', adminPreHandler);

  function requireChallenge(req: { ctx?: { challenge: unknown } }) {
    return req.ctx?.challenge as import('@prisma/client').Challenge | null;
  }

  // ---- Настройки челленджа ----
  app.get('/challenge', async (req, reply) => {
    const ch = requireChallenge(req);
    if (!ch) return reply.code(404).send({ error: 'no_active_challenge' });
    const bank = await getBank(ch.id);
    return { ...serializeChallenge(ch), bank };
  });

  app.patch('/challenge', async (req, reply) => {
    const ch = requireChallenge(req);
    if (!ch) return reply.code(404).send({ error: 'no_active_challenge' });
    const body = (req.body ?? {}) as Record<string, unknown>;

    const data: Record<string, unknown> = {};
    const strFields = [
      'title',
      'description',
      'rulesText',
      'timezone',
      'dailyDeadline',
      'sickDeadline',
      'reportTime',
      'reminderTime',
      'lastChanceTime',
    ];
    for (const f of strFields) if (typeof body[f] === 'string') data[f] = body[f];

    const intFields = ['minDurationSec', 'fineAmount', 'fakeFineMultiplier'];
    for (const f of intFields) {
      if (body[f] !== undefined && body[f] !== null && !Number.isNaN(Number(body[f]))) {
        data[f] = Math.trunc(Number(body[f]));
      }
    }

    // заморозки серии: 0 в любом из полей выключает фичу
    for (const f of ['freezeEveryDays', 'maxFreezes']) {
      if (body[f] !== undefined && body[f] !== null && !Number.isNaN(Number(body[f]))) {
        data[f] = Math.max(0, Math.trunc(Number(body[f])));
      }
    }

    if (typeof body.freezeStreakOnSick === 'boolean') data.freezeStreakOnSick = body.freezeStreakOnSick;
    if (typeof body.dmReminders === 'boolean') data.dmReminders = body.dmReminders;
    if (typeof body.isActive === 'boolean') data.isActive = body.isActive;

    if (typeof body.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.startDate)) {
      data.startDate = dayToDate(body.startDate);
    }
    if (body.chatId === null || body.chatId === '') {
      data.chatId = null;
    } else if (body.chatId !== undefined) {
      try {
        data.chatId = BigInt(String(body.chatId));
      } catch {
        /* игнор некорректного значения */
      }
    }
    if (body.chatThreadId === null || body.chatThreadId === '') {
      data.chatThreadId = null;
    } else if (body.chatThreadId !== undefined) {
      const topic = Number(body.chatThreadId);
      if (Number.isSafeInteger(topic) && topic > 0) data.chatThreadId = topic;
    }

    const updated = await prisma.challenge.update({ where: { id: ch.id }, data });
    return serializeChallenge(updated);
  });

  // ---- Банк / реестр ----
  app.get('/ledger', async (req, reply) => {
    const ch = requireChallenge(req);
    if (!ch) return reply.code(404).send({ error: 'no_active_challenge' });
    const entries = await prisma.ledgerEntry.findMany({
      where: { challengeId: ch.id, type: { not: 'payment' } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { participation: { include: { user: true } } },
    });
    const bank = await getBank(ch.id);
    return {
      bank,
      entries: entries.map((e) => ({
        id: e.id,
        type: e.type,
        amount: e.amount,
        day: e.day ? dateToDay(e.day) : null,
        note: e.note,
        createdAt: e.createdAt.toISOString(),
        participant: e.participation ? displayName(e.participation.user) : null,
      })),
    };
  });

  app.post('/ledger', async (req, reply) => {
    const ch = requireChallenge(req);
    if (!ch) return reply.code(404).send({ error: 'no_active_challenge' });
    const body = (req.body ?? {}) as { type?: string; amount?: number; note?: string };
    const amount = Math.trunc(Number(body.amount));
    if (Number.isNaN(amount) || amount === 0) {
      return reply.code(400).send({ error: 'invalid_amount' });
    }
    if (body.type === 'spend') {
      await addSpend(ch.id, amount, body.note);
    } else {
      await addAdjustment(ch.id, amount, body.note);
    }
    return { ok: true, bank: await getBank(ch.id) };
  });

  // Прямая установка банка: создаёт корректирующую запись до нужной суммы
  app.post('/bank/set', async (req, reply) => {
    const ch = requireChallenge(req);
    if (!ch) return reply.code(404).send({ error: 'no_active_challenge' });
    const body = (req.body ?? {}) as { value?: number; note?: string };
    const target = Math.trunc(Number(body.value));
    if (Number.isNaN(target)) return reply.code(400).send({ error: 'invalid_value' });
    const current = await getBank(ch.id);
    const delta = target - current;
    if (delta !== 0) await addAdjustment(ch.id, delta, body.note ?? 'Установка банка вручную');
    return { ok: true, bank: await getBank(ch.id) };
  });

  // ---- Долги / оплаты ----
  app.get('/debts', async (req, reply) => {
    const ch = requireChallenge(req);
    if (!ch) return reply.code(404).send({ error: 'no_active_challenge' });
    return getDebtsOverview(ch.id);
  });

  app.post('/payments', async (req, reply) => {
    const ch = requireChallenge(req);
    if (!ch) return reply.code(404).send({ error: 'no_active_challenge' });
    const body = (req.body ?? {}) as { participationId?: number; amount?: number; note?: string };
    const participationId = Math.trunc(Number(body.participationId));
    const amount = Math.trunc(Number(body.amount));
    if (!participationId || Number.isNaN(amount) || amount <= 0) {
      return reply.code(400).send({ error: 'invalid_payment' });
    }
    const p = await prisma.participation.findFirst({
      where: { id: participationId, challengeId: ch.id },
    });
    if (!p) return reply.code(404).send({ error: 'participant_not_found' });
    await addPayment({ challengeId: ch.id, participationId, amount, note: body.note });
    return { ok: true, ...(await getDebtsOverview(ch.id)) };
  });

  app.delete('/payments/:id', async (req, reply) => {
    const ch = requireChallenge(req);
    if (!ch) return reply.code(404).send({ error: 'no_active_challenge' });
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'bad_id' });
    await removePayment(ch.id, id);
    return { ok: true, ...(await getDebtsOverview(ch.id)) };
  });

  // ---- Мотивационные речи ----
  app.get('/quotes', async (req, reply) => {
    const ch = requireChallenge(req);
    if (!ch) return reply.code(404).send({ error: 'no_active_challenge' });
    const quotes = await prisma.motivationalQuote.findMany({
      where: { OR: [{ challengeId: ch.id }, { challengeId: null }] },
      orderBy: { id: 'asc' },
    });
    return {
      quotes: quotes.map((q) => ({
        id: q.id,
        text: q.text,
        isActive: q.isActive,
        global: q.challengeId === null,
        lastUsedAt: q.lastUsedAt ? q.lastUsedAt.toISOString() : null,
      })),
    };
  });

  app.post('/quotes', async (req, reply) => {
    const ch = requireChallenge(req);
    if (!ch) return reply.code(404).send({ error: 'no_active_challenge' });
    const body = (req.body ?? {}) as { text?: string };
    if (!body.text || !body.text.trim()) return reply.code(400).send({ error: 'empty_text' });
    const quote = await prisma.motivationalQuote.create({
      data: { challengeId: ch.id, text: body.text.trim(), isActive: true },
    });
    return { id: quote.id };
  });

  app.patch('/quotes/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as { text?: string; isActive?: boolean };
    const data: Record<string, unknown> = {};
    if (typeof body.text === 'string') data.text = body.text;
    if (typeof body.isActive === 'boolean') data.isActive = body.isActive;
    const quote = await prisma.motivationalQuote.update({ where: { id }, data });
    return { id: quote.id };
  });

  app.delete('/quotes/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    await prisma.motivationalQuote.delete({ where: { id } });
    return { ok: true };
  });

  // ---- Участники ----
  app.get('/participants', async (req, reply) => {
    const ch = requireChallenge(req);
    if (!ch) return reply.code(404).send({ error: 'no_active_challenge' });
    const participations = await prisma.participation.findMany({
      where: { challengeId: ch.id },
      include: { user: true },
      orderBy: { joinedAt: 'asc' },
    });
    const rows = [];
    for (const p of participations) {
      const streaks = await getParticipationStreaks(ch, p);
      const freezes = await getFreezeState(ch, p);
      rows.push({
        participationId: p.id,
        userId: p.userId,
        telegramId: p.user.telegramId.toString(),
        name: displayName(p.user),
        username: p.user.username,
        isAdmin: p.user.isAdmin,
        status: p.status,
        joinedAt: p.joinedAt.toISOString(),
        currentStreak: streaks.current,
        maxStreak: streaks.max,
        freezesAvailable: freezes.available,
        freezesUsed: freezes.used,
        freezesEarned: freezes.earned,
      });
    }
    return { rows };
  });

  app.patch('/participants/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as { status?: string; isAdmin?: boolean };
    const participation = await prisma.participation.findUnique({ where: { id } });
    if (!participation) return reply.code(404).send({ error: 'not_found' });
    if (body.status === 'active' || body.status === 'left') {
      await prisma.participation.update({
        where: { id },
        data: {
          status: body.status,
          // дата выхода нужна ленте событий, чтобы не рисовать пропуски после выхода
          leftAt: body.status === 'left' ? new Date() : null,
        },
      });
    }
    if (typeof body.isAdmin === 'boolean') {
      await prisma.user.update({ where: { id: participation.userId }, data: { isAdmin: body.isAdmin } });
    }
    return { ok: true };
  });

  // ---- Лента последних событий + ручные правки ----
  app.get('/recent', async (req, reply) => {
    const ch = requireChallenge(req);
    if (!ch) return reply.code(404).send({ error: 'no_active_challenge' });
    const q = (req.query ?? {}) as { days?: string; before?: string; participationId?: string };

    if (q.before !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(q.before)) {
      return reply.code(400).send({ error: 'bad_before' });
    }
    const days = q.days !== undefined && !Number.isNaN(Number(q.days)) ? Number(q.days) : undefined;
    const participationId =
      q.participationId && !Number.isNaN(Number(q.participationId))
        ? Number(q.participationId)
        : undefined;

    return getRecentDays(ch, { days, before: q.before, participationId });
  });

  app.post('/day-override', async (req, reply) => {
    const ch = requireChallenge(req);
    if (!ch) return reply.code(404).send({ error: 'no_active_challenge' });
    const body = (req.body ?? {}) as {
      participationId?: number;
      day?: string;
      action?: OverrideAction;
    };
    if (
      !body.participationId ||
      !body.day ||
      !/^\d{4}-\d{2}-\d{2}$/.test(body.day) ||
      !['done', 'missed', 'sick', 'clear', 'fake'].includes(body.action ?? '')
    ) {
      return reply.code(400).send({ error: 'bad_request' });
    }
    await applyDayOverride(ch, body.participationId, body.day, body.action as OverrideAction);
    return { ok: true };
  });

  // ---- Ручной запуск отчёта ----
  app.post('/report', async (req, reply) => {
    const ch = requireChallenge(req);
    if (!ch) return reply.code(404).send({ error: 'no_active_challenge' });
    const body = (req.body ?? {}) as { day?: string };
    const day =
      body.day && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : yesterdayDay(ch.timezone);
    const result = await sendDailyReport(ch, day, { force: true });
    return { ok: true, sent: result.sent, day, content: result.content };
  });

  // ---- Сброс / очистка данных ----
  app.post('/reset/ledger', async (req, reply) => {
    const ch = requireChallenge(req);
    if (!ch) return reply.code(404).send({ error: 'no_active_challenge' });
    const deleted = await resetLedger(ch.id);
    return { ok: true, deleted, bank: await getBank(ch.id) };
  });

  app.post('/reset/participants', async (req, reply) => {
    const ch = requireChallenge(req);
    if (!ch) return reply.code(404).send({ error: 'no_active_challenge' });
    const removed = await resetParticipants(ch.id);
    return { ok: true, removed };
  });

  app.post('/reset/chat', async (req, reply) => {
    const ch = requireChallenge(req);
    if (!ch) return reply.code(404).send({ error: 'no_active_challenge' });
    await unbindChat(ch.id);
    return { ok: true };
  });

  app.post('/reset/all', async (req, reply) => {
    const ch = requireChallenge(req);
    if (!ch) return reply.code(404).send({ error: 'no_active_challenge' });
    await resetAllData(ch.id);
    return { ok: true, bank: await getBank(ch.id) };
  });
}

function serializeChallenge(ch: import('@prisma/client').Challenge) {
  return {
    id: ch.id,
    key: ch.key,
    title: ch.title,
    description: ch.description,
    rulesText: ch.rulesText,
    isActive: ch.isActive,
    timezone: ch.timezone,
    startDate: dateToDay(ch.startDate),
    dailyDeadline: ch.dailyDeadline,
    sickDeadline: ch.sickDeadline,
    minDurationSec: ch.minDurationSec,
    fineAmount: ch.fineAmount,
    fakeFineMultiplier: ch.fakeFineMultiplier,
    chatId: ch.chatId ? ch.chatId.toString() : null,
    chatThreadId: ch.chatThreadId,
    freezeStreakOnSick: ch.freezeStreakOnSick,
    freezeEveryDays: ch.freezeEveryDays,
    maxFreezes: ch.maxFreezes,
    dmReminders: ch.dmReminders,
    reportTime: ch.reportTime,
    reminderTime: ch.reminderTime,
    lastChanceTime: ch.lastChanceTime,
  };
}
