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
 * sick (валидный) при freeze=true «замораживает» серию (не обнуляет и не наращивает).
 * Незавершённый сегодняшний день (нет ни done, ни sick) не обрывает текущую серию.
 */
export function computeStreaks(
  doneDays: Set<DayStr>,
  sickDays: Set<DayStr>,
  fromDay: DayStr,
  toDay: DayStr,
  freeze: boolean,
  today: DayStr,
): StreakResult {
  const days = dayRange(fromDay, toDay);

  // текущая серия — с конца назад
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i]!;
    if (doneDays.has(d)) {
      current++;
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
    } else if (sickDays.has(d) && freeze) {
      // заморозка — серия не растёт и не рвётся
    } else if (d === today) {
      // сегодня ещё не закрыт
    } else {
      run = 0;
    }
  }

  return { current, max };
}

/** Расчёт серий участника из БД (с учётом даты вступления и старта челленджа). */
export async function getParticipationStreaks(
  challenge: Challenge,
  participation: Participation,
): Promise<StreakResult> {
  const tz = challenge.timezone;
  const startDay = dateToDay(challenge.startDate);
  const joinedDay = challengeDay(participation.joinedAt, tz);
  const fromDay = joinedDay > startDay ? joinedDay : startDay;
  const today = todayDay(tz);

  const submissions = await prisma.submission.findMany({
    where: { participationId: participation.id, status: 'counted' },
    select: { day: true },
  });
  const sick = await prisma.sickDay.findMany({
    where: { participationId: participation.id, status: 'valid' },
    select: { day: true },
  });

  const doneDays = new Set(submissions.map((s) => dateToDay(s.day)));
  const sickDays = new Set(sick.map((s) => dateToDay(s.day)));

  return computeStreaks(doneDays, sickDays, fromDay, today, challenge.freezeStreakOnSick, today);
}
