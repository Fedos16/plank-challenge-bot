import type { Challenge, Participation, User } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { challengeDayNumber, dateToDay, dayRange, todayDay, type DayStr } from '../lib/time';
import { can, challengeTimeline } from './challenge';
import { getParticipantDayState, mapSubmissionStatus, type DayState } from './dayStatus';
import {
  getGameState,
  type CurrentWeekDTO,
  type TrialWeekDTO,
  type WeekHistoryDTO,
} from './fitness/evaluation';
import { userFeed } from './fitness/fitnessLeaderboard';
import { getFitnessSummary, type FitnessSummary } from './fitness/overview';
import { journalInstants, type WorkoutDTO } from './fitness/workouts';
import { listPersonal, type PersonalSummary } from './personal';
import { getParticipantDays, getParticipationStreaks } from './streaks';
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

// ---------- история человека в одном челлендже ----------

/** Сколько последних тренировок показываем в истории фитнес-челленджа. */
const HISTORY_WORKOUTS = 30;

export type ProfileHistoryDTO =
  | {
      kind: 'plank';
      /** Все дни участия по порядку: с первого дня истории до сегодня (или до конца челленджа). */
      days: { day: DayStr; state: DayState }[];
    }
  | {
      kind: 'fitness';
      currentWeek: CurrentWeekDTO | null;
      trialWeek: TrialWeekDTO | null;
      /** Закрытые недели, от свежих к старым. */
      weeks: WeekHistoryDTO[];
      /** Последние тренировки — как их видит группа в ленте. */
      workouts: WorkoutDTO[];
    }
  | { kind: 'other' };

/** Статус каждого дня участника — по тем же правилам, что дневной отчёт и рейтинг. */
async function plankDays(ch: Challenge, p: Participation): Promise<{ day: DayStr; state: DayState }[]> {
  const { fromDay, today } = await getParticipantDays(ch, p);
  const end = challengeTimeline(ch).endDate;
  const lastDay = end && end < today ? end : today;
  if (fromDay > lastDay) return [];

  const [subs, sick, frozen] = await Promise.all([
    prisma.submission.findMany({ where: { participationId: p.id }, select: { day: true, status: true } }),
    prisma.sickDay.findMany({ where: { participationId: p.id, status: 'valid' }, select: { day: true } }),
    prisma.streakFreeze.findMany({ where: { participationId: p.id }, select: { day: true } }),
  ]);
  const subByDay = new Map(subs.map((x) => [dateToDay(x.day), x.status]));
  const sickDays = new Set(sick.map((x) => dateToDay(x.day)));
  const frozenDays = new Set(frozen.map((x) => dateToDay(x.day)));

  return dayRange(fromDay, lastDay).map((day) => {
    const sub = subByDay.get(day);
    let state: DayState;
    if (sub) state = mapSubmissionStatus(sub);
    else if (frozenDays.has(day)) state = 'frozen';
    else if (sickDays.has(day)) state = 'sick';
    else if (day >= today) state = 'pending';
    else state = 'missed';
    return { day, state };
  });
}

/**
 * История человека в челлендже глазами зрителя. Правила доступа те же, что у профиля: свой,
 * админ или участник того же челленджа. null — челленджа нет, человек в нём не участвует
 * или зрителю его видеть нельзя.
 */
export async function getProfileHistory(
  viewer: User,
  targetId: number,
  challengeId: number,
): Promise<ProfileHistoryDTO | null> {
  const p = await prisma.participation.findUnique({
    where: { challengeId_userId: { challengeId, userId: targetId } },
    include: { challenge: true },
  });
  if (!p || p.status !== 'active' || !p.challenge.isActive) return null;

  const isMe = viewer.id === targetId;
  if (!isMe && !viewer.isAdmin) {
    const mine = await prisma.participation.findUnique({
      where: { challengeId_userId: { challengeId, userId: viewer.id } },
    });
    if (!mine || mine.status !== 'active') return null;
  }

  const ch = p.challenge;
  if (can(ch, 'goals')) {
    const period = journalInstants(ch);
    const [game, feed] = await Promise.all([
      getGameState(ch, p),
      userFeed(ch, targetId, period.from, period.to),
    ]);
    return {
      kind: 'fitness',
      currentWeek: game.currentWeek,
      trialWeek: game.trialWeek,
      // заметки — личное: админская к прощённой неделе и своя к тренировке видны только хозяину
      weeks: game.history.map((w) => ({ ...w, forgivenNote: isMe ? w.forgivenNote : null })),
      workouts: feed.slice(0, HISTORY_WORKOUTS).map((w) => ({ ...w, note: isMe ? w.note : null })),
    };
  }
  if (can(ch, 'dailyCheckin')) return { kind: 'plank', days: await plankDays(ch, p) };
  return { kind: 'other' };
}
