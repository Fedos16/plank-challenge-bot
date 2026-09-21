import { randomBytes } from 'node:crypto';
import type { FoodEntry, FoodProduct } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { config } from '../lib/config';
import { dayRange, dayToDate, dateToDay, deadlineInstant, dayjs, todayDay, type DayStr } from '../lib/time';
import { energyBaseline, type EnergyBaseline, type Sex } from './fitness/energy';

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type Meal = (typeof MEALS)[number];

/** Дневник личный, как и вес: день считаем в общей TZ приложения, а не челленджа. */
function tz(): string {
  return config.defaultTimezone;
}

/** Имя для поиска: нижний регистр, «ё» → «е». То же делает сид (prisma/seed.ts). */
export function normalizeFoodName(name: string): string {
  return name.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ---------- справочник ----------

export interface ProductDTO {
  id: number;
  name: string;
  brand: string | null;
  kcal100: number;
  protein100: number | null;
  fat100: number | null;
  carbs100: number | null;
  servingGrams: number | null;
  servingLabel: string | null;
  source: string;
}

export function toProductDTO(p: FoodProduct): ProductDTO {
  return {
    id: p.id,
    name: p.name,
    brand: p.brand,
    kcal100: p.kcal100,
    protein100: p.protein100,
    fat100: p.fat100,
    carbs100: p.carbs100,
    servingGrams: p.servingGrams,
    servingLabel: p.servingLabel,
    source: p.source,
  };
}

const SEARCH_LIMIT = 25;
/** Сухая крупа и сырое мясо: «сух…», «сыр…» как отдельное слово («сырники» и «сыр» сюда не попадают). */
const RAW_WORDS = /(^|\s)(сух(ой|ая|ие|ое)|сыр(ой|ая|ые|ое))($|\s)/;

/**
 * Поиск по локальному справочнику. Каждое слово запроса должно встретиться в названии:
 * «грудка кур» находит «Куриная грудка готовая». Выше — то, что с запроса начинается,
 * затем более короткие названия: «рис» важнее «ризотто с рисом арборио».
 */
export async function searchProducts(query: string): Promise<ProductDTO[]> {
  const words = normalizeFoodName(query).split(' ').filter((w) => w.length >= 2).slice(0, 5);
  if (words.length === 0) return [];

  const found = await prisma.foodProduct.findMany({
    where: { isHidden: false, AND: words.map((w) => ({ nameLc: { contains: w } })) },
    take: 200,
  });
  const first = words[0]!;
  const rank = (p: FoodProduct) => (p.nameLc.startsWith(first) ? 0 : p.nameLc.includes(` ${first}`) ? 1 : 2);
  // В дневник пишут то, что лежит в тарелке: готовая гречка нужна куда чаще сухой крупы.
  // Если человек сам набрал «сухая» — штрафа нет, он ищет именно её.
  const asked = words.some((w) => RAW_WORDS.test(w));
  const raw = (p: FoodProduct) => (!asked && RAW_WORDS.test(p.nameLc) ? 1 : 0);
  return found
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        raw(a) - raw(b) ||
        a.nameLc.length - b.nameLc.length ||
        a.nameLc.localeCompare(b.nameLc, 'ru'),
    )
    .slice(0, SEARCH_LIMIT)
    .map(toProductDTO);
}

/** Недавние продукты человека с граммовкой, которую он вводил в последний раз. */
export async function recentProducts(userId: number): Promise<(ProductDTO & { lastGrams: number | null })[]> {
  const entries = await prisma.foodEntry.findMany({
    where: { userId, productId: { not: null } },
    orderBy: { eatenAt: 'desc' },
    take: 60,
    include: { product: true },
  });
  const seen = new Set<number>();
  const result: (ProductDTO & { lastGrams: number | null })[] = [];
  for (const e of entries) {
    if (!e.product || e.product.isHidden || seen.has(e.product.id)) continue;
    seen.add(e.product.id);
    result.push({ ...toProductDTO(e.product), lastGrams: e.grams });
    if (result.length >= 12) break;
  }
  return result;
}

export type ProductError = 'bad_name' | 'bad_kcal' | 'bad_macros' | 'bad_serving';

/** Необязательное число в диапазоне: пусто — null, мусор — 'bad'. */
function optionalIn(v: unknown, min: number, max: number): number | null | 'bad' {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? round1(n) : 'bad';
}

