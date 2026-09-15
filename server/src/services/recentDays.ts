import type { Challenge } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  challengeDayNumber,
  dateToDay,
  dayRange,
  dayToDate,
  dayjs,
  prevDay,
  todayDay,
  type DayStr,
} from '../lib/time';
import { displayName } from './users';
import type { DayState } from './dayStatus';

export interface RecentDayRow {
  participationId: number;
  name: string;
  status: string; // active | left
  state: DayState;
  submittedAt: Date | null;
  videoDuration: number | null;
  fine: number; // начисленный за этот день штраф, ₽
}

export interface RecentDay {
  day: DayStr;
  dayNumber: number;
  rows: RecentDayRow[];
}

export interface RecentDaysOptions {
  /** Сколько дней показать (по умолчанию 10). */
  days?: number;
  /** Показать дни строго раньше этой даты (пагинация «показать ещё»). */
  before?: DayStr;
  /** Ограничить одним участником. */
  participationId?: number;
}

export interface RecentDaysResult {
  days: RecentDay[];
  from: DayStr | null;
  to: DayStr | null;
  /** Есть ли ещё более ранние дни челленджа. */
  hasMore: boolean;
  /** Значение для следующего запроса (`before`). */
  nextBefore: DayStr | null;
  participants: { participationId: number; name: string; status: string }[];
}

const MAX_DAYS = 60;

function mapSubmissionStatus(status: string): DayState {
  switch (status) {
    case 'counted':
      return 'done';
    case 'late':
      return 'late';
    case 'fake':
      return 'fake';
    case 'rejected':
      return 'rejected';
    default:
      return 'missed';
  }
}

/**
 * Лента последних дней челленджа: по каждому дню — состояние всех участников.
 * Заменяет ручной выбор даты в админке: сразу видно свежие события, при
 * необходимости можно догрузить более ранние дни и отфильтровать по участнику.
 */
export async function getRecentDays(
  challenge: Challenge,
  options: RecentDaysOptions = {},
): Promise<RecentDaysResult> {
  const count = Math.min(Math.max(Math.trunc(options.days ?? 10), 1), MAX_DAYS);
  const startDay = dateToDay(challenge.startDate);
  const today = todayDay(challenge.timezone);

  // Верхняя граница: сегодня либо день перед уже показанным окном.
  let to = options.before ? prevDay(options.before) : today;
  if (to > today) to = today;

  const participations = await prisma.participation.findMany({
    where: { challengeId: challenge.id },
    include: { user: true },
    orderBy: { joinedAt: 'asc' },
  });
  const participants = participations.map((p) => ({
    participationId: p.id,
    name: displayName(p.user),
    status: p.status,
  }));

  const empty: RecentDaysResult = {
    days: [],
    from: null,
    to: null,
    hasMore: false,
    nextBefore: null,
    participants,
  };
  if (to < startDay) return empty;

  const from = (() => {
    const candidate = dayjs(to).subtract(count - 1, 'day').format('YYYY-MM-DD');
    return candidate < startDay ? startDay : candidate;
  })();

  const filtered = options.participationId
    ? participations.filter((p) => p.id === options.participationId)
    : participations;
  if (!filtered.length) return { ...empty, from, to, hasMore: from > startDay, nextBefore: from };

  const partIds = filtered.map((p) => p.id);
  const dayFilter = { gte: dayToDate(from), lte: dayToDate(to) };

  const [submissions, sickDays, fines] = await Promise.all([
    prisma.submission.findMany({
      where: { challengeId: challenge.id, participationId: { in: partIds }, day: dayFilter },
    }),
    prisma.sickDay.findMany({
      where: {
        challengeId: challenge.id,
        participationId: { in: partIds },
        day: dayFilter,
        status: 'valid',
      },
    }),
    prisma.ledgerEntry.findMany({
      where: {
        challengeId: challenge.id,
        participationId: { in: partIds },
        type: { in: ['miss', 'fake'] },
        day: dayFilter,
      },
      select: { participationId: true, day: true, amount: true },
    }),
  ]);

  const key = (participationId: number, day: DayStr) => `${participationId}|${day}`;
  const subByKey = new Map(submissions.map((s) => [key(s.participationId, dateToDay(s.day)), s]));
  const sickByKey = new Set(sickDays.map((s) => key(s.participationId, dateToDay(s.day))));
  const fineByKey = new Map<string, number>();
  for (const f of fines) {
    if (!f.participationId || !f.day) continue;
    const k = key(f.participationId, dateToDay(f.day));
    fineByKey.set(k, (fineByKey.get(k) ?? 0) + f.amount);
  }

  const days: RecentDay[] = dayRange(from, to)
    .reverse()
    .map((day) => {
      const rows: RecentDayRow[] = [];
      for (const p of filtered) {
        const k = key(p.id, day);
        const sub = subByKey.get(k);
        const sick = sickByKey.has(k);
        // Вышедших участников показываем только в те дни, где у них есть отметка,
        // иначе лента заполняется их «пропусками» задним числом.
        if (p.status !== 'active' && !sub && !sick) continue;
        let state: DayState;
        if (sub) state = mapSubmissionStatus(sub.status);
        else if (sick) state = 'sick';
        else if (day >= today) state = 'pending';
        else state = 'missed';
        rows.push({
          participationId: p.id,
          name: displayName(p.user),
          status: p.status,
          state,
          submittedAt: sub?.submittedAt ?? null,
          videoDuration: sub?.videoDuration ?? null,
          fine: fineByKey.get(k) ?? 0,
        });
      }
      return { day, dayNumber: challengeDayNumber(startDay, day), rows };
    });

  return {
    days,
    from,
    to,
    hasMore: from > startDay,
    nextBefore: from,
    participants,
  };
}
