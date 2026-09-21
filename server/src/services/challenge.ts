import type { Challenge } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { challengeDayNumber, dateToDay, dayjs, todayDay, type DayStr } from '../lib/time';

/**
 * Механика челленджа: ежедневная планка со штрафами, группа для взвешиваний либо фитнес
 * с недельной нормой тренировок и жизнями.
 */
export const CHALLENGE_KINDS = ['plank', 'weight', 'fitness'] as const;
export type ChallengeKind = (typeof CHALLENGE_KINDS)[number];

/**
 * Что умеет челлендж каждого типа. Роуты спрашивают возможность, а не тип: иначе каждая
 * новая механика молча наследует планочные больничные, штрафы и заморозки.
 */
export type Capability =
  | 'dailyCheckin' // кружки, дедлайны, серии, больничные, заморозки, напоминания
  | 'bank' // штрафы и общий банк
  | 'weeklyWorkouts' // недельная норма тренировок и жизни
  | 'goals' // личная цель и стартовые замеры
  | 'leave'; // участник может выйти сам (из планки убирает только админ)

const CAPABILITIES: Record<ChallengeKind, readonly Capability[]> = {
  plank: ['dailyCheckin', 'bank'],
  weight: ['leave'],
  fitness: ['weeklyWorkouts', 'goals', 'leave'],
};

export function can(ch: Challenge, cap: Capability): boolean {
  const caps: readonly Capability[] | undefined = CAPABILITIES[ch.kind as ChallengeKind];
  return caps?.includes(cap) ?? false;
}

/** Последний день челленджа. У бессрочного (durationDays не задан) — null. */
export function challengeEndDay(ch: Challenge): DayStr | null {
  if (!ch.durationDays || ch.durationDays <= 0) return null;
  return dayjs
    .utc(dateToDay(ch.startDate))
    .add(ch.durationDays - 1, 'day')
    .format('YYYY-MM-DD');
}

export type ChallengePhase = 'upcoming' | 'running' | 'finished';

export interface ChallengeTimeline {
  startDate: DayStr;
  endDate: DayStr | null;
  daysTotal: number | null;
  /** Номер сегодняшнего дня, зажатый в [0..daysTotal]: до старта 0, после конца — последний. */
  dayNumber: number;
  phase: ChallengePhase;
}

export function challengeTimeline(ch: Challenge): ChallengeTimeline {
  const startDate = dateToDay(ch.startDate);
  const endDate = challengeEndDay(ch);
  const daysTotal = endDate ? ch.durationDays : null;
  const raw = challengeDayNumber(startDate, todayDay(ch.timezone));

  let phase: ChallengePhase = 'running';
  if (raw < 1) phase = 'upcoming';
  else if (daysTotal && raw > daysTotal) phase = 'finished';

  const dayNumber = Math.max(0, daysTotal ? Math.min(raw, daysTotal) : raw);
  return { startDate, endDate, daysTotal, dayNumber, phase };
}

/**
 * Активный челлендж с планкой (на текущем этапе он один). Именно в него бот засчитывает
 * кружки, по нему работают отчёты и напоминания, и в него автоматически попадает каждый,
 * кто открыл приложение. Группы взвешиваний сюда не попадают — в них вступают вручную.
 */
export async function getActiveChallenge(): Promise<Challenge | null> {
  return prisma.challenge.findFirst({
    where: { isActive: true, kind: 'plank' },
    orderBy: { createdAt: 'asc' },
  });
}

export async function getActiveChallengeOrThrow(): Promise<Challenge> {
  const ch = await getActiveChallenge();
  if (!ch) throw new Error('Нет активного челленджа');
  return ch;
}

export async function getChallengeById(id: number): Promise<Challenge | null> {
  return prisma.challenge.findUnique({ where: { id } });
}

/** Все активные челленджи одного типа: в отличие от планки, фитнес-челленджей может быть несколько. */
export async function listActiveChallengesByKind(kind: ChallengeKind): Promise<Challenge[]> {
  return prisma.challenge.findMany({
    where: { isActive: true, kind },
    orderBy: { createdAt: 'asc' },
  });
}

/** Активные челленджи, в которых пользователь ещё не состоит: их он может выбрать сам. */
export async function listJoinableChallenges(userId: number): Promise<Challenge[]> {
  const challenges = await prisma.challenge.findMany({
    where: { isActive: true, joinOpen: true },
    orderBy: { createdAt: 'asc' },
  });
  if (challenges.length === 0) return [];

  const mine = await prisma.participation.findMany({
    where: { userId, status: 'active', challengeId: { in: challenges.map((c) => c.id) } },
    select: { challengeId: true },
  });
  const joined = new Set(mine.map((p) => p.challengeId));
  return challenges.filter((c) => !joined.has(c.id));
}
