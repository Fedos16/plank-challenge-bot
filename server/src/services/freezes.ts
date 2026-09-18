import type { Challenge, Participation } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  challengeDayNumber,
  dateToDay,
  dayRange,
  dayToDate,
  prevDay,
  todayDay,
  type DayStr,
} from '../lib/time';
import { getParticipantDays } from './streaks';
import { getParticipantDayState } from './dayStatus';

/**
 * Заморозка серии.
 *
 * Правила (параметры — в настройках челленджа):
 *  • за каждые `freezeEveryDays` дней подряд участник получает одну заморозку;
 *  • на руках нельзя держать больше `maxFreezes` заморозок;
 *  • потратить заморозку можно только на пропущенный день и только на день
 *    не раньше того, за который она получена;
 *  • тратит заморозку сам участник в личном кабинете.
 *
 * Заработанные заморозки нигде не хранятся — они всегда пересчитываются из истории,
 * поэтому у всех участников (в том числе тех, кто накопил серию до появления фичи)
 * количество заморозок считается автоматически. В базе лежат только потраченные.
 */

export interface FreezeUsage {
  day: DayStr;
  earnedDay: DayStr;
  createdAt: string;
}

export interface FreezeState {
  /** Заморозки включены в настройках челленджа. */
  enabled: boolean;
  everyDays: number;
  max: number;
  /** Сколько заморозок заработано за всю историю. */
  earned: number;
  /** Сколько потрачено. */
  used: number;
  /** Сколько доступно прямо сейчас (с учётом лимита на руках). */
  available: number;
  /** Дни, в которые заморозки были заработаны (по возрастанию). */
  grants: DayStr[];
  /** Потраченные заморозки (свежие сверху). */
  usages: FreezeUsage[];
  /** Сколько дней подряд ещё нужно до следующей заморозки (null — выключено). */
  daysToNext: number | null;
  /** Текущая серия подряд, из которой копится следующая заморозка. */
  runLength: number;
  /** Самый ранний день, на который можно потратить доступную заморозку. */
  earliestUsableDay: DayStr | null;
}

export interface FreezableDay {
  day: DayStr;
  dayNumber: number;
}

export interface FreezeOverview extends FreezeState {
  /** Пропущенные дни, которые сейчас можно заморозить (свежие сверху). */
  freezableDays: FreezableDay[];
}

export type FreezeError =
  | 'freezes_disabled'
  | 'no_freezes_available'
  | 'too_early'
  | 'day_not_missed'
  | 'already_frozen'
  | 'bad_day';

/**
 * Дни, в которые участник заработал заморозки: каждые `everyDays` дней подряд.
 * Больничный (если он замораживает серию) и уже потраченная заморозка серию не рвут,
 * но и не наращивают — как в расчёте серий.
 */
export function computeFreezeGrants(params: {
  doneDays: Set<DayStr>;
  sickDays: Set<DayStr>;
  frozenDays: Set<DayStr>;
  fromDay: DayStr;
  toDay: DayStr;
  today: DayStr;
  freezeOnSick: boolean;
  everyDays: number;
}): { grants: DayStr[]; runLength: number } {
  const { doneDays, sickDays, frozenDays, everyDays } = params;
  if (everyDays <= 0) return { grants: [], runLength: 0 };

  const grants: DayStr[] = [];
  let run = 0;
  for (const d of dayRange(params.fromDay, params.toDay)) {
    if (doneDays.has(d)) {
      run += 1;
      if (run % everyDays === 0) grants.push(d);
    } else if (frozenDays.has(d) || (sickDays.has(d) && params.freezeOnSick)) {
      // серия держится, но не растёт
    } else if (d === params.today) {
      // сегодняшний день ещё не закрыт
    } else {
      run = 0;
    }
  }
  return { grants, runLength: run };
}

/**
 * Можно ли раздать заморозки под все указанные дни: каждому дню нужна своя
 * заморозка, полученная не позже этого дня. Жадная проверка по возрастанию.
 */
function canAssign(grants: DayStr[], usageDays: DayStr[]): boolean {
  if (usageDays.length > grants.length) return false;
  const sorted = [...usageDays].sort();
  return sorted.every((day, i) => grants[i]! <= day);
}

/** Какой именно заморозкой (днём её получения) закрывается день `day`. */
function grantForDay(grants: DayStr[], existingUsages: DayStr[], day: DayStr): DayStr | null {
  const sorted = [...existingUsages, day].sort();
  const index = sorted.indexOf(day);
  return grants[index] ?? null;
}

