import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

export { dayjs };

/** Строка дня в формате YYYY-MM-DD */
export type DayStr = string;

/**
 * День челленджа, которому принадлежит момент времени (граница — полночь в TZ челленджа).
 */
export function challengeDay(instant: Date, tz: string): DayStr {
  return dayjs(instant).tz(tz).format('YYYY-MM-DD');
}

/** Сегодняшний день челленджа в его TZ */
export function todayDay(tz: string): DayStr {
  return dayjs().tz(tz).format('YYYY-MM-DD');
}

/** Вчерашний день челленджа в его TZ */
export function yesterdayDay(tz: string): DayStr {
  return dayjs().tz(tz).subtract(1, 'day').format('YYYY-MM-DD');
}

/**
 * Преобразует строку дня в Date для хранения в колонке @db.Date (полночь UTC).
 */
export function dayToDate(day: DayStr): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** Обратное преобразование: Date из БД (@db.Date) → строка дня */
export function dateToDay(date: Date): DayStr {
  return dayjs.utc(date).format('YYYY-MM-DD');
}

/**
 * Момент дедлайна (например 23:59) для конкретного дня в TZ челленджа.
 */
export function deadlineInstant(day: DayStr, hhmm: string, tz: string): Date {
  return dayjs.tz(`${day} ${hhmm}`, 'YYYY-MM-DD HH:mm', tz).toDate();
}

/**
 * Прислан ли момент в пределах дедлайна (включительно по минуте) этого дня.
 */
export function isBeforeDeadline(instant: Date, day: DayStr, hhmm: string, tz: string): boolean {
  const deadline = deadlineInstant(day, hhmm, tz);
  // дедлайн считаем до конца минуты дедлайна (например 23:59:59)
  const deadlineEnd = dayjs(deadline).add(59, 'second').toDate();
  return instant.getTime() <= deadlineEnd.getTime();
}

/** Номер дня челленджа (1-based) для заданного дня */
export function challengeDayNumber(startDay: DayStr, day: DayStr): number {
  const diff = dayjs(day).diff(dayjs(startDay), 'day');
  return diff + 1;
}

/** Список дней [from..to] включительно */
export function dayRange(from: DayStr, to: DayStr): DayStr[] {
  const result: DayStr[] = [];
  let cursor = dayjs(from);
  const end = dayjs(to);
  while (cursor.isSame(end) || cursor.isBefore(end)) {
    result.push(cursor.format('YYYY-MM-DD'));
    cursor = cursor.add(1, 'day');
  }
  return result;
}

/** Предыдущий день */
export function prevDay(day: DayStr): DayStr {
  return dayjs(day).subtract(1, 'day').format('YYYY-MM-DD');
}
