import { dayjs, deadlineInstant, type DayStr } from './time';

/**
 * Недели челленджа — 7-дневные блоки от даты старта, а не календарные Пн–Вс: неделя 0 —
 * дни 1–7, неделя 1 — дни 8–14 и так далее. Всё считается в UTC по строкам дней, чтобы
 * переход на летнее время не сдвигал границы.
 */
export const WEEK_DAYS = 7;

/** Сколько дней от `from` до `to` (может быть отрицательным). */
function diffDays(from: DayStr, to: DayStr): number {
  return dayjs.utc(to).diff(dayjs.utc(from), 'day');
}

function addDays(day: DayStr, n: number): DayStr {
  return dayjs.utc(day).add(n, 'day').format('YYYY-MM-DD');
}

/** Номер недели (0-based), которой принадлежит день. Для дней до старта — отрицательный. */
export function weekIndexOf(startDay: DayStr, day: DayStr): number {
  return Math.floor(diffDays(startDay, day) / WEEK_DAYS);
}

export interface DayWindow {
  start: DayStr;
  end: DayStr;
  /** Число дней в окне, включая оба края. */
  days: number;
}

/**
 * Границы недели. Последняя неделя обрезается по `endDay` (у челленджа на 100 дней это
 * хвост из двух дней). Если неделя целиком за концом челленджа — null.
 */
export function weekRange(startDay: DayStr, index: number, endDay: DayStr | null): DayWindow | null {
  if (index < 0) return null;
  const start = addDays(startDay, index * WEEK_DAYS);
  if (endDay && diffDays(endDay, start) > 0) return null;
  const fullEnd = addDays(start, WEEK_DAYS - 1);
  const end = endDay && diffDays(endDay, fullEnd) > 0 ? endDay : fullEnd;
  return { start, end, days: diffDays(start, end) + 1 };
}

/**
 * Пробная неделя — до семи дней перед стартом, но не раньше дня создания челленджа. Её
 * тренировки видны на полоске и в журнале, а в зачёт не идут: итогов за неё не бывает.
 * null — челлендж создан в день старта или позже, пробовать было некогда.
 */
export function trialRange(startDay: DayStr, createdDay: DayStr): DayWindow | null {
  const end = addDays(startDay, -1);
  if (diffDays(end, createdDay) > 0) return null;
  const earliest = addDays(startDay, -WEEK_DAYS);
  const start = diffDays(earliest, createdDay) > 0 ? createdDay : earliest;
  return { start, end, days: diffDays(start, end) + 1 };
}

/**
 * Пересечение недели с периодом участия: дни с момента вступления. Норму не уменьшает —
 * нужно, чтобы пустые дни до вступления не считались пропуском. Если пересечения нет
 * (вступил после конца недели) — null: эта неделя участника не касается.
 */
export function clampWindow(week: DayWindow, fromDay: DayStr | null): DayWindow | null {
  if (!fromDay || diffDays(fromDay, week.start) >= 0) return week;
  if (diffDays(week.end, fromDay) > 0) return null;
  return { start: fromDay, end: week.end, days: diffDays(fromDay, week.end) + 1 };
}

/**
 * Норма тренировок на окно. Полная неделя — норма как есть, неполная — пропорционально
 * с округлением вверх: при норме 3 на хвост из двух дней приходится одна тренировка.
 */
export function requiredFor(weeklyWorkouts: number, activeDays: number): number {
  if (weeklyWorkouts <= 0 || activeDays <= 0) return 0;
  if (activeDays >= WEEK_DAYS) return weeklyWorkouts;
  return Math.ceil((weeklyWorkouts * activeDays) / WEEK_DAYS);
}

/**
 * Момент подведения итога недели: на следующий день после её конца в `closeTime`.
 * Зазор нужен, чтобы тренировка последнего вечера успела досинхронизироваться с часов.
 */
export function weekCloseInstant(week: DayWindow, closeTime: string, tz: string): Date {
  return deadlineInstant(addDays(week.end, 1), closeTime, tz);
}

/**
 * Номера недель, по которым уже пора подводить итог. Возвращает все закрытые недели
 * с начала челленджа, а не только последнюю — так оценка догоняет простой сервера.
 */
export function closedWeekIndexes(opts: {
  startDay: DayStr;
  endDay: DayStr | null;
  now: Date;
  tz: string;
  closeTime: string;
}): number[] {
  const result: number[] = [];
  // Верхняя граница страхует от бесконечного цикла на бессрочном челлендже с битой датой
  const limit = weekIndexOf(opts.startDay, dayjs(opts.now).tz(opts.tz).format('YYYY-MM-DD')) + 1;
  for (let i = 0; i <= limit; i++) {
    const week = weekRange(opts.startDay, i, opts.endDay);
    if (!week) break;
    if (weekCloseInstant(week, opts.closeTime, opts.tz).getTime() > opts.now.getTime()) break;
    result.push(i);
  }
  return result;
}
