import type { Challenge, ParticipantGoal, WeightEntry } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { dateToDay, dayRange, todayDay, type DayStr } from '../../lib/time';
import { weekIndexOf, weekRange, type DayWindow } from '../../lib/weeks';
import { challengeEndDay, challengeTimeline } from '../challenge';
import { displayName } from '../users';
import { computeWeek, livesOf, type WeekDayDTO } from './evaluation';
import { progressFor, type GoalType, type MuscleUnit } from './goals';
import { windowInstants } from './workouts';

/**
 * passed — норма закрыта (в идущей неделе — уже набрана); failed — не закрыта; forgiven —
 * не закрыта, но прощена; in_progress — неделя идёт, норма ещё не набрана; out — вне зачёта.
 */
export type ReportStatus = 'passed' | 'failed' | 'forgiven' | 'in_progress' | 'out';

export interface WeekReportRow {
  participationId: number;
  name: string;
  photoUrl: string | null;
  isMe: boolean;
  done: number;
  required: number;
  status: ReportStatus;
  /** Жизнь потеряна именно на этой неделе. */
  lifeLost: boolean;
  /** На этой неделе жизни кончились. */
  eliminatedHere: boolean;
  /** После этой недели; у идущей — сейчас. */
  livesLeft: number;
  livesTotal: number;
  days: WeekDayDTO[];
  minutes: number;
  kcal: number;
  goalType: GoalType | null;
  /** Прогресс к цели; null — цели нет или она свободная (без показателя). */
  goal: GoalWeek | null;
}

/** Цель участника в отчёте: где он сейчас и насколько сдвинулся за неделю. */
export interface GoalWeek {
  /** Пройдено пути от старта до цели, 0..100 — на конец недели (у идущей — на сейчас). */
  percent: number | null;
  /** Сдвиг за неделю в процентах пути; отрицательный — отдалился от цели. */
  deltaPercent: number | null;
  /** Тот же сдвиг в единицах показателя. Только если человек сам открыл свои цифры. */
  delta: number | null;
  unit: MuscleUnit | null;
}

export interface WeekReport {
  challenge: { id: number; title: string; timezone: string };
  week: {
    number: number;
    start: DayStr;
    end: DayStr;
    /** current — идёт; ended — кончилась, итог ещё не подведён; closed — подведён. */
    state: 'current' | 'ended' | 'closed';
    /** Сколько дней осталось, считая сегодня; только у идущей. */
    daysLeft: number | null;
  };
  /** Сколько недель можно листать: от первой до текущей (или последней у завершённого). */
  weeksAvailable: number;
  rows: WeekReportRow[];
  totals: { workouts: number; minutes: number; kcal: number; passed: number; inGame: number };
}

export type WeekReportError = 'bad_week' | 'not_started';

/**
 * Сдвиг к цели за неделю: прогресс на конец недели против прогресса на её начало. Процент пути
 * виден всем (как на экране прогресса), изменение в кг и % — только если цифры открыты.
 * Сдвиг не обрезается нулём: отдалился от цели — будет минус, а не «0%».
 */
function goalWeekOf(
  goal: ParticipantGoal,
  entries: WeightEntry[],
  week: DayWindow,
  bounds: { from: Date; to: Date },
  open: boolean,
): GoalWeek | null {
  // цель поставили уже после этой недели — сдвигаться было не к чему
  if (goal.startDay !== null && dateToDay(goal.startDay) > week.end) return null;
  const end = progressFor(goal, entries.filter((e) => e.measuredAt < bounds.to));
  if (!end.metric) return null;

  // цель поставлена на этой неделе — отсчёт от её стартового замера
  const startedHere = goal.startDay !== null && dateToDay(goal.startDay) >= week.start;
  const base = startedHere ? end.start : progressFor(goal, entries.filter((e) => e.measuredAt < bounds.from)).current;

  const delta = end.current !== null && base !== null ? end.current - base : null;
  const path = end.start !== null && end.target !== null ? end.target - end.start : 0;
  return {
    percent: end.percent,
    // от точного сдвига, а не округлённого: иначе у цели этой недели 32% и «+33% за неделю»
    deltaPercent: delta !== null && path !== 0 ? Math.round((delta / path) * 100) : null,
    delta: open && delta !== null ? Math.round(delta * 10) / 10 : null,
    unit: end.unit,
  };
}

/** Индекс недели, которая идёт сейчас, а у завершённого челленджа — последней. */
export function lastWeekIndex(ch: Challenge): number {
  const endDay = challengeEndDay(ch);
  const today = todayDay(ch.timezone);
  return weekIndexOf(dateToDay(ch.startDate), endDay && endDay < today ? endDay : today);
}

/**
 * Отчёт недели для всех, у кого есть ссылка: те же сведения, что текстовая сводка в чате, —
 * тренировки, жизни и процент к цели. Вес, замеры и еда сюда не попадают.
 * Данные живые: у идущей недели — на сейчас, у закрытой — официальный итог и текущие тренировки.
 */
