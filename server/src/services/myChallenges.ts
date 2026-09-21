import { prisma } from '../lib/prisma';
import { challengeDayNumber, dateToDay, todayDay } from '../lib/time';
import { getBank } from './bank';
import { getParticipantDayState, type DayState } from './dayStatus';
import { getParticipationStreaks } from './streaks';
import { getWeightSummary, type WeightSummary } from './weight';

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
  /** Только для группы взвешиваний: свой вес и динамика. */
  weight?: WeightSummary;
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

    // В группе взвешиваний нет ни дней, ни серий, ни банка — только свой вес
    if (ch.kind === 'weight') {
      result.push({ ...base, weight: await getWeightSummary(userId) });
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
