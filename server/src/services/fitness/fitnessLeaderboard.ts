import type { Challenge, Workout } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { dayjs } from '../../lib/time';
import { displayName } from '../users';
import { classify } from './counting';
import { getGameState } from './evaluation';
import { progressFor, type GoalType } from './goals';
import {
  challengeInstants,
  loadWorkouts,
  rulesOf,
  sessionToWorkoutDTO,
  toWorkoutDTO,
  type WorkoutDTO,
} from './workouts';

export interface FitnessLeaderboardRow {
  participationId: number;
  name: string;
  photoUrl: string | null;
  isMe: boolean;
  livesLeft: number;
  livesTotal: number;
  eliminated: boolean;
  eliminatedAtWeekNumber: number | null;
  /** Текущая неделя: сделано из нормы. null — челлендж не идёт. */
  week: { done: number; required: number } | null;
  /** Выполнение нормы по закрытым неделям, 0..100. Перевыполнение недели не компенсирует провал другой. */
  normPercent: number | null;
  totalCounted: number;
  goalType: GoalType | null;
  progressPercent: number | null;
}

/**
 * У всех разные цели, поэтому общий знаменатель — дисциплина: кто в игре, у кого больше жизней,
 * кто ровнее закрывает норму. Процент к цели — лишь последний тай-брейк.
 */
function compareRows(a: FitnessLeaderboardRow, b: FitnessLeaderboardRow): number {
  if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
  // среди выбывших выше тот, кто продержался дольше
  if (a.eliminated && b.eliminated) {
    const diff = (b.eliminatedAtWeekNumber ?? 0) - (a.eliminatedAtWeekNumber ?? 0);
    if (diff) return diff;
  }
  return (
    b.livesLeft - a.livesLeft ||
    (b.normPercent ?? -1) - (a.normPercent ?? -1) ||
    b.totalCounted - a.totalCounted ||
    (b.progressPercent ?? -1) - (a.progressPercent ?? -1) ||
    a.name.localeCompare(b.name, 'ru')
  );
}

export async function getFitnessLeaderboard(ch: Challenge, meId: number): Promise<FitnessLeaderboardRow[]> {
  const participations = await prisma.participation.findMany({
    where: { challengeId: ch.id, status: 'active' },
    include: { user: true, goal: true },
  });

  const rows: FitnessLeaderboardRow[] = [];
  for (const p of participations) {
    const game = await getGameState(ch, p);
    const entries = p.goal
      ? await prisma.weightEntry.findMany({
          where: { userId: p.userId },
          orderBy: { measuredAt: 'desc' },
          take: 20,
        })
      : [];

    const required = game.history.reduce((sum, w) => sum + w.required, 0);
    const met = game.history.reduce((sum, w) => sum + Math.min(w.done, w.required), 0);

    rows.push({
      participationId: p.id,
      name: displayName(p.user),
      photoUrl: p.user.photoUrl,
      isMe: p.userId === meId,
      livesLeft: game.lives.left,
      livesTotal: game.lives.total,
      eliminated: game.lives.eliminated,
      eliminatedAtWeekNumber: game.lives.eliminatedAtWeekNumber,
      week: game.currentWeek ? { done: game.currentWeek.done, required: game.currentWeek.required } : null,
      normPercent: required > 0 ? Math.round((met / required) * 100) : null,
      totalCounted: game.totalCounted,
      goalType: (p.goal?.goalType as GoalType | undefined) ?? null,
      progressPercent: p.goal ? progressFor(p.goal, entries).percent : null,
    });
  }
  return rows.sort(compareRows);
}

export interface FeedItem extends WorkoutDTO {
  name: string;
  isMe: boolean;
}

/** За сколько дней показываем общую ленту и сколько в ней записей. */
const FEED_DAYS = 14;
const FEED_LIMIT = 40;

/** Общая лента: тренировки видны всей группе — тип, длительность, ккал и откуда запись. */
export async function getFitnessFeed(ch: Challenge, meId: number): Promise<FeedItem[]> {
  const participations = await prisma.participation.findMany({
    where: { challengeId: ch.id, status: 'active' },
    include: { user: true },
  });
  const period = challengeInstants(ch);
  const since = dayjs().subtract(FEED_DAYS, 'day').toDate();
  const from = since > period.from ? since : period.from;

  const items: FeedItem[] = [];
  for (const p of participations) {
    const workouts = await loadWorkouts(p.userId, from, period.to);
    const { verdicts, sessions } = classify(workouts, rulesOf(ch));
    const byId = new Map(workouts.map((w) => [w.id, w]));
    const isMe = p.userId === meId;
    const name = displayName(p.user);
    // заметка личная: мало ли что человек записал для себя
    const withAuthor = (dto: WorkoutDTO): FeedItem => ({ ...dto, note: isMe ? dto.note : null, name, isMe });

    // Занятие — одна строка, даже если источник разрезал его по видам активности
    for (const session of sessions) {
      const segments = session.workoutIds
        .map((id) => byId.get(id))
        .filter((w): w is Workout => w !== undefined);
      const dto = sessionToWorkoutDTO(segments, session);
      if (dto) items.push(withAuthor(dto));
    }
    // Снятые админом в сессии не входят, но в ленте видны: группа должна понимать, что
    // случилось с тренировкой. Дубли не показываем — это та же тренировка из второго источника.
    for (const w of workouts) {
      if (verdicts.get(w.id) === 'excluded') items.push(withAuthor(toWorkoutDTO(w, 'excluded')));
    }
  }
  return items.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, FEED_LIMIT);
}
