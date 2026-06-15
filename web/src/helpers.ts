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