/** Свой продукт: то, чего нет в справочнике. Виден всем — друзья едят примерно одно и то же. */
export async function createCustomProduct(
  userId: number,
  body: Record<string, unknown>,
): Promise<ProductDTO | ProductError> {
  const name = typeof body.name === 'string' ? body.name.replace(/\s+/g, ' ').trim() : '';
  if (name.length < 2 || name.length > 80) return 'bad_name';

  const kcal100 = Number(body.kcal100);
  // 900 ккал на 100 г — чистое масло; больше не бывает
  if (!Number.isFinite(kcal100) || kcal100 < 0 || kcal100 > 900) return 'bad_kcal';

  const protein100 = optionalIn(body.protein100, 0, 100);
  const fat100 = optionalIn(body.fat100, 0, 100);
  const carbs100 = optionalIn(body.carbs100, 0, 100);
  if (protein100 === 'bad' || fat100 === 'bad' || carbs100 === 'bad') return 'bad_macros';
  if ((protein100 ?? 0) + (fat100 ?? 0) + (carbs100 ?? 0) > 100.5) return 'bad_macros';

  const servingGrams = optionalIn(body.servingGrams, 1, 2000);
  if (servingGrams === 'bad') return 'bad_serving';
  const servingLabel =
    servingGrams !== null && typeof body.servingLabel === 'string' && body.servingLabel.trim()
      ? body.servingLabel.trim().slice(0, 30)
      : null;

  const created = await prisma.foodProduct.create({
    data: {
      source: 'custom',
      externalId: `u${userId}-${randomBytes(6).toString('hex')}`,
      name,
      nameLc: normalizeFoodName(name),
      kcal100: round1(kcal100),
      protein100,
      fat100,
      carbs100,
      servingGrams,
      servingLabel: servingGrams !== null ? (servingLabel ?? 'порция') : null,
      createdByUserId: userId,
    },
  });
  return toProductDTO(created);
}

// ---------- дневник ----------

export interface FoodEntryDTO {
  id: number;
  meal: Meal | null;
  title: string;
  kcal: number;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
  grams: number | null;
  productId: number | null;
  eatenAt: string;
}

function toEntryDTO(e: FoodEntry): FoodEntryDTO {
  return {
    id: e.id,
    meal: (e.meal as Meal | null) ?? null,
    title: e.title,
    kcal: e.kcal,
    protein: e.protein,
    fat: e.fat,
    carbs: e.carbs,
    grams: e.grams,
    productId: e.productId,
    eatenAt: e.eatenAt.toISOString(),
  };
}

export type EntryError =
  | 'bad_client_id'
  | 'bad_food_day'
  | 'bad_meal'
  | 'bad_grams'
  | 'bad_food_kcal'
  | 'bad_title'
  | 'product_not_found';

/** День дневника: сегодня или прошлое не глубже года. Завтрашнюю еду не записывают. */
export function parseFoodDay(v: unknown): DayStr | null {
  const today = todayDay(tz());
  if (v === undefined || v === null || v === '') return today;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !dayjs.utc(v).isValid()) return null;
  if (v > today || v < dayjs.utc(today).subtract(400, 'day').format('YYYY-MM-DD')) return null;
  return v;
}

/**
 * Запись в дневник двумя способами: продукт из справочника с граммовкой (калории и БЖУ
 * считаются здесь и фиксируются в записи) либо просто число калорий — когда считать лень,
 * а цифра с упаковки или из меню известна.
 */
export async function addFoodEntry(
  userId: number,
  body: Record<string, unknown>,
): Promise<FoodEntry | EntryError> {
  const clientId = body.clientId;
  if (typeof clientId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(clientId)) return 'bad_client_id';
  const day = parseFoodDay(body.day);
  if (!day) return 'bad_food_day';
  const meal = body.meal === undefined || body.meal === null || body.meal === '' ? null : (body.meal as Meal);
  if (meal !== null && !MEALS.includes(meal)) return 'bad_meal';

  const key = { userId_clientId: { userId, clientId } };
  const existing = await prisma.foodEntry.findUnique({ where: key });
  if (existing) return existing;

  let data: Pick<FoodEntry, 'title' | 'kcal' | 'protein' | 'fat' | 'carbs' | 'grams' | 'productId'>;
  if (body.productId !== undefined && body.productId !== null) {
    const product = await prisma.foodProduct.findUnique({ where: { id: Number(body.productId) || 0 } });
    if (!product || product.isHidden) return 'product_not_found';
    const grams = Number(body.grams);
    if (!Number.isFinite(grams) || grams <= 0 || grams > 5000) return 'bad_grams';
    const part = (per100: number | null) => (per100 === null ? null : round1((per100 * grams) / 100));
    data = {
      title: product.name,
      kcal: Math.round((product.kcal100 * grams) / 100),
      protein: part(product.protein100),
      fat: part(product.fat100),
      carbs: part(product.carbs100),
      grams: round1(grams),
      productId: product.id,
    };
  } else {
    const kcal = Math.round(Number(body.kcal));
    if (!Number.isFinite(kcal) || kcal < 0 || kcal > 10000) return 'bad_food_kcal';
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Приём пищи';
    if (title.length > 80) return 'bad_title';
    data = { title, kcal, protein: null, fat: null, carbs: null, grams: null, productId: null };
  }

  try {
    return await prisma.foodEntry.create({ data: { userId, clientId, day: dayToDate(day), meal, ...data } });
  } catch {
    // гонка двух одинаковых запросов: второй упирается в уникальный индекс
    const raced = await prisma.foodEntry.findUnique({ where: key });
    if (!raced) throw new Error('food entry create failed');
    return raced;
  }
}

