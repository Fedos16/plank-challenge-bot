import type { Challenge, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { challengeDay, dayToDate, dayjs, deadlineInstant, todayDay, type DayStr } from '../../lib/time';
import { WEEK_DAYS } from '../../lib/weeks';
import { challengeEndDay } from '../challenge';
import { displayName } from '../users';
import { goalStartsFrom, type GoalStartChange } from './goals';

export type StartError = 'weeks_already_closed' | 'challenge_finished' | 'start_in_future' | 'start_too_early';

export interface StartedParticipant {
  name: string;
  /**
   * updated — старт цели пересчитан; no_goal — цели ещё нет; no_entries — замеров до старта
   * нет, старт прежний; target_reached — от нового старта цель уже достигнута, оставлена как была;
   * joined_after_start — вступил после дня старта, его старт — замер при вступлении.
   */
  status: 'updated' | 'no_goal' | 'no_entries' | 'target_reached' | 'joined_after_start';
  changes: GoalStartChange[];
}

export interface StartResult {
  startDate: DayStr;
  endDate: DayStr | null;
  participants: StartedParticipant[];
}

/** Самый ранний день, с которого ещё можно начать: первая неделя от него не кончилась к сегодня. */
export function earliestStartDay(today: DayStr): DayStr {
  return dayjs.utc(today).subtract(WEEK_DAYS - 1, 'day').format('YYYY-MM-DD');
}

/**
 * Можно ли начать с дня `day`. Не в будущем: стартовые замеры — взвешивания до старта, а будущих
 * ещё нет. И не раньше, чем неделю назад: первая неделя уже кончилась бы, и планировщик сразу
 * подвёл бы её итог с потерей жизней задним числом.
 */
export function startDayError(day: DayStr, today: DayStr): StartError | null {
  if (day > today) return 'start_in_future';
  if (day < earliestStartDay(today)) return 'start_too_early';
  return null;
}

/**
 * Кнопка «Старт» в админке: челлендж начинается в выбранный день (по умолчанию сегодня), всё
 * до него — пробный период. Его тренировки остаются в журнале без зачёта, итогов и потери
 * жизней за него не будет. Дата окончания не меняется — пересчитывается длительность.
 * Стартовые замеры целей — среднее по взвешиваниям пробной недели, семи дней перед стартом
 * (см. startMetric).
 * День в прошлом нужен, если нажать вовремя забыли: взвешивания после него в старт не идут.
 *
 * Нельзя, если уже есть итоги недель: сдвиг старта переписал бы их задним числом.
 * Повторное нажатие с тем же днём безопасно — пересчитает то же самое заново.
 */
export async function startFitnessChallenge(ch: Challenge, day?: DayStr): Promise<StartResult | StartError> {
  if (await prisma.weekResult.count({ where: { challengeId: ch.id } })) return 'weeks_already_closed';
  const today = todayDay(ch.timezone);
  const endDay = challengeEndDay(ch);
  if (endDay && endDay < today) return 'challenge_finished';
  const startDay = day ?? today;
  const dayError = startDayError(startDay, today);
  if (dayError) return dayError;
  const durationDays = endDay ? dayjs.utc(endDay).diff(dayjs.utc(startDay), 'day') + 1 : null;
  const cutoff = deadlineInstant(startDay, '00:00', ch.timezone);

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
    // Пришёл уже после старта: до него он в челлендже не взвешивался, а старые замеры из других
    // групп подменили бы свежий замер при вступлении.
    if (challengeDay(p.joinedAt, ch.timezone) > startDay) {
      participants.push({ name, status: 'joined_after_start', changes: [] });
      continue;
    }
    const entries = await prisma.weightEntry.findMany({
      where: { userId: p.userId, measuredAt: { lt: cutoff } },
    });
    const changes = goalStartsFrom(goal, entries, cutoff);
    if (!changes) {
      participants.push({ name, status: 'target_reached', changes: [] });
      continue;
    }
    const data: Prisma.ParticipantGoalUpdateInput = { startDay: dayToDate(startDay) };
    for (const c of changes) data[c.field] = c.after;
    goalUpdates.push(prisma.participantGoal.update({ where: { id: goal.id }, data }));
    participants.push({ name, status: changes.length ? 'updated' : 'no_entries', changes });
  }

  await prisma.$transaction([
    prisma.challenge.update({ where: { id: ch.id }, data: { startDate: dayToDate(startDay), durationDays } }),
    ...goalUpdates,
  ]);
  return { startDate: startDay, endDate: endDay, participants };
}
