import type { Challenge, Participation, User, WeekResult } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { challengeDay, dateToDay, dayRange, dayToDate, todayDay, type DayStr } from '../../lib/time';
import {
  clampWindow,
  closedWeekIndexes,
  requiredFor,
  weekIndexOf,
  weekRange,
  type DayWindow,
} from '../../lib/weeks';
import { challengeEndDay, challengeTimeline } from '../challenge';
import { countInWindow } from './counting';
import { replayLives, weeksToForgiveForReinstate, type LivesState } from './lives';
import { loadWorkouts, rulesOf, windowInstants } from './workouts';

export interface WeekComputation {
  /** Окно участника: вступивший посреди недели отвечает только за остаток. */
  window: DayWindow;
  /** Полная неделя челленджа — для показа границ. */
  week: DayWindow;
  required: number;
  done: number;
  passed: boolean;
  byDay: Map<DayStr, number>;
}

/** Итог недели участника по текущим данным. null — недели нет или участник вступил после неё. */
export async function computeWeek(
  ch: Challenge,
  participation: Participation,
  weekIndex: number,
): Promise<WeekComputation | null> {
  const week = weekRange(dateToDay(ch.startDate), weekIndex, challengeEndDay(ch));
  if (!week) return null;
  const window = clampWindow(week, challengeDay(participation.joinedAt, ch.timezone));
  if (!window) return null;

  // Норма — по окну участия: вступивший посреди недели отвечает только за остаток.
  // Зачёт — по всей неделе челленджа. Тренировка, сделанная до того, как человек нажал
  // «вступить», настоящая, и терять её нельзя: данные с часов приходят за прошлые дни,
  // а в приложение заходят позже. Иначе тренировка в день старта пропадала у всех,
  // кто присоединился на следующий день.
  const { from, to } = windowInstants(week, ch.timezone);
  const workouts = await loadWorkouts(participation.userId, from, to);
  const { done, byDay } = countInWindow(workouts, rulesOf(ch), week);
  const required = requiredFor(ch.weeklyWorkouts, window.days);
  return { window, week, required, done, passed: done >= required, byDay };
}

export type CreatedWeekResult = WeekResult & { participation: Participation & { user: User } };

/**
 * Подводит итоги всех закрытых недель, по которым ещё нет записи. Идемпотентно (уникальный
 * индекс по участию и неделе) и догоняет простой: после недели без сервера создаст все
 * пропущенные итоги разом. Выбывшим строки тоже пишутся — чтобы прощение могло их вернуть.
 */
export async function evaluateClosedWeeks(
  ch: Challenge,
  opts: { now?: Date } = {},
): Promise<CreatedWeekResult[]> {
  const indexes = closedWeekIndexes({
    startDay: dateToDay(ch.startDate),
    endDay: challengeEndDay(ch),
    now: opts.now ?? new Date(),
    tz: ch.timezone,
    closeTime: ch.weekCloseTime,
  });
  if (indexes.length === 0) return [];

  const participations = await prisma.participation.findMany({
    where: { challengeId: ch.id, status: 'active' },
    include: { user: true },
  });
  const existing = await prisma.weekResult.findMany({
    where: { challengeId: ch.id },
    select: { participationId: true, weekIndex: true },
  });
  const have = new Set(existing.map((r) => `${r.participationId}:${r.weekIndex}`));

  const created: CreatedWeekResult[] = [];
  for (const p of participations) {
    for (const weekIndex of indexes) {
      if (have.has(`${p.id}:${weekIndex}`)) continue;
      const c = await computeWeek(ch, p, weekIndex);
      if (!c) continue;
      try {
        const row = await prisma.weekResult.create({
          data: {
            challengeId: ch.id,
            participationId: p.id,
            weekIndex,
            weekStart: dayToDate(c.week.start),
            weekEnd: dayToDate(c.week.end),
            required: c.required,
            done: c.done,
            passed: c.passed,
          },
        });
        created.push({ ...row, participation: p });
      } catch {
        // параллельный прогон уже записал эту неделю — уникальный индекс не дал задвоить
      }
    }
  }
  return created;
}

export interface UpgradedWeek {
  challenge: Challenge;
  user: User;
  row: WeekResult;
  /** Неделя стоила жизни — значит, жизнь вернулась (прощённая её и так не снимала). */
  lifeReturned: boolean;
}

/**
 * Исправляет провал закрытой недели, если норму закрыла тренировка, досинхронизировавшаяся
 * с устройства уже после подведения итога: телефон был без сети, браслет разрядился.
 * Только в сторону «провал → зачёт» и только для автоматических источников — ручная запись
 * задним числом итог не меняет, иначе его можно было бы переписать, дорисовав тренировку.
 */
