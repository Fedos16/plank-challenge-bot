import type {
  BodyMeasurement,
  Challenge,
  Participation,
  ParticipantGoal,
  UserBodyProfile,
  WeightEntry,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { config } from '../../lib/config';
import { dateToDay, dayToDate, dayjs, todayDay, type DayStr } from '../../lib/time';
import { addManualWeight, muscleKgOf } from '../weight';

/** Личная цель участника: у каждого в челлендже она своя. */
export const GOAL_TYPES = ['lose_weight', 'lose_fat', 'gain_muscle', 'custom'] as const;
export type GoalType = (typeof GOAL_TYPES)[number];

export const MEASUREMENT_KINDS = ['waist', 'chest', 'hips', 'thigh', 'biceps', 'neck'] as const;
export type MeasurementKind = (typeof MEASUREMENT_KINDS)[number];

export const SEXES = ['male', 'female'] as const;
export type Sex = (typeof SEXES)[number];

/**
 * В чём считать мышцы. Хранилище здоровья отдаёт долю, Zepp и Mi Fitness показывают массу —
 * и для цели «набрать мышцы» масса честнее: на сушке доля растёт сама, без грамма новых мышц.
 */
export const MUSCLE_UNITS = ['kg', 'percent'] as const;
export type MuscleUnit = (typeof MUSCLE_UNITS)[number];

type Metric = 'weightKg' | 'bodyFat' | 'muscle';

/** Какой показатель взвешивания отслеживает цель. У свободной цели измеримого показателя нет. */
const GOAL_METRIC: Record<GoalType, Metric | null> = {
  lose_weight: 'weightKg',
  lose_fat: 'bodyFat',
  gain_muscle: 'muscle',
  custom: null,
};

/** Стартовое значение цели лежит в своём поле — по показателю. */
const START_FIELD: Record<Metric, 'startWeightKg' | 'startBodyFat' | 'startMuscle'> = {
  weightKg: 'startWeightKg',
  bodyFat: 'startBodyFat',
  muscle: 'startMuscle',
};

/** Потолок для мышц в килограммах — отсекает опечатки вроде лишнего нуля. */
const MUSCLE_KG_MAX = 150;

/** Сколько последних замеров усредняем и за какой срок: биоимпедансные весы шумят. */
const CURRENT_SAMPLES = 3;
const CURRENT_WINDOW_DAYS = 7;

// ---------- чистые функции ----------

/**
 * Прогресс к цели в процентах, 0..100. Формула одна для обоих направлений: знак разности
 * сам учитывает, худеем мы или набираем. Откат дальше старта — 0, перевыполнение — 100.
 */
export function goalProgress(
  start: number | null,
  target: number | null,
  current: number | null,
): number | null {
  if (start === null || target === null || current === null) return null;
  if (target === start) return null;
  const pct = ((current - start) / (target - start)) * 100;
  return Math.round(Math.min(100, Math.max(0, pct)));
}

/**
 * Текущее значение показателя: среднее по последним замерам (до трёх) за неделю перед самым
 * свежим. Окно считается от последнего замера, а не от сегодня: кто не взвешивался две
 * недели, у того прогресс не обнуляется, а остаётся на последней известной точке.
 *
 * Мышцы в килограммах считаются по каждому замеру от его же веса и только потом усредняются:
 * средняя доля, умноженная на средний вес, — уже другое число.
 */
export function currentMetric(
  entries: Pick<WeightEntry, 'measuredAt' | Metric>[],
  metric: Metric,
  muscleUnit: MuscleUnit = 'percent',
): number | null {
  const inKg = metric === 'muscle' && muscleUnit === 'kg';
  const withValue = entries
    .map((e) => {
      const raw = e[metric];
      if (raw === null || raw === undefined) return null;
      return { at: e.measuredAt.getTime(), value: inKg ? muscleKgOf(e.weightKg, raw) : raw };
    })
    .filter((e): e is { at: number; value: number } => e !== null)
    .sort((a, b) => b.at - a.at);
  const newest = withValue[0];
  if (!newest) return null;

  const since = newest.at - CURRENT_WINDOW_DAYS * 86_400_000;
  const sample = withValue.filter((e) => e.at >= since).slice(0, CURRENT_SAMPLES);
  const sum = sample.reduce((acc, e) => acc + e.value, 0);
  return Math.round((sum / sample.length) * 10) / 10;
}

// ---------- анкета ----------

export interface BodyProfileDTO {
  heightCm: number | null;
  birthYear: number | null;
  sex: Sex | null;
  activityFactor: number;
  shareBody: boolean;
  /** В чём человек вводит и видит мышцы; null — ещё не выбирал. */
  muscleUnit: MuscleUnit | null;
}

function toBodyProfileDTO(p: UserBodyProfile | null): BodyProfileDTO {
  return {
    heightCm: p?.heightCm ?? null,
    birthYear: p?.birthYear ?? null,
    sex: (p?.sex as Sex | null | undefined) ?? null,
    activityFactor: p?.activityFactor ?? 1.2,
    shareBody: p?.shareBody ?? false,
    muscleUnit: (p?.muscleUnit as MuscleUnit | null | undefined) ?? null,
  };
}

export async function getBodyProfile(userId: number): Promise<BodyProfileDTO> {
  return toBodyProfileDTO(await prisma.userBodyProfile.findUnique({ where: { userId } }));
}

export type BodyProfileError =
  | 'bad_height'
  | 'bad_birth_year'
  | 'bad_sex'
  | 'bad_activity'
  | 'bad_muscle_unit';

/** null — очистить поле, undefined — не трогать. */
function optionalNumber(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  return Number(v);
}

export async function saveBodyProfile(
  userId: number,
  body: Record<string, unknown>,
): Promise<BodyProfileDTO | BodyProfileError> {
  const data: Partial<
    Pick<UserBodyProfile, 'heightCm' | 'birthYear' | 'sex' | 'activityFactor' | 'shareBody' | 'muscleUnit'>
  > = {};

  const height = optionalNumber(body.heightCm);
  if (height !== undefined) {
    if (height !== null && (!Number.isFinite(height) || height < 100 || height > 250)) return 'bad_height';
    data.heightCm = height === null ? null : Math.round(height * 10) / 10;
  }

  const birthYear = optionalNumber(body.birthYear);
  if (birthYear !== undefined) {
    const maxYear = dayjs().year() - 10;
    if (birthYear !== null && (!Number.isInteger(birthYear) || birthYear < 1920 || birthYear > maxYear)) {
      return 'bad_birth_year';
    }
    data.birthYear = birthYear;
  }

  if (body.sex !== undefined) {
    if (body.sex !== null && !SEXES.includes(body.sex as Sex)) return 'bad_sex';
    data.sex = body.sex as Sex | null;
  }

  const activity = optionalNumber(body.activityFactor);
  if (activity !== undefined && activity !== null) {
    if (!Number.isFinite(activity) || activity < 1 || activity > 2.5) return 'bad_activity';
    data.activityFactor = Math.round(activity * 100) / 100;
  }

  if (typeof body.shareBody === 'boolean') data.shareBody = body.shareBody;

  if (body.muscleUnit !== undefined && body.muscleUnit !== null) {
    if (!MUSCLE_UNITS.includes(body.muscleUnit as MuscleUnit)) return 'bad_muscle_unit';
    data.muscleUnit = body.muscleUnit as MuscleUnit;
  }

  const saved = await prisma.userBodyProfile.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  return toBodyProfileDTO(saved);
}

// ---------- цель ----------

export interface GoalDTO {
  goalType: GoalType;
  targetValue: number | null;
  startWeightKg: number | null;
  startBodyFat: number | null;
  startMuscle: number | null;
  /** Единица `startMuscle` и — у цели по мышцам — `targetValue`. */
  muscleUnit: MuscleUnit;
  startDay: DayStr | null;
  dailyKcalTarget: number | null;
  note: string | null;
}

export interface GoalProgressDTO {
  /** Показатель цели; у свободной цели — null, и процента нет. */
  metric: Metric | null;
  /** В чём выражены start, target и current. */
  unit: MuscleUnit | null;
  start: number | null;
  target: number | null;
  current: number | null;
  percent: number | null;
}

function toGoalDTO(g: ParticipantGoal): GoalDTO {
  return {
    goalType: g.goalType as GoalType,
    targetValue: g.targetValue,
    startWeightKg: g.startWeightKg,
    startBodyFat: g.startBodyFat,
    startMuscle: g.startMuscle,
    muscleUnit: muscleUnitOf(g),
    startDay: g.startDay ? dateToDay(g.startDay) : null,
    dailyKcalTarget: g.dailyKcalTarget,
    note: g.note,
  };
}

/** Замеры, по которым считается «текущее значение»: с запасом на пропуски показателя. */
async function recentEntries(userId: number): Promise<WeightEntry[]> {
  return prisma.weightEntry.findMany({
    where: { userId },
    orderBy: { measuredAt: 'desc' },
    take: 20,
  });
}

function muscleUnitOf(goal: Pick<ParticipantGoal, 'muscleUnit'>): MuscleUnit {
  return goal.muscleUnit === 'kg' ? 'kg' : 'percent';
}

export function progressFor(goal: ParticipantGoal, entries: WeightEntry[]): GoalProgressDTO {
  const metric = GOAL_METRIC[goal.goalType as GoalType] ?? null;
  if (!metric) return { metric: null, unit: null, start: null, target: null, current: null, percent: null };

  const muscleUnit = muscleUnitOf(goal);
  const unit: MuscleUnit = metric === 'weightKg' ? 'kg' : metric === 'bodyFat' ? 'percent' : muscleUnit;
  const start = goal[START_FIELD[metric]];
  const current = currentMetric(entries, metric, muscleUnit);
  return {
    metric,
    unit,
    start,
    target: goal.targetValue,
    current,
    percent: goalProgress(start, goal.targetValue, current),
  };
}

export async function getGoal(
  participation: Participation,
): Promise<{ goal: GoalDTO; progress: GoalProgressDTO } | null> {
  const goal = await prisma.participantGoal.findUnique({
    where: { participationId: participation.id },
  });
  if (!goal) return null;
  return { goal: toGoalDTO(goal), progress: progressFor(goal, await recentEntries(participation.userId)) };
}

export type GoalError =
  | 'bad_goal_type'
  | 'bad_muscle_unit'
  | 'bad_muscle_kg'
  | 'bad_start'
  | 'bad_target'
  | 'target_direction'
  | 'bad_kcal_target'
  | 'bad_note';

/** Положительное число в пределах `max`; пустое значение — null. */
function boundedOrNull(v: unknown, max: number): number | null | 'bad' {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > max) return 'bad';
  return Math.round(n * 10) / 10;
}

