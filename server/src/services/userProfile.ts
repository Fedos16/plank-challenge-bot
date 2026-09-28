import type { Challenge, Participation, User } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { challengeDayNumber, dateToDay, todayDay } from '../lib/time';
import { can } from './challenge';
import { getParticipantDayState, type DayState } from './dayStatus';
import { getFitnessSummary, type FitnessSummary } from './fitness/overview';
import { listPersonal, type PersonalSummary } from './personal';
import { getParticipationStreaks } from './streaks';
import { displayName, telegramName } from './users';

/** Челлендж в профиле: у планки — серии, у фитнеса — неделя, жизни и % к цели. */
export interface ProfileChallengeDTO {
  id: number;
  kind: string;
  title: string;
  dayNumber: number;
  joinedAt: string;
  plank?: { todayState: DayState; currentStreak: number; maxStreak: number; doneCount: number };
  fitness?: FitnessSummary;
}

export interface UserProfileDTO {
  user: {
    id: number;
    name: string;
    username: string | null;
    photoUrl: string | null;
    memberSince: string;
  };
  isMe: boolean;
  /** Только в своём профиле: для формы смены имени. */
  nameSettings: { customName: string | null; telegramName: string } | null;
  stats: {
    challenges: number;
    bestStreak: number;
    /** null — тренировки этому зрителю не показываем (нет общего фитнес-челленджа). */
    workouts: { count: number; minutes: number } | null;
  };
  challenges: ProfileChallengeDTO[];
  /** Личные челленджи — «только для себя», чужим не видны. */
  personal: PersonalSummary[] | null;
}

type ParticipationWithChallenge = Participation & { challenge: Challenge };

async function activeParticipations(userId: number): Promise<ParticipationWithChallenge[]> {
  return prisma.participation.findMany({
    where: { userId, status: 'active', challenge: { isActive: true } },
    include: { challenge: true },
    orderBy: { joinedAt: 'asc' },
  });
}

/**
 * Какие челленджи человека видит зритель: свои — все; чужие — только те, где они вместе
 * (админ видит все). null — смотреть нельзя вовсе: общих челленджей нет.
 */
async function visibleParticipations(
  viewer: User,
  target: User,
): Promise<ParticipationWithChallenge[] | null> {
  const parts = await activeParticipations(target.id);
  if (viewer.id === target.id || viewer.isAdmin) return parts;
  const mine = await prisma.participation.findMany({
    where: { userId: viewer.id, status: 'active' },
    select: { challengeId: true },
  });
  const shared = new Set(mine.map((p) => p.challengeId));
  const visible = parts.filter((p) => shared.has(p.challengeId));
  return visible.length ? visible : null;
}

async function challengeDTO(p: ParticipationWithChallenge): Promise<ProfileChallengeDTO> {
  const ch = p.challenge;
  const today = todayDay(ch.timezone);
  const base: ProfileChallengeDTO = {
    id: ch.id,
    kind: ch.kind,
    title: ch.title,
    dayNumber: challengeDayNumber(dateToDay(ch.startDate), today),
    joinedAt: p.joinedAt.toISOString(),
  };
  if (can(ch, 'goals')) return { ...base, fitness: await getFitnessSummary(ch, p) };
  if (!can(ch, 'dailyCheckin')) return base;

  const [streaks, todayState, doneCount] = await Promise.all([
    getParticipationStreaks(ch, p),
    getParticipantDayState(ch, p.id, today),
    prisma.submission.count({ where: { participationId: p.id, status: 'counted' } }),
  ]);
  return {
    ...base,
    plank: { todayState, currentStreak: streaks.current, maxStreak: streaks.max, doneCount },
  };
}

/** Все тренировки человека без дублей из второго источника и снятых админом. */
async function workoutTotals(userId: number): Promise<{ count: number; minutes: number }> {
  const agg = await prisma.workout.aggregate({
    where: { userId, duplicateOfId: null, excluded: false },
    _count: { _all: true },
    _sum: { durationSec: true },
  });
  return { count: agg._count._all, minutes: Math.round((agg._sum.durationSec ?? 0) / 60) };
}

/** Профиль человека глазами зрителя; null — зрителю его видеть нельзя. */
export async function getUserProfile(viewer: User, targetId: number): Promise<UserProfileDTO | null> {
  const target = targetId === viewer.id ? viewer : await prisma.user.findUnique({ where: { id: targetId } });
  if (!target) return null;
  const parts = await visibleParticipations(viewer, target);
  if (!parts) return null;

  const isMe = target.id === viewer.id;
  const challenges: ProfileChallengeDTO[] = [];
  for (const p of parts) challenges.push(await challengeDTO(p));

  // тренировки группа и так видит в ленте фитнес-челленджа — вне его они личное дело
  const showWorkouts = isMe || viewer.isAdmin || challenges.some((c) => c.fitness);
  const [workouts, personal] = await Promise.all([
    showWorkouts ? workoutTotals(target.id) : Promise.resolve(null),
    isMe ? listPersonal(target.id) : Promise.resolve(null),
  ]);

  return {
    user: {
      id: target.id,
      name: displayName(target),
      username: target.username,
      photoUrl: target.photoUrl,
      memberSince: target.createdAt.toISOString(),
    },
    isMe,
    nameSettings: isMe ? { customName: target.customName, telegramName: telegramName(target) } : null,
    stats: {
      challenges: challenges.length,
      bestStreak: Math.max(0, ...challenges.map((c) => c.plank?.maxStreak ?? 0)),
      workouts,
    },
    challenges,
    personal,
  };
}
