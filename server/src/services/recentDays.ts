import type { Challenge } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  challengeDay,
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
  finesTotal: number; // все штрафы участника накопленным итогом на конец этого дня, ₽
  joined: boolean; // в этот день участник вступил
  left: boolean; // в этот день участник вышел
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

const MAX_DAYS = 200;

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
        day: { lte: dayToDate(to) },
      },
      select: { participationId: true, day: true, amount: true },
    }),
  ]);

  const key = (participationId: number, day: DayStr) => `${participationId}|${day}`;
  const subByKey = new Map(submissions.map((s) => [key(s.participationId, dateToDay(s.day)), s]));
  const sickByKey = new Set(sickDays.map((s) => key(s.participationId, dateToDay(s.day))));
  const fineByKey = new Map<string, number>();
  // Штрафы до начала окна: с них начинается накопительный итог участника.
  const finesBefore = new Map<number, number>();
  for (const f of fines) {
    if (!f.participationId || !f.day) continue;
    const day = dateToDay(f.day);
    if (day < from) {
      finesBefore.set(f.participationId, (finesBefore.get(f.participationId) ?? 0) + f.amount);
      continue;
    }
    const k = key(f.participationId, day);
    fineByKey.set(k, (fineByKey.get(k) ?? 0) + f.amount);
  }

  // Накопительный итог штрафов на конец каждого дня окна (считаем по возрастанию дней).
  const finesTotalByKey = new Map<string, number>();
  const running = new Map(filtered.map((p) => [p.id, finesBefore.get(p.id) ?? 0]));
  for (const day of dayRange(from, to)) {
    for (const p of filtered) {
      const total = (running.get(p.id) ?? 0) + (fineByKey.get(key(p.id, day)) ?? 0);
      running.set(p.id, total);
      finesTotalByKey.set(key(p.id, day), total);
    }
  }

  // Границы участия: до вступления и после выхода участника в ленте быть не должно.
  const window = new Map(
    filtered.map((p) => [
      p.id,
      {
        joinDay: challengeDay(p.joinedAt, challenge.timezone),
        leftDay: p.leftAt ? challengeDay(p.leftAt, challenge.timezone) : null,
        active: p.status === 'active',
      },
    ]),
  );

  const days: RecentDay[] = dayRange(from, to)
    .reverse()
    .map((day) => {
      const rows: RecentDayRow[] = [];
      for (const p of filtered) {
        const k = key(p.id, day);
        const sub = subByKey.get(k);
        const sick = sickByKey.has(k);
        const fine = fineByKey.get(k) ?? 0;
        const w = window.get(p.id)!;
        const hasRecord = Boolean(sub) || sick || fine !== 0;
        // День показываем, если в нём что-то есть или участник в этот день
        // числился в челлендже. У старых выходов (до появления leftAt) дата
        // выхода неизвестна — тогда остаются только дни с отметками.
        const inChallenge =
          day >= w.joinDay && (w.leftDay ? day <= w.leftDay : w.active);
        if (!hasRecord && !inChallenge) continue;
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
          fine,
          finesTotal: finesTotalByKey.get(k) ?? 0,
          joined: day === w.joinDay,
          left: day === w.leftDay,
        });
      }
      return { day, dayNumber: challengeDayNumber(startDay, day), rows };
    })
    // Дни, в которых участнику (или всем сразу) нечего показать, пропускаем.
    .filter((d) => d.rows.length > 0);

  return {
    days,
    from,
    to,
    hasMore: from > startDay,
    nextBefore: from,
    participants,
  };
}