/**
 * Сохраняет цель. Первая запись фиксирует точку отсчёта: день старта и стартовый замер —
 * он же уходит в историю веса первой точкой графика, если свежего взвешивания ещё нет.
 */
export async function saveGoal(
  challenge: Challenge,
  participation: Participation,
  body: Record<string, unknown>,
): Promise<{ goal: GoalDTO; progress: GoalProgressDTO } | GoalError> {
  const goalType = body.goalType as GoalType;
  if (!GOAL_TYPES.includes(goalType)) return 'bad_goal_type';

  // без единицы — проценты: так цель задавали до появления килограммов
  const muscleUnit = (body.muscleUnit ?? 'percent') as MuscleUnit;
  if (!MUSCLE_UNITS.includes(muscleUnit)) return 'bad_muscle_unit';
  const muscleMax = muscleUnit === 'kg' ? MUSCLE_KG_MAX : 100;

  const startWeightKg = boundedOrNull(body.startWeightKg, 500);
  const startBodyFat = boundedOrNull(body.startBodyFat, 100);
  const startMuscle = boundedOrNull(body.startMuscle, muscleMax);
  if (startWeightKg === 'bad' || startBodyFat === 'bad' || startMuscle === 'bad') return 'bad_start';
  // мышц не бывает больше, чем весит человек: так ловим проценты, вбитые в поле килограммов
  if (muscleUnit === 'kg' && startMuscle !== null && startWeightKg !== null && startMuscle >= startWeightKg) {
    return 'bad_muscle_kg';
  }

  const metric = GOAL_METRIC[goalType];
  const targetMax = metric === 'weightKg' ? 500 : metric === 'muscle' ? muscleMax : 100;
  const targetValue = boundedOrNull(body.targetValue, targetMax);
  if (targetValue === 'bad') return 'bad_target';

  if (metric) {
    const start = { weightKg: startWeightKg, bodyFat: startBodyFat, muscle: startMuscle }[metric];
    if (start === null) return 'bad_start';
    if (targetValue === null) return 'bad_target';
    // худеем и сушимся вниз, мышцы набираем вверх
    const up = goalType === 'gain_muscle';
    if (up ? targetValue <= start : targetValue >= start) return 'target_direction';
  }

  let dailyKcalTarget: number | null = null;
  if (body.dailyKcalTarget !== null && body.dailyKcalTarget !== undefined && body.dailyKcalTarget !== '') {
    const kcal = Math.trunc(Number(body.dailyKcalTarget));
    if (!Number.isInteger(kcal) || kcal < 500 || kcal > 10000) return 'bad_kcal_target';
    dailyKcalTarget = kcal;
  }

  let note: string | null = null;
  if (typeof body.note === 'string' && body.note.trim()) {
    note = body.note.trim();
    if (note.length > 500) return 'bad_note';
  }

  const data = {
    goalType,
    targetValue,
    startWeightKg,
    startBodyFat,
    startMuscle,
    muscleUnit,
    dailyKcalTarget,
    note,
  };
  const existing = await prisma.participantGoal.findUnique({
    where: { participationId: participation.id },
  });

  const saved = existing
    ? await prisma.participantGoal.update({ where: { id: existing.id }, data })
    : await prisma.participantGoal.create({
        data: {
          ...data,
          participationId: participation.id,
          startDay: dayToDate(todayDay(challenge.timezone)),
        },
      });

  if (!existing && startWeightKg !== null) {
    const fresh = await prisma.weightEntry.findFirst({
      where: { userId: participation.userId, measuredAt: { gte: dayjs().subtract(1, 'day').toDate() } },
    });
    if (!fresh) {
      await addManualWeight(participation.userId, {
        weightKg: startWeightKg,
        bodyFat: startBodyFat,
        ...(muscleUnit === 'kg' ? { muscleKg: startMuscle } : { muscle: startMuscle }),
      });
    }
  }

  return { goal: toGoalDTO(saved), progress: progressFor(saved, await recentEntries(participation.userId)) };
}

