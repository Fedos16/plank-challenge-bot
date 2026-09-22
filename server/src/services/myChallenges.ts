import { prisma } from '../lib/prisma';
import { challengeDayNumber, dateToDay, todayDay } from '../lib/time';
import { getBank } from './bank';
import { can } from './challenge';
import { getParticipantDayState, type DayState } from './dayStatus';
import { getFitnessSummary, type FitnessSummary } from './fitness/overview';
import { getParticipationStreaks } from './streaks';

export interface MyChallengeSummary {
  id: number;
  key: string;
  kind: string;
  title: string;
  description: string;
  dayNumber: number;
  /** Только для планки: состояние дня, серия и банк. */
  todayState?: DayState;
  currentStreak?: number;
  bank?: number;
  /** Только для фитнес-челленджа: день из скольких и прогресс к личной цели. */
  fitness?: FitnessSummary;
}

/** Сводка по всем активным челленджам, в которых участвует пользователь. */
export async function getMyChallenges(userId: number): Promise<MyChallengeSummary[]> {
  const parts = await prisma.participation.findMany({
    where: { userId, status: 'active', challenge: { isActive: true } },
    include: { challenge: true },
    orderBy: { joinedAt: 'asc' },
  });

  const result: MyChallengeSummary[] = [];
  for (const p of parts) {
    const ch = p.challenge;
    const today = todayDay(ch.timezone);
    const base = {
      id: ch.id,
      key: ch.key,
      kind: ch.kind,
      title: ch.title,
      description: ch.description,
      dayNumber: challengeDayNumber(dateToDay(ch.startDate), today),
    };

    if (can(ch, 'goals')) {
      result.push({ ...base, fitness: await getFitnessSummary(ch, p) });
      continue;
    }

    // Серии, состояние дня и банк есть только у планки
    if (!can(ch, 'dailyCheckin')) {
      result.push(base);
      continue;
    }

    const [streaks, todayState, bank] = await Promise.all([
      getParticipationStreaks(ch, p),
      getParticipantDayState(ch, p.id, today),
      getBank(ch.id),
    ]);
    result.push({ ...base, todayState, currentStreak: streaks.current, bank });
  }
  return result;
}