export async function getWeekReport(
  ch: Challenge,
  meId: number,
  weekNumber?: number,
): Promise<WeekReport | WeekReportError> {
  const timeline = challengeTimeline(ch);
  if (timeline.phase === 'upcoming') return 'not_started';

  const startDay = dateToDay(ch.startDate);
  const endDay = challengeEndDay(ch);
  const today = todayDay(ch.timezone);
  const lastIndex = lastWeekIndex(ch);

  const weekIndex = weekNumber === undefined ? lastIndex : weekNumber - 1;
  if (!Number.isInteger(weekIndex) || weekIndex < 0 || weekIndex > lastIndex) return 'bad_week';
  const week = weekRange(startDay, weekIndex, endDay);
  if (!week) return 'bad_week';

  const participations = await prisma.participation.findMany({
    where: { challengeId: ch.id, status: 'active' },
    include: { user: { include: { bodyProfile: true } }, goal: true },
  });
  const results = await prisma.weekResult.findMany({ where: { challengeId: ch.id } });
  const running = week.end >= today;
  const bounds = windowInstants(week, ch.timezone);

  const rows: WeekReportRow[] = [];
  for (const p of participations) {
    const c = await computeWeek(ch, p, weekIndex);
    if (!c) continue; // вступил уже после этой недели

    const mine = results.filter((r) => r.participationId === p.id);
    const official = mine.find((r) => r.weekIndex === weekIndex);
    const lives = livesOf(ch, mine);
    const state = lives.weeks.find((w) => w.weekIndex === weekIndex);
    // выбыл до этой недели — дальше вне зачёта
    const outBefore = lives.eliminatedAtWeek !== null && lives.eliminatedAtWeek < weekIndex;

    const done = official?.done ?? c.done;
    const required = official?.required ?? c.required;
    let status: ReportStatus;
    if (outBefore || state?.outOfGame) status = 'out';
    else if (official) status = official.passed ? 'passed' : official.forgiven ? 'forgiven' : 'failed';
    else status = done >= required ? 'passed' : running ? 'in_progress' : 'failed';

    const byId = new Map(c.workouts.map((w) => [w.id, w]));
    let kcal = 0;
    for (const s of c.counted) for (const id of s.workoutIds) kcal += byId.get(id)?.kcal ?? 0;

    // замеры до конца недели: по ним прогресс на её начало и на конец
    const entries = p.goal
      ? await prisma.weightEntry.findMany({
          where: { userId: p.userId, measuredAt: { lt: bounds.to } },
          orderBy: { measuredAt: 'desc' },
          take: 60,
        })
      : [];
    const open = p.userId === meId || p.user.bodyProfile?.shareBody === true;

    rows.push({
      participationId: p.id,
      name: displayName(p.user),
      photoUrl: p.user.photoUrl,
      isMe: p.userId === meId,
      done,
      required,
      status,
      lifeLost: state?.lifeLost ?? false,
      eliminatedHere: lives.eliminatedAtWeek === weekIndex,
      livesLeft: state?.livesAfter ?? lives.left,
      livesTotal: lives.total,
      days: dayRange(week.start, week.end).map((day) => ({
        day,
        count: c.byDay.get(day) ?? 0,
        isToday: day === today,
        isFuture: day > today,
        inWindow: day >= c.window.start && day <= c.window.end,
      })),
      minutes: Math.round(c.counted.reduce((sum, s) => sum + s.durationSec, 0) / 60),
      kcal,
      goalType: (p.goal?.goalType as GoalType | undefined) ?? null,
      goal: p.goal ? goalWeekOf(p.goal, entries, week, bounds, open) : null,
    });
  }

  // Кто в игре — выше; дальше больше тренировок, больше жизней, больше минут
  rows.sort(
    (a, b) =>
      Number(a.status === 'out') - Number(b.status === 'out') ||
      b.done - a.done ||
      b.livesLeft - a.livesLeft ||
      b.minutes - a.minutes ||
      a.name.localeCompare(b.name, 'ru'),
  );

  const inGame = rows.filter((r) => r.status !== 'out');
  const evaluated = results.some((r) => r.weekIndex === weekIndex);
  return {
    challenge: { id: ch.id, title: ch.title, timezone: ch.timezone },
    week: {
      number: weekIndex + 1,
      start: week.start,
      end: week.end,
      state: running ? 'current' : evaluated ? 'closed' : 'ended',
      daysLeft: running ? dayRange(today, week.end).length : null,
    },
    weeksAvailable: lastIndex + 1,
    rows,
    totals: {
      workouts: rows.reduce((sum, r) => sum + r.done, 0),
      minutes: rows.reduce((sum, r) => sum + r.minutes, 0),
      kcal: rows.reduce((sum, r) => sum + r.kcal, 0),
      passed: inGame.filter((r) => r.status === 'passed').length,
      inGame: inGame.length,
    },
  };
}

