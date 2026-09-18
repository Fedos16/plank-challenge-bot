import type { Challenge, Participation } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  challengeDay,
  dateToDay,
  dayRange,
  todayDay,
  type DayStr,
} from '../lib/time';

export interface StreakResult {
  current: number;
  max: number;
}

/**
 * Чистый расчёт серий по множествам дней.
 * sick (валидный) при freeze=true «замораживает» серию (не обнуляет и не наращивает),
 * потраченная заморозка (frozenDays) — всегда.
 * Незавершённый сегодняшний день (нет ни done, ни sick) не обрывает текущую серию.
 */
export function computeStreaks(
  doneDays: Set<DayStr>,
  sickDays: Set<DayStr>,
  fromDay: DayStr,
  toDay: DayStr,
  freeze: boolean,
  today: DayStr,
  frozenDays: Set<DayStr> = new Set(),
): StreakResult {
  const days = dayRange(fromDay, toDay);

  // текущая серия — с конца назад
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i]!;
    if (doneDays.has(d)) {
      current++;
    } else if (frozenDays.has(d)) {
      continue;
    } else if (sickDays.has(d) && freeze) {
      continue;
    } else if (d === today) {
      // сегодня ещё не закрыт — не обрываем серию
      continue;
    } else {
      break;
    }
  }

  // максимальная серия — проходом вперёд
  let max = 0;
  let run = 0;
  for (const d of days) {
    if (doneDays.has(d)) {
      run++;
      if (run > max) max = run;
    } else if (frozenDays.has(d) || (sickDays.has(d) && freeze)) {
      // заморозка — серия не растёт и не рвётся
    } else if (d === today) {
      // сегодня ещё не закрыт
    } else {
      run = 0;
    }
  }

  return { current, max };
}

export interface ParticipantDays {
  doneDays: Set<DayStr>;
  sickDays: Set<DayStr>;
  frozenDays: Set<DayStr>;
  /** С какого дня считать историю участника. */
  fromDay: DayStr;
  today: DayStr;
}

/**
 * История участника в виде множеств дней — общая основа для серий и заморозок.
 */
export async function getParticipantDays(
  challenge: Challenge,
  participation: Participation,
): Promise<ParticipantDays> {
  const tz = challenge.timezone;
  const startDay = dateToDay(challenge.startDate);
  const joinedDay = challengeDay(participation.joinedAt, tz);
  const today = todayDay(tz);

  const [submissions, sick, frozen] = await Promise.all([
    prisma.submission.findMany({
      where: { participationId: participation.id, status: 'counted' },
      select: { day: true },
    }),
    prisma.sickDay.findMany({
      where: { participationId: participation.id, status: 'valid' },
      select: { day: true },
    }),
    prisma.streakFreeze.findMany({
      where: { participationId: participation.id },
      select: { day: true },
    }),
  ]);

  const doneDays = new Set(submissions.map((s) => dateToDay(s.day)));
  const sickDays = new Set(sick.map((s) => dateToDay(s.day)));
  const frozenDays = new Set(frozen.map((s) => dateToDay(s.day)));

  // обычно считаем с момента вступления/старта; но если есть более ранняя реальная
  // активность (бэкфилл истории), расширяем начало назад, чтобы серия её учла
  let fromDay = joinedDay > startDay ? joinedDay : startDay;
  for (const d of doneDays) if (d < fromDay) fromDay = d;
  for (const d of sickDays) if (d < fromDay) fromDay = d;
  for (const d of frozenDays) if (d < fromDay) fromDay = d;

  return { doneDays, sickDays, frozenDays, fromDay, today };
}

/** Расчёт серий участника из БД (с учётом даты вступления и старта челленджа). */
export async function getParticipationStreaks(
  challenge: Challenge,
  participation: Participation,
): Promise<StreakResult> {
  const days = await getParticipantDays(challenge, participation);
  return computeStreaks(
    days.doneDays,
    days.sickDays,
    days.fromDay,
    days.today,
    challenge.freezeStreakOnSick,
    days.today,
    days.frozenDays,
  );
}