export async function deleteFoodEntry(userId: number, id: number): Promise<boolean> {
  const r = await prisma.foodEntry.deleteMany({ where: { id, userId } });
  return r.count > 0;
}

export interface FoodDayDTO {
  day: DayStr;
  isToday: boolean;
  entries: FoodEntryDTO[];
  eaten: { kcal: number; protein: number; fat: number; carbs: number };
  /** Сожжено на тренировках за этот день. */
  workoutKcal: number;
  energy: EnergyBaseline;
  /** Личная дневная цель по калориям из анкеты челленджа, если задана. */
  target: number | null;
  /** Съедено − (расход без тренировок + тренировки). Минус — дефицит. null — анкета не заполнена. */
  balance: number | null;
  /** Семь дней до выбранного включительно — для графика. */
  week: { day: DayStr; eaten: number; workoutKcal: number }[];
}

/** Калории тренировок по дням: дубли, удалённые и снятые админом не в счёт. */
async function workoutKcalByDay(userId: number, from: DayStr, to: DayStr): Promise<Map<DayStr, number>> {
  const nextDay = dayjs.utc(to).add(1, 'day').format('YYYY-MM-DD');
  const workouts = await prisma.workout.findMany({
    where: {
      userId,
      deletedAt: null,
      duplicateOfId: null,
      excluded: false,
      kcal: { not: null },
      startedAt: { gte: deadlineInstant(from, '00:00', tz()), lt: deadlineInstant(nextDay, '00:00', tz()) },
    },
    select: { startedAt: true, kcal: true },
  });
  const byDay = new Map<DayStr, number>();
  for (const w of workouts) {
    const day = dayjs(w.startedAt).tz(tz()).format('YYYY-MM-DD');
    byDay.set(day, (byDay.get(day) ?? 0) + (w.kcal ?? 0));
  }
  return byDay;
}

export async function getFoodDay(userId: number, day: DayStr): Promise<FoodDayDTO> {
  const weekStart = dayjs.utc(day).subtract(6, 'day').format('YYYY-MM-DD');
  const [weekEntries, burned, profile, latestWeight, goal] = await Promise.all([
    prisma.foodEntry.findMany({
      where: { userId, day: { gte: dayToDate(weekStart), lte: dayToDate(day) } },
      orderBy: { eatenAt: 'asc' },
    }),
    workoutKcalByDay(userId, weekStart, day),
    prisma.userBodyProfile.findUnique({ where: { userId } }),
    prisma.weightEntry.findFirst({ where: { userId }, orderBy: { measuredAt: 'desc' } }),
    prisma.participantGoal.findFirst({
      where: {
        dailyKcalTarget: { not: null },
        participation: { userId, status: 'active', challenge: { isActive: true } },
      },
      orderBy: { updatedAt: 'desc' },
    }),
  ]);

  const entries = weekEntries.filter((e) => dateToDay(e.day) === day);
  const sum = (pick: (e: FoodEntry) => number | null) => round1(entries.reduce((s, e) => s + (pick(e) ?? 0), 0));
  const eaten = {
    kcal: entries.reduce((s, e) => s + e.kcal, 0),
    protein: sum((e) => e.protein),
    fat: sum((e) => e.fat),
    carbs: sum((e) => e.carbs),
  };

  const energy = energyBaseline(
    {
      sex: (profile?.sex as Sex | null | undefined) ?? null,
      weightKg: latestWeight?.weightKg ?? null,
      heightCm: profile?.heightCm ?? null,
      birthYear: profile?.birthYear ?? null,
      activityFactor: profile?.activityFactor ?? 1.2,
    },
    dayjs().tz(tz()).year(),
  );
  const workoutKcal = burned.get(day) ?? 0;

  return {
    day,
    isToday: day === todayDay(tz()),
    entries: entries.map(toEntryDTO),
    eaten,
    workoutKcal,
    energy,
    target: goal?.dailyKcalTarget ?? null,
    balance: energy.baseline === null ? null : eaten.kcal - (energy.baseline + workoutKcal),
    week: dayRange(weekStart, day).map((d) => ({
      day: d,
      eaten: weekEntries.filter((e) => dateToDay(e.day) === d).reduce((s, e) => s + e.kcal, 0),
      workoutKcal: burned.get(d) ?? 0,
    })),
  };
}
