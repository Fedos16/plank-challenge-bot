import { prisma } from '../lib/prisma';
import { challengeDayNumber, dateToDay, todayDay } from '../lib/time';
import { getBank } from './bank';
import { getParticipantDayState, type DayState } from './dayStatus';
import { getParticipationStreaks } from './streaks';

export interface MyChallengeSummary {
  id: number;
  key: string;
  title: string;
  description: string;
  dayNumber: number;
  todayState: DayState;
  currentStreak: number;
  bank: number;
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
    const [streaks, todayState, bank] = await Promise.all([
      getParticipationStreaks(ch, p),
      getParticipantDayState(ch, p.id, today),
      getBank(ch.id),
    ]);
    result.push({
      id: ch.id,
      key: ch.key,
      title: ch.title,
      description: ch.description,
      dayNumber: challengeDayNumber(dateToDay(ch.startDate), today),
      todayState,
      currentStreak: streaks.current,
      bank,
    });
  }
  return result;
}
