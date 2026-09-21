import { ApiError } from './api';
import type { GoalMetric, GoalType, MeasurementKind } from './types';

export const GOAL_LABEL: Record<GoalType, string> = {
  lose_weight: 'Похудеть',
  lose_fat: 'Снизить % жира',
  gain_muscle: 'Набрать % мышц',
  custom: 'Своя цель',
};

export const GOAL_EMOJI: Record<GoalType, string> = {
  lose_weight: '⚖️',
  lose_fat: '🔥',
  gain_muscle: '💪',
  custom: '🎯',
};

export const METRIC_UNIT: Record<GoalMetric, string> = {
  weightKg: 'кг',
  bodyFat: '%',
  muscle: '%',
};

/** Какой показатель отслеживает цель — зеркало серверной карты. */
export const GOAL_METRIC: Record<GoalType, GoalMetric | null> = {
  lose_weight: 'weightKg',
  lose_fat: 'bodyFat',
  gain_muscle: 'muscle',
  custom: null,
};

export const MEASUREMENT_LABEL: Record<MeasurementKind, string> = {
  waist: 'Талия',
  chest: 'Грудь',
  hips: 'Бёдра',
  thigh: 'Бедро',
  biceps: 'Бицепс',
  neck: 'Шея',
};

export const MEASUREMENT_KINDS = Object.keys(MEASUREMENT_LABEL) as MeasurementKind[];

const ERROR_TEXT: Record<string, string> = {
  bad_height: 'Рост — от 100 до 250 см',
  bad_birth_year: 'Проверьте год рождения',
  bad_sex: 'Укажите пол',
  bad_goal_type: 'Выберите цель',
  bad_start: 'Укажите стартовый замер для выбранной цели',
  bad_target: 'Укажите целевое значение',
  target_direction: 'Цель должна быть по нужную сторону от старта: худеем вниз, мышцы набираем вверх',
  bad_kcal_target: 'Дневная цель — от 500 до 10 000 ккал',
  bad_note: 'Описание слишком длинное',
  bad_weight: 'Вес — от 1 до 500 кг',
  bad_percent: 'Процент — от 0 до 100',
  bad_date: 'Дата не может быть в будущем',
  bad_kind: 'Неизвестный вид замера',
  bad_value: 'Значение — от 1 до 300 см',
  bad_day: 'Дата не может быть в будущем',
  bad_title: 'Укажите название',
  bad_start_date: 'Укажите дату старта',
  bad_duration: 'Длительность — от 1 до 3650 дней',
  bad_weekly_workouts: 'Тренировок в неделю — от 1 до 7',
  bad_lives: 'Жизней — от 1 до 9',
  bad_min_workout: 'Минимальная длительность — от 1 до 300 минут',
  bad_max_per_day: 'В зачёт за день — от 1 до 3 тренировок',
  bad_week_close_time: 'Время в формате ЧЧ:ММ',
  bad_chat_id: 'ID чата должен быть числом',
  join_closed: 'Набор в этот челлендж закрыт',
};

/** Человеческий текст ошибки API по её коду. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError && e.code && ERROR_TEXT[e.code]) return ERROR_TEXT[e.code]!;
  return e instanceof Error ? e.message : 'Ошибка';
}

export function formatNum(n: number, digits = 1): string {
  return n.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Пустая строка из поля ввода → null, иначе число. */
export function numOrNull(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