// ---------- обхваты ----------

export interface MeasurementDTO {
  id: number;
  day: DayStr;
  kind: MeasurementKind;
  value: number;
}

function toMeasurementDTO(m: BodyMeasurement): MeasurementDTO {
  return { id: m.id, day: dateToDay(m.day), kind: m.kind as MeasurementKind, value: m.value };
}

/** От новых к старым. Замеры личные, как и вес, поэтому день считаем в общей TZ приложения. */
export async function listMeasurements(userId: number): Promise<MeasurementDTO[]> {
  const rows = await prisma.bodyMeasurement.findMany({
    where: { userId },
    orderBy: [{ day: 'desc' }, { kind: 'asc' }],
    take: 300,
  });
  return rows.map(toMeasurementDTO);
}

export type MeasurementError = 'bad_kind' | 'bad_value' | 'bad_day';

/** Один замер вида на день: повторный ввод в тот же день исправляет значение. */
export async function upsertMeasurement(
  userId: number,
  body: Record<string, unknown>,
): Promise<MeasurementDTO | MeasurementError> {
  const kind = body.kind as MeasurementKind;
  if (!MEASUREMENT_KINDS.includes(kind)) return 'bad_kind';

  const value = Number(body.value);
  if (!Number.isFinite(value) || value <= 0 || value > 300) return 'bad_value';

  const today = todayDay(config.defaultTimezone);
  const day = typeof body.day === 'string' && body.day ? body.day : today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !dayjs.utc(day).isValid() || day > today) return 'bad_day';

  const rounded = Math.round(value * 10) / 10;
  const saved = await prisma.bodyMeasurement.upsert({
    where: { userId_day_kind: { userId, day: dayToDate(day), kind } },
    create: { userId, day: dayToDate(day), kind, value: rounded },
    update: { value: rounded },
  });
  return toMeasurementDTO(saved);
}

export async function deleteMeasurement(userId: number, id: number): Promise<boolean> {
  const r = await prisma.bodyMeasurement.deleteMany({ where: { id, userId } });
  return r.count > 0;
}