export async function upgradeClosedWeeks(userId: number, startedAts: Date[]): Promise<UpgradedWeek[]> {
  if (startedAts.length === 0) return [];
  const participations = await prisma.participation.findMany({
    where: { userId, status: 'active', challenge: { isActive: true, kind: 'fitness' } },
    include: { challenge: true, user: true },
  });

  const upgraded: UpgradedWeek[] = [];
  for (const p of participations) {
    const ch = p.challenge;
    const startDay = dateToDay(ch.startDate);
    const indexes = [...new Set(startedAts.map((at) => weekIndexOf(startDay, challengeDay(at, ch.timezone))))];
    const failed = await prisma.weekResult.findMany({
      where: { participationId: p.id, weekIndex: { in: indexes }, passed: false },
    });

    for (const row of failed) {
      const c = await computeWeek(ch, p, row.weekIndex);
      if (!c?.passed) continue;
      const saved = await prisma.weekResult.update({
        where: { id: row.id },
        data: { done: c.done, required: c.required, passed: true, upgradedAt: new Date() },
      });
      upgraded.push({ challenge: ch, user: p.user, row: saved, lifeReturned: !row.forgiven });
    }
  }
  return upgraded;
}

// ---------- состояние участника ----------

export type WeekStatus = 'passed' | 'failed' | 'forgiven';

export interface WeekHistoryDTO {
  id: number;
  weekNumber: number;
  start: DayStr;
  end: DayStr;
  required: number;
  done: number;
  status: WeekStatus;
  lifeLost: boolean;
  outOfGame: boolean;
  forgivenNote: string | null;
  /** Провал исправлен опоздавшей синхронизацией с устройства. */
  upgraded: boolean;
}

export interface CurrentWeekDTO {
  weekNumber: number;
  start: DayStr;
  end: DayStr;
  required: number;
  done: number;
  /** Все дни недели челленджа: для полоски на экране. */
  days: { day: DayStr; count: number; isToday: boolean; isFuture: boolean; inWindow: boolean }[];
}

export interface GameStateDTO {
  lives: Pick<LivesState, 'total' | 'left' | 'eliminated'> & { eliminatedAtWeekNumber: number | null };
  currentWeek: CurrentWeekDTO | null;
  history: WeekHistoryDTO[];
  /** Засчитанных тренировок за весь челлендж: закрытые недели плюс текущая. */
  totalCounted: number;
}

function statusOf(r: WeekResult): WeekStatus {
  if (r.passed) return 'passed';
  return r.forgiven ? 'forgiven' : 'failed';
}

export function livesOf(ch: Challenge, results: WeekResult[]): LivesState {
  return replayLives(
    results.map((r) => ({ weekIndex: r.weekIndex, passed: r.passed, forgiven: r.forgiven })),
    ch.lives,
  );
}

async function currentWeekOf(ch: Challenge, participation: Participation): Promise<CurrentWeekDTO | null> {
  if (challengeTimeline(ch).phase !== 'running') return null;
  const today = todayDay(ch.timezone);
  const weekIndex = weekIndexOf(dateToDay(ch.startDate), today);
  const c = await computeWeek(ch, participation, weekIndex);
  if (!c) return null;

  return {
    weekNumber: weekIndex + 1,
    start: c.week.start,
    end: c.week.end,
    required: c.required,
    done: c.done,
    days: dayRange(c.week.start, c.week.end).map((day) => ({
      day,
      count: c.byDay.get(day) ?? 0,
      isToday: day === today,
      isFuture: day > today,
      inWindow: day >= c.window.start && day <= c.window.end,
    })),
  };
}

export async function getGameState(ch: Challenge, participation: Participation): Promise<GameStateDTO> {
  const results = await prisma.weekResult.findMany({
    where: { participationId: participation.id },
    orderBy: { weekIndex: 'asc' },
  });
  const lives = livesOf(ch, results);
  const lifeByWeek = new Map(lives.weeks.map((w) => [w.weekIndex, w]));
  const currentWeek = await currentWeekOf(ch, participation);

  return {
    lives: {
      total: lives.total,
      left: lives.left,
      eliminated: lives.eliminated,
      eliminatedAtWeekNumber: lives.eliminatedAtWeek === null ? null : lives.eliminatedAtWeek + 1,
    },
    currentWeek,
    history: results
      .map((r) => ({
        id: r.id,
        weekNumber: r.weekIndex + 1,
        start: dateToDay(r.weekStart),
        end: dateToDay(r.weekEnd),
        required: r.required,
        done: r.done,
        status: statusOf(r),
        lifeLost: lifeByWeek.get(r.weekIndex)?.lifeLost ?? false,
        outOfGame: lifeByWeek.get(r.weekIndex)?.outOfGame ?? false,
        forgivenNote: r.forgivenNote,
        upgraded: r.upgradedAt !== null,
      }))
      .reverse(),
    totalCounted: await totalCountedOf(ch, participation),
  };
}

