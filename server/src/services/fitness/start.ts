import type { Challenge, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { dayToDate, dayjs, deadlineInstant, todayDay, type DayStr } from '../../lib/time';
import { challengeEndDay } from '../challenge';
import { displayName } from '../users';
import { goalStartsFrom, type GoalStartChange } from './goals';

export type StartError = 'weeks_already_closed' | 'challenge_finished';

export interface StartedParticipant {
  name: string;
  /**
   * updated — старт цели пересчитан; no_goal — цели ещё нет; no_entries — замеров до старта
   * нет, старт прежний; target_reached — от нового старта цель уже достигнута, оставлена как была.
   */
  status: 'updated' | 'no_goal' | 'no_entries' | 'target_reached';
  changes: GoalStartChange[];
}

export interface StartResult {
  startDate: DayStr;
  endDate: DayStr | null;
  participants: StartedParticipant[];
}

/**
 * Кнопка «Старт» в админке: челлендж начинается сегодня, всё до этого — пробный период.
 * Его тренировки остаются в журнале без зачёта, итогов и потери жизней за него не будет.
 * Дата окончания не меняется — пересчитывается длительность. Стартовые замеры целей —
 * среднее по взвешиваниям до сегодняшнего дня (см. goalStartsFrom).
 *
 * Нельзя, если уже есть итоги недель: сдвиг старта переписал бы их задним числом.
 * Повторное нажатие в тот же день безопасно — пересчитает то же самое заново.
 */
export async function startFitnessChallenge(ch: Challenge): Promise<StartResult | StartError> {
  if (await prisma.weekResult.count({ where: { challengeId: ch.id } })) return 'weeks_already_closed';
  const today = todayDay(ch.timezone);
  const endDay = challengeEndDay(ch);
  if (endDay && endDay < today) return 'challenge_finished';
  const durationDays = endDay ? dayjs.utc(endDay).diff(dayjs.utc(today), 'day') + 1 : null;
  const cutoff = deadlineInstant(today, '00:00', ch.timezone);

  const participations = await prisma.participation.findMany({
    where: { challengeId: ch.id, status: 'active' },
    include: { user: true, goal: true },
    orderBy: { joinedAt: 'asc' },
  });
  const participants: StartedParticipant[] = [];
  const goalUpdates: Prisma.PrismaPromise<unknown>[] = [];
  for (const p of participations) {
    const name = displayName(p.user);
    const goal = p.goal;
    if (!goal) {
      participants.push({ name, status: 'no_goal', changes: [] });
      continue;
    }
    const entries = await prisma.weightEntry.findMany({
      where: { userId: p.userId, measuredAt: { lt: cutoff } },
    });
    const changes = goalStartsFrom(goal, entries);
    if (!changes) {
      participants.push({ name, status: 'target_reached', changes: [] });
      continue;
    }
    const data: Prisma.ParticipantGoalUpdateInput = { startDay: dayToDate(today) };
    for (const c of changes) data[c.field] = c.after;
    goalUpdates.push(prisma.participantGoal.update({ where: { id: goal.id }, data }));
    participants.push({ name, status: changes.length ? 'updated' : 'no_entries', changes });
  }

  await prisma.$transaction([
    prisma.challenge.update({ where: { id: ch.id }, data: { startDate: dayToDate(today), durationDays } }),
    ...goalUpdates,
  ]);
  return { startDate: today, endDate: endDay, participants };
}
