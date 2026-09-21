import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Challenge } from '@prisma/client';
import { adminPreHandler, authPreHandler } from './auth';
import { parseId } from './resolve';
import { prisma } from '../lib/prisma';
import { dateToDay, dayToDate, dayjs } from '../lib/time';
import { can, challengeTimeline, getChallengeById } from '../services/challenge';
import { displayName } from '../services/users';
import { progressFor, type GoalType } from '../services/fitness/goals';
import { fitnessSettings } from '../services/fitness/overview';

/**
 * Админка челленджей по :id. Планка по-прежнему живёт в /api/admin/challenge (она одна и
 * берётся из контекста запроса); здесь — всё, чего может быть несколько: фитнес-челленджи.
 */
export async function adminChallengesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authPreHandler);
  app.addHook('preHandler', adminPreHandler);

  /** Челлендж по :id, который настраивается отсюда (сейчас — только фитнес). */
  async function requireFitness(rawId: unknown, reply: FastifyReply): Promise<Challenge | null> {
    const id = parseId(rawId, reply);
    if (id === null) return null;
    const ch = await getChallengeById(id);
    if (!ch) {
      reply.code(404).send({ error: 'challenge_not_found' });
      return null;
    }
    if (!can(ch, 'weeklyWorkouts')) {
      reply.code(400).send({ error: 'not_applicable' });
      return null;
    }
    return ch;
  }

  app.get('/', async () => {
    const challenges = await prisma.challenge.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { participations: { where: { status: 'active' } } } } },
    });
    return {
      rows: challenges.map((ch) => ({
        id: ch.id,
        kind: ch.kind,
        title: ch.title,
        isActive: ch.isActive,
        participants: ch._count.participations,
        ...challengeTimeline(ch),
      })),
    };
  });

  app.post('/', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const data = parseSettings(body);
    if (typeof data === 'string') return reply.code(400).send({ error: data });
    const { title, startDate } = data;
    if (!title) return reply.code(400).send({ error: 'bad_title' });
    if (!startDate) return reply.code(400).send({ error: 'bad_start_date' });

    const stamp = dateToDay(startDate).replace(/-/g, '');
    const created = await prisma.challenge.create({
      data: {
        ...data,
        title,
        startDate,
        kind: 'fitness',
        key: `fitness-${stamp}-${randomBytes(2).toString('hex')}`,
      },
    });
    return serialize(created);
  });

  app.get('/:id', async (req, reply) => {
    const ch = await requireFitness((req.params as { id: string }).id, reply);
    if (!ch) return;
    return serialize(ch);
  });

  app.patch('/:id', async (req, reply) => {
    const ch = await requireFitness((req.params as { id: string }).id, reply);
    if (!ch) return;
    const data = parseSettings((req.body ?? {}) as Record<string, unknown>);
    if (typeof data === 'string') return reply.code(400).send({ error: data });
    return serialize(await prisma.challenge.update({ where: { id: ch.id }, data }));
  });

  app.get('/:id/participants', async (req, reply) => {
    const ch = await requireFitness((req.params as { id: string }).id, reply);
    if (!ch) return;
    const participations = await prisma.participation.findMany({
      where: { challengeId: ch.id },
      include: { user: true, goal: true },
      orderBy: { joinedAt: 'asc' },
    });

    const rows = [];
    for (const p of participations) {
      const entries = p.goal
        ? await prisma.weightEntry.findMany({
            where: { userId: p.userId },
            orderBy: { measuredAt: 'desc' },
            take: 20,
          })
        : [];
      const progress = p.goal ? progressFor(p.goal, entries) : null;
      rows.push({
        participationId: p.id,
        userId: p.userId,
        name: displayName(p.user),
        username: p.user.username,
        status: p.status,
        joinedAt: p.joinedAt.toISOString(),
        goalType: (p.goal?.goalType as GoalType | undefined) ?? null,
        // админ видит цифры: он ведёт челлендж и сверяет стартовые замеры
        progress,
      });
    }
    return { rows };
  });
}

type SettingsError =
  | 'bad_title'
  | 'bad_start_date'
  | 'bad_duration'
  | 'bad_weekly_workouts'
  | 'bad_lives'
  | 'bad_min_workout'
  | 'bad_max_per_day'
  | 'bad_week_close_time'
  | 'bad_chat_id';

/** Целое в диапазоне; вне диапазона — ошибка, а не молчаливая обрезка: админ должен это увидеть. */
function intIn(v: unknown, min: number, max: number): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** Простые значения без Prisma-операций: такой объект годится и для create, и для update. */
interface SettingsPatch {
  title?: string;
  description?: string;
  rulesText?: string;
  timezone?: string;
  isActive?: boolean;
  joinOpen?: boolean;
  startDate?: Date;
  durationDays?: number | null;
  weeklyWorkouts?: number;
  lives?: number;
  minWorkoutMin?: number;
  maxWorkoutsPerDay?: number;
  weekCloseTime?: string;
  chatId?: bigint | null;
}

/** Разбирает только присланные поля: годится и для создания, и для частичной правки. */
function parseSettings(body: Record<string, unknown>): SettingsPatch | SettingsError {
  const data: SettingsPatch = {};

  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 120) return 'bad_title';
    data.title = body.title.trim();
  }
  for (const f of ['description', 'rulesText', 'timezone'] as const) {
    if (typeof body[f] === 'string') data[f] = body[f] as string;
  }
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive;
  if (typeof body.joinOpen === 'boolean') data.joinOpen = body.joinOpen;

  if (body.startDate !== undefined) {
    const day = body.startDate;
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !dayjs.utc(day).isValid()) {
      return 'bad_start_date';
    }
    data.startDate = dayToDate(day);
  }

  // пустая длительность — бессрочный челлендж
  if (body.durationDays !== undefined) {
    if (body.durationDays === null || body.durationDays === '') {
      data.durationDays = null;
    } else {
      const days = intIn(body.durationDays, 1, 3650);
      if (days === null) return 'bad_duration';
      data.durationDays = days;
    }
  }

  const ranges = [
    // норма выше семи недостижима при одной засчитываемой тренировке в день
    ['weeklyWorkouts', 1, 7, 'bad_weekly_workouts'],
    ['lives', 1, 9, 'bad_lives'],
    ['minWorkoutMin', 1, 300, 'bad_min_workout'],
    ['maxWorkoutsPerDay', 1, 3, 'bad_max_per_day'],
  ] as const;
  for (const [field, min, max, error] of ranges) {
    if (body[field] === undefined) continue;
    const n = intIn(body[field], min, max);
    if (n === null) return error;
    data[field] = n;
  }

  if (body.weekCloseTime !== undefined) {
    if (typeof body.weekCloseTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.weekCloseTime)) {
      return 'bad_week_close_time';
    }
    data.weekCloseTime = body.weekCloseTime;
  }

  if (body.chatId === null || body.chatId === '') {
    data.chatId = null;
  } else if (body.chatId !== undefined) {
    try {
      data.chatId = BigInt(String(body.chatId));
    } catch {
      return 'bad_chat_id';
    }
  }

  return data;
}

function serialize(ch: Challenge) {
  return {
    id: ch.id,
    key: ch.key,
    kind: ch.kind,
    title: ch.title,
    description: ch.description,
    rulesText: ch.rulesText,
    isActive: ch.isActive,
    joinOpen: ch.joinOpen,
    timezone: ch.timezone,
    durationDays: ch.durationDays,
    chatId: ch.chatId ? ch.chatId.toString() : null,
    ...challengeTimeline(ch),
    ...fitnessSettings(ch),
  };
}