/**
 * Засчитанных тренировок за весь челлендж. Считается по самим тренировкам, а не суммой
 * снимков недель: иначе выпала бы неделя, которая уже кончилась, но ещё не оценена.
 */
export async function totalCountedOf(ch: Challenge, participation: Participation): Promise<number> {
  const timeline = challengeTimeline(ch);
  if (timeline.phase === 'upcoming') return 0;
  // От начала челленджа, а не от дня вступления: тренировки внутри периода челленджа
  // идут в зачёт, даже если человек появился в списке участников позже.
  const start = timeline.startDate;
  const today = todayDay(ch.timezone);
  const end = timeline.endDate && timeline.endDate < today ? timeline.endDate : today;
  if (start > end) return 0;

  const window = { start, end };
  const { from, to } = windowInstants(window, ch.timezone);
  const workouts = await loadWorkouts(participation.userId, from, to);
  return countInWindow(workouts, rulesOf(ch), window).done;
}

// ---------- действия админа ----------

export type WeekActionError = 'week_not_found' | 'participant_not_found';

async function findWeek(ch: Challenge, weekResultId: number): Promise<WeekResult | null> {
  return prisma.weekResult.findFirst({ where: { id: weekResultId, challengeId: ch.id } });
}

/** Простить проваленную неделю: болезнь, отпуск, сбой синхронизации. Жизнь возвращается сама. */
export async function forgiveWeek(
  ch: Challenge,
  weekResultId: number,
  note: string | null,
): Promise<WeekResult | WeekActionError> {
  const row = await findWeek(ch, weekResultId);
  if (!row) return 'week_not_found';
  return prisma.weekResult.update({
    where: { id: row.id },
    data: { forgiven: true, forgivenNote: note, forgivenAt: new Date() },
  });
}

export async function unforgiveWeek(
  ch: Challenge,
  weekResultId: number,
): Promise<WeekResult | WeekActionError> {
  const row = await findWeek(ch, weekResultId);
  if (!row) return 'week_not_found';
  return prisma.weekResult.update({
    where: { id: row.id },
    data: { forgiven: false, forgivenNote: null, forgivenAt: null },
  });
}

/**
 * Пересчитать закрытую неделю по текущим данным. Сам снимок не меняется от правок задним
 * числом — иначе итог недели можно было бы переписать, дорисовав тренировку. Пересчёт —
 * осознанное действие админа: после снятия тренировки с зачёта или разбора спорной ситуации.
 */
export async function recalcWeek(
  ch: Challenge,
  weekResultId: number,
): Promise<WeekResult | WeekActionError> {
  const row = await findWeek(ch, weekResultId);
  if (!row) return 'week_not_found';
  const participation = await prisma.participation.findUnique({ where: { id: row.participationId } });
  if (!participation) return 'participant_not_found';

  const c = await computeWeek(ch, participation, row.weekIndex);
  if (!c) return row;
  return prisma.weekResult.update({
    where: { id: row.id },
    data: {
      weekStart: dayToDate(c.week.start),
      weekEnd: dayToDate(c.week.end),
      required: c.required,
      done: c.done,
      passed: c.passed,
    },
  });
}

/** Вернуть выбывшего: прощает неделю выбывания и все провалы после неё. */
export async function reinstate(
  ch: Challenge,
  participationId: number,
): Promise<{ forgivenWeekNumbers: number[] } | WeekActionError> {
  const participation = await prisma.participation.findFirst({
    where: { id: participationId, challengeId: ch.id },
  });
  if (!participation) return 'participant_not_found';

  const results = await prisma.weekResult.findMany({ where: { participationId } });
  const indexes = weeksToForgiveForReinstate(
    results.map((r) => ({ weekIndex: r.weekIndex, passed: r.passed, forgiven: r.forgiven })),
    ch.lives,
  );
  if (indexes.length) {
    await prisma.weekResult.updateMany({
      where: { participationId, weekIndex: { in: indexes } },
      data: { forgiven: true, forgivenNote: 'Возвращён в игру', forgivenAt: new Date() },
    });
  }
  return { forgivenWeekNumbers: indexes.map((i) => i + 1) };
}
