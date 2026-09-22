import { ApiError } from './api';
import type { FitnessOverview, GoalMetric, GoalType, MeasurementKind, MuscleUnit, Verdict } from './types';

export const GOAL_LABEL: Record<GoalType, string> = {
  lose_weight: 'Похудеть',
  lose_fat: 'Снизить % жира',
  gain_muscle: 'Набрать мышцы',
  custom: 'Своя цель',
};

export const GOAL_EMOJI: Record<GoalType, string> = {
  lose_weight: '⚖️',
  lose_fat: '🔥',
  gain_muscle: '💪',
  custom: '🎯',
};

export const UNIT_LABEL: Record<MuscleUnit, string> = {
  kg: 'кг',
  percent: '%',
};

/**
 * В чём человек вводит и видит мышцы. Пока сам не выбирал — как в его цели (у заданных раньше
 * это проценты), а без цели — килограммы: их показывают приложения весов.
 */
export function muscleUnitOf(overview: Pick<FitnessOverview, 'bodyProfile' | 'goal'>): MuscleUnit {
  return overview.bodyProfile.muscleUnit ?? overview.goal?.muscleUnit ?? 'kg';
}

/** Мышцы из одной единицы в другую через вес; без веса пересчитать нечем. */
export function convertMuscle(value: number, weightKg: number, to: MuscleUnit): number {
  const converted = to === 'kg' ? (weightKg * value) / 100 : (value / weightKg) * 100;
  return Math.round(converted * 10) / 10;
}

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

/** Виды активности для ручного ввода; ключи совпадают с серверным списком SPORTS. */
export const SPORT_LABEL: Record<string, string> = {
  strength: 'Силовая',
  run: 'Бег',
  walk: 'Ходьба',
  cycling: 'Велосипед',
  swim: 'Плавание',
  hiit: 'HIIT / кроссфит',
  yoga: 'Йога / растяжка',
  team: 'Командный спорт',
  racket: 'Теннис / падел',
  martial: 'Единоборства',
  ski: 'Лыжи / сноуборд',
  other: 'Другое',
};

export const SPORT_EMOJI: Record<string, string> = {
  strength: '🏋️',
  run: '🏃',
  walk: '🚶',
  cycling: '🚴',
  swim: '🏊',
  hiit: '🔥',
  yoga: '🧘',
  team: '⚽',
  racket: '🎾',
  martial: '🥊',
  ski: '⛷️',
  other: '💪',
};

/**
 * Название тренировки. Вид, которого нет в нашем справочнике, устройство присылает как «other»
 * со своим названием — показываем его («Underwater hockey»), а не безликое «Другое».
 */
export function sportTitle(w: { sport: string; sportRaw: string | null }): string {
  if (w.sport === 'other' && w.sportRaw) return w.sportRaw.charAt(0).toUpperCase() + w.sportRaw.slice(1);
  return SPORT_LABEL[w.sport] ?? w.sportRaw ?? w.sport;
}

/**
 * Первая буква строчной — но только у обычных слов: «HIIT / кроссфит» так и остаётся,
 * иначе получилось бы «hIIT».
 */
function lowerFirst(title: string): string {
  return /^[A-ZА-ЯЁ][a-zа-яё]/.test(title) ? title.charAt(0).toLowerCase() + title.slice(1) : title;
}

/**
 * Название занятия, собранного из нескольких записей: «Ходьба и силовая». Часы режут занятие
 * по видам активности, и одно название вместо всех потеряло бы половину тренировки.
 */
export function sessionTitle(parts: { sport: string; sportRaw: string | null }[]): string {
  const titles = parts.map(sportTitle);
  const first = titles[0];
  if (!first) return '';
  const rest = titles.slice(1).map(lowerFirst);
  if (!rest.length) return first;
  if (rest.length === 1) return `${first} и ${rest[0]}`;
  return `${first}, ${rest.slice(0, -1).join(', ')} и ${rest[rest.length - 1]}`;
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  counted: 'в зачёте',
  too_short: 'короче минимума',
  duplicate: 'дубль',
  excluded: 'снята админом',
  day_limit: 'лимит дня',
};

export const SOURCE_LABEL: Record<string, string> = {
  manual: 'вручную',
  whoop: 'WHOOP',
  hae: 'Apple Health',
  health_connect: 'Health Connect',
  strava: 'Strava',
};

/**
 * Идентификатор формы для идемпотентной отправки. randomUUID есть не во всех WebView
 * (нужен secure context и свежий движок), поэтому с запасным вариантом.
 */
export function newClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${rand()}-${rand()}`;
}

/** Жизни сердечками: оставшиеся красные, потерянные чёрные. */
export function hearts(left: number, total: number): string {
  return '❤️'.repeat(Math.max(0, left)) + '🖤'.repeat(Math.max(0, total - left));
}

const ERROR_TEXT: Record<string, string> = {
  off_rate_limited: 'Слишком много запросов к Open Food Facts — попробуйте через минуту',
  off_unavailable: 'Open Food Facts сейчас недоступен — введите калории цифрой или добавьте свой продукт',
  off_disabled: 'Поиск в Open Food Facts выключен',
  bad_query: 'Запрос — от 3 символов',
  bad_food_day: 'Дата не может быть в будущем',
  bad_meal: 'Выберите приём пищи',
  bad_grams: 'Граммы — от 1 до 5000',
  bad_food_kcal: 'Калории — от 0 до 10 000',
  product_not_found: 'Продукт не найден',
  bad_name: 'Название — от 2 до 80 символов',
  bad_macros: 'Проверьте БЖУ: на 100 г их не может быть больше 100 г',
  bad_serving: 'Проверьте вес порции',
  whoop_disabled: 'Интеграция с WHOOP на сервере не настроена',
  bad_sport: 'Выберите вид тренировки',
  bad_started_at: 'Проверьте дату: не в будущем и не старше года',
  bad_workout_duration: 'Длительность — от 1 минуты до суток',
  bad_kcal: 'Проверьте калории',
  bad_distance: 'Проверьте дистанцию',
  bad_hr: 'Пульс — от 30 до 250',
  not_editable: 'Тренировки с устройств не редактируются',
  week_not_found: 'Неделя не найдена',
  participant_not_found: 'Участник не найден',
  workout_not_found: 'Тренировка не найдена',
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
  bad_muscle_kg: 'Мышцы в килограммах должны быть меньше веса. Если весы показывают проценты — переключите на %',
  bad_muscle_unit: 'Мышцы считаем в килограммах или процентах',
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