/** Состояние заморозок участника: заработано / потрачено / доступно. */
export async function getFreezeState(
  challenge: Challenge,
  participation: Participation,
): Promise<FreezeState> {
  const everyDays = challenge.freezeEveryDays;
  const max = challenge.maxFreezes;
  const enabled = everyDays > 0 && max > 0;

  const [days, records] = await Promise.all([
    getParticipantDays(challenge, participation),
    prisma.streakFreeze.findMany({
      where: { participationId: participation.id },
      orderBy: { day: 'desc' },
    }),
  ]);

  const { grants, runLength } = computeFreezeGrants({
    doneDays: days.doneDays,
    sickDays: days.sickDays,
    frozenDays: days.frozenDays,
    fromDay: days.fromDay,
    toDay: days.today,
    today: days.today,
    freezeOnSick: challenge.freezeStreakOnSick,
    everyDays,
  });

  const usages: FreezeUsage[] = records.map((r) => ({
    day: dateToDay(r.day),
    earnedDay: dateToDay(r.earnedDay),
    createdAt: r.createdAt.toISOString(),
  }));

  const earned = grants.length;
  const used = usages.length;
  const available = enabled ? Math.max(0, Math.min(earned - used, max)) : 0;

  // самый ранний день, который ещё можно закрыть оставшейся заморозкой:
  // перебираем дни получения — раздача заморозок монотонна по дате.
  let earliestUsableDay: DayStr | null = null;
  if (available > 0) {
    const usedDays = usages.map((u) => u.day);
    for (const grant of grants) {
      if (canAssign(grants, [...usedDays, grant])) {
        earliestUsableDay = grant;
        break;
      }
    }
  }

  return {
    enabled,
    everyDays,
    max,
    earned,
    used,
    available,
    grants,
    usages,
    daysToNext: enabled ? everyDays - (runLength % everyDays) : null,
    runLength,
    earliestUsableDay,
  };
}

/** Состояние + список пропущенных дней, которые сейчас можно заморозить. */
export async function getFreezeOverview(
  challenge: Challenge,
  participation: Participation,
): Promise<FreezeOverview> {
  const state = await getFreezeState(challenge, participation);
  const freezableDays = state.earliestUsableDay
    ? await listFreezableDays(challenge, participation, state.earliestUsableDay)
    : [];
  return { ...state, freezableDays };
}

/** Пропущенные дни начиная с `fromDay` и до вчерашнего включительно. */
async function listFreezableDays(
  challenge: Challenge,
  participation: Participation,
  fromDay: DayStr,
): Promise<FreezableDay[]> {
  const days = await getParticipantDays(challenge, participation);
  const to = prevDay(days.today);
  if (to < fromDay) return [];

  // любой кружок (в том числе поздний/снятый) и больничный — это не «пропуск»
  const [submissions, sick] = await Promise.all([
    prisma.submission.findMany({
      where: {
        participationId: participation.id,
        day: { gte: dayToDate(fromDay), lte: dayToDate(to) },
      },
      select: { day: true },
    }),
    prisma.sickDay.findMany({
      where: {
        participationId: participation.id,
        status: 'valid',
        day: { gte: dayToDate(fromDay), lte: dayToDate(to) },
      },
      select: { day: true },
    }),
  ]);
  const busy = new Set<DayStr>([
    ...submissions.map((s) => dateToDay(s.day)),
    ...sick.map((s) => dateToDay(s.day)),
    ...days.frozenDays,
  ]);

  const startDay = dateToDay(challenge.startDate);
  return dayRange(fromDay, to)
    .filter((d) => d >= startDay && !busy.has(d))
    .reverse()
    .map((day) => ({ day, dayNumber: challengeDayNumber(startDay, day) }));
}

export type UseFreezeResult =
  | { ok: true; state: FreezeOverview; day: DayStr; earnedDay: DayStr }
  | { ok: false; error: FreezeError; state: FreezeOverview };

/**
 * Потратить заморозку на пропущенный день. Вызывается только из личного кабинета
 * самим участником: серия за этот день не рвётся, штраф за пропуск остаётся.
 */
export async function useFreeze(
  challenge: Challenge,
  participation: Participation,
  day: DayStr,
): Promise<UseFreezeResult> {
  const state = await getFreezeState(challenge, participation);
  const fail = async (error: FreezeError): Promise<UseFreezeResult> => ({
    ok: false,
    error,
    state: await getFreezeOverview(challenge, participation),
  });

  if (!state.enabled) return fail('freezes_disabled');

  const startDay = dateToDay(challenge.startDate);
  const yesterday = prevDay(todayDay(challenge.timezone));
  if (day < startDay || day > yesterday) return fail('bad_day');

  const dayState = await getParticipantDayState(challenge, participation.id, day);
  if (dayState === 'frozen') return fail('already_frozen');
  if (dayState !== 'missed') return fail('day_not_missed');

  if (state.available <= 0) return fail('no_freezes_available');

  const usedDays = state.usages.map((u) => u.day);
  if (!canAssign(state.grants, [...usedDays, day])) return fail('too_early');

  const earnedDay = grantForDay(state.grants, usedDays, day);
  if (!earnedDay) return fail('too_early');

  try {
    await prisma.streakFreeze.create({
      data: {
        challengeId: challenge.id,
        participationId: participation.id,
        day: dayToDate(day),
        earnedDay: dayToDate(earnedDay),
      },
    });
  } catch {
    // гонка: заморозка на этот день уже создана
    return fail('already_frozen');
  }

  return {
    ok: true,
    day,
    earnedDay,
    state: await getFreezeOverview(challenge, participation),
  };
}

/** Снять заморозку с дня (например при ручной правке статуса админом). */
export async function releaseFreeze(participationId: number, day: DayStr): Promise<void> {
  await prisma.streakFreeze.deleteMany({
    where: { participationId, day: dayToDate(day) },
  });
}
