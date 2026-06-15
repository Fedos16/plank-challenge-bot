import type { DayState } from './types';

export const STATE_LABEL: Record<DayState, string> = {
  done: '✅ Сделал',
  late: '⚠️ Поздно',
  fake: '❌ Фейк',
  rejected: '🚫 Снят',
  sick: '🤒 Болел',
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

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function yesterdayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
