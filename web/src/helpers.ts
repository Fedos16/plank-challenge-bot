import type { DayState } from './types';

export const STATE_LABEL: Record<DayState, string> = {
  done: '✅ Сделал',
  late: '⚠️ Поздно',
  fake: '❌ Фейк',
  rejected: '🚫 Снят',
  sick: '🤒 Болел',
  frozen: '❄️ Заморозка',
  missed: '❌ Пропуск',
  pending: '⏳ Ожидаем',
};

export function formatMoney(n: number): string {
  return `${n.toLocaleString('ru-RU')} ₽`;
}

/** YYYY-MM-DD → ДД.ММ.ГГГГ */
export function formatDateRu(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

/** ISO-дата-время → ДД.ММ.ГГГГ ЧЧ:ММ */
export function formatDateTimeRu(iso: string): string {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(dt.getDate())}.${pad(dt.getMonth() + 1)}.${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const second = parts[1]?.[0] ?? '';
  return (first + second).toUpperCase() || '🙂';
}

/** YYYY-MM-DD → «пн» */
export function weekdayShortRu(iso: string): string {
  if (!iso) return '';
  const dt = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('ru-RU', { weekday: 'short' });
}

/** YYYY-MM-DD → «пн, 15.09.2026» */
export function formatDayTitleRu(iso: string): string {
  if (!iso) return '';
  const weekday = weekdayShortRu(iso);
  return weekday ? `${weekday}, ${formatDateRu(iso)}` : iso;
}

const MONTH_SHORT_RU = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** Сегодняшний день YYYY-MM-DD в заданном часовом поясе (в поясе челленджа); без пояса — местный. */
export function todayInZone(timeZone?: string): string {
  try {
    return new Date().toLocaleDateString('sv-SE', timeZone ? { timeZone } : undefined);
  } catch {
    return new Date().toLocaleDateString('sv-SE');
  }
}

/**
 * Дата по-человечески относительно `today`: «сегодня», «вчера», «пн, 15 сен», в другом году —
 * «пн, 15 сен 2025». Для лент и журналов, где полная дата только шумит.
 */
export function formatDayHumanRu(iso: string, today: string): string {
  if (!iso) return '';
  if (iso === today) return 'сегодня';
  const dt = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return iso;
  const diff = daysBetweenISO(iso, today);
  if (iso < today && diff === 1) return 'вчера';
  const weekday = weekdayShortRu(iso);
  const dayMonth = `${dt.getDate()} ${MONTH_SHORT_RU[dt.getMonth()]}`;
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  return `${weekday}, ${dayMonth}${sameYear ? '' : ` ${dt.getFullYear()}`}`;
}

/** Первая буква заглавная: «сегодня» → «Сегодня». */
export function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** ISO-дата-время → ЧЧ:ММ */
export function formatTimeRu(iso: string): string {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

/** Сколько дней между двумя YYYY-MM-DD (from ≤ to) */
export function daysBetweenISO(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function yesterdayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
