import type { Challenge, Participation, User } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { todayDay } from '../../lib/time';
import { WEEK_DAYS, weekIndexOf } from '../../lib/weeks';
import { challengeTimeline, type ChallengeTimeline } from '../challenge';
import { displayName } from '../users';
import {
  getBodyProfile,
  getGoal,
  progressFor,
  type BodyProfileDTO,
  type GoalDTO,
  type GoalProgressDTO,
  type GoalType,
} from './goals';

export interface FitnessSettingsDTO {
  weeklyWorkouts: number;
  lives: number;
  minWorkoutMin: number;
  maxWorkoutsPerDay: number;
  weekCloseTime: string;
}

export function fitnessSettings(ch: Challenge): FitnessSettingsDTO {
  return {
    weeklyWorkouts: ch.weeklyWorkouts,
    lives: ch.lives,
    minWorkoutMin: ch.minWorkoutMin,
    maxWorkoutsPerDay: ch.maxWorkoutsPerDay,
    weekCloseTime: ch.weekCloseTime,
  };
}

export interface FitnessTimelineDTO extends ChallengeTimeline {
  /** Номер текущей недели с единицы; до старта — 0. */
  weekNumber: number;
  weeksTotal: number | null;
}

export function fitnessTimeline(ch: Challenge): FitnessTimelineDTO {
  const timeline = challengeTimeline(ch);
  const today = timeline.endDate && timeline.phase === 'finished' ? timeline.endDate : todayDay(ch.timezone);
  return {
    ...timeline,
    weekNumber: timeline.phase === 'upcoming' ? 0 : weekIndexOf(timeline.startDate, today) + 1,
    weeksTotal: timeline.daysTotal ? Math.ceil(timeline.daysTotal / WEEK_DAYS) : null,
  };
}

/** Строка участника, видимая всей группе: процент к цели есть у всех, цифры — по согласию. */
export interface FitnessParticipantDTO {
  participationId: number;
  name: string;
  isMe: boolean;
  goalType: GoalType | null;
  progressPercent: number | null;
  /** Только если участник сам открыл цифры в анкете. */
  body: { start: number | null; current: number | null; target: number | null } | null;
}

export interface FitnessOverview {
  challenge: {
    id: number;
    title: string;
    description: string;
    rulesText: string;
    timezone: string;
  } & FitnessTimelineDTO;
  settings: FitnessSettingsDTO;
  bodyProfile: BodyProfileDTO;
  goal: GoalDTO | null;
  progress: GoalProgressDTO | null;
  participants: FitnessParticipantDTO[];
}

async function listParticipants(ch: Challenge, meId: number): Promise<FitnessParticipantDTO[]> {
  const parts = await prisma.participation.findMany({
    where: { challengeId: ch.id, status: 'active' },
    include: { user: { include: { bodyProfile: true } }, goal: true },
    orderBy: { joinedAt: 'asc' },
  });

  const rows: FitnessParticipantDTO[] = [];
  for (const p of parts) {
    const entries = p.goal
      ? await prisma.weightEntry.findMany({
          where: { userId: p.userId },
          orderBy: { measuredAt: 'desc' },
          take: 20,
        })
      : [];
    const progress = p.goal ? progressFor(p.goal, entries) : null;
    const isMe = p.userId === meId;
    const open = isMe || p.user.bodyProfile?.shareBody === true;

    rows.push({
      participationId: p.id,
      name: displayName(p.user),
      isMe,
      goalType: (p.goal?.goalType as GoalType | undefined) ?? null,
      progressPercent: progress?.percent ?? null,
      body:
        open && progress?.metric
          ? { start: progress.start, current: progress.current, target: progress.target }
          : null,
    });
  }
  return rows;
}

export async function getFitnessOverview(
  ch: Challenge,
  participation: Participation,
  user: User,
): Promise<FitnessOverview> {
  const [bodyProfile, goal, participants] = await Promise.all([
    getBodyProfile(user.id),
    getGoal(participation),
    listParticipants(ch, user.id),
  ]);

  return {
    challenge: {
      id: ch.id,
      title: ch.title,
      description: ch.description,
      rulesText: ch.rulesText,
      timezone: ch.timezone,
      ...fitnessTimeline(ch),
    },
    settings: fitnessSettings(ch),
    bodyProfile,
    goal: goal?.goal ?? null,
    progress: goal?.progress ?? null,
    participants,
  };
}

export interface FitnessSummary {
  dayNumber: number;
  daysTotal: number | null;
  phase: ChallengeTimeline['phase'];
  hasGoal: boolean;
  progressPercent: number | null;
}

/** Короткая сводка для карточки в списке челленджей. */
export async function getFitnessSummary(
  ch: Challenge,
  participation: Participation,
): Promise<FitnessSummary> {
  const timeline = challengeTimeline(ch);
  const goal = await getGoal(participation);
  return {
    dayNumber: timeline.dayNumber,
    daysTotal: timeline.daysTotal,
    phase: timeline.phase,
    hasGoal: goal !== null,
    progressPercent: goal?.progress.percent ?? null,
  };
}
