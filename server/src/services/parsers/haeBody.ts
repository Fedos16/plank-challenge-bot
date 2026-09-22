import type { ScaleMeasurement } from '../openscale';
import { parseHaeDate } from './hae';

/**
 * Health Auto Export (iOS) → взвешивания. В том же теле, где приходят тренировки, лежат
 * метрики Apple Health. Вес и состав тела пишут туда весы с приложением: Withings, Garmin
 * Index, Xiaomi через Zepp Life, Renpho и прочие.
 *
 *   "data": { "metrics": [
 *     { "name": "weight_body_mass",     "units": "kg", "data": [ { "qty": 84.3, "date": "2026-09-22 05:31:12 +0300" } ] },
 *     { "name": "body_fat_percentage",  "units": "%",  "data": [ { "qty": 24.1, "date": "2026-09-22 05:31:12 +0300" } ] },
 *     { "name": "lean_body_mass",       "units": "kg", "data": [ { "qty": 63.9, "date": "2026-09-22 05:31:12 +0300" } ] }
 *   ] }
 *
 * Как и у Health Connect, одно взвешивание разъезжается на несколько точек, поэтому склеиваем
 * их по окну. Без веса точка бесполезна: `WeightEntry` требует килограммы.
 *
 * Воды в Apple Health нет — такого типа данных в HealthKit не существует, поэтому у iOS она
 * всегда пустая. Мышцы приходят массой и пересчитываются в долю от веса, как и везде у нас.
 */

/** Точки одного взвешивания, разъехавшиеся по секундам, считаем одним замером. */
const MERGE_WINDOW_MS = 60 * 1000;

const KG_PER_LB = 0.45359237;
const KG_PER_STONE = 6.35029318;

/** Имена метрик приходят в snake_case, но регистр и разделители у версий разные. */
function metricKey(name: unknown): string {
  return typeof name === 'string' ? name.toLowerCase().replace(/[\s-]+/g, '_').trim() : '';
}

function finite(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** Масса в килограммы: телефон отдаёт её в единицах, выставленных в настройках. */
function toKg(value: number, units: string): number | null {
  const u = units.toLowerCase();
  if (!u || /kg|кг/.test(u)) return value;
  if (/lb|фунт/.test(u)) return value * KG_PER_LB;
  if (/stone|st\b/.test(u)) return value * KG_PER_STONE;
  if (/^g$|gram/.test(u)) return value / 1000;
  return null;
}

/** Метрика состава тела в процентах: 0 и мусор → null, как у openScale. */
function percent(value: number | null): number | null {
  if (value === null || value <= 0 || value > 100) return null;
  return Math.round(value * 10) / 10;
}

interface Point {
  at: number;
  value: number;
}

interface Metric {
  units: string;
  points: Point[];
}

/** Метрики выгрузки по именам: у каждой свои единицы и свой список точек. */
function metricsOf(body: unknown): Map<string, Metric> {
  const result = new Map<string, Metric>();
  if (!body || typeof body !== 'object') return result;
  const data = (body as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return result;
  const list = (data as { metrics?: unknown }).metrics;
  if (!Array.isArray(list)) return result;

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const m = item as Record<string, unknown>;
    const key = metricKey(m.name);
    if (!key || !Array.isArray(m.data)) continue;

    const points: Point[] = [];
    for (const raw of m.data) {
      if (!raw || typeof raw !== 'object') continue;
      const o = raw as Record<string, unknown>;
      const at = parseHaeDate(o.date)?.at.getTime();
      const value = finite(o.qty);
      if (at !== undefined && value !== null && value > 0) points.push({ at, value });
    }
    if (points.length === 0) continue;

    points.sort((a, b) => a.at - b.at);
    result.set(key, { units: typeof m.units === 'string' ? m.units : '', points });
  }
  return result;
}

/** Ближайшая по времени точка в окне склейки. */
function nearest(metric: Metric | undefined, at: number): number | null {
  if (!metric) return null;
  let best: Point | null = null;
  for (const p of metric.points) {
    const gap = Math.abs(p.at - at);
    if (gap > MERGE_WINDOW_MS) continue;
    if (!best || gap < Math.abs(best.at - at)) best = p;
  }
  return best?.value ?? null;
}

/**
 * Доля жира: Apple хранит её как часть единицы (0.241), а Health Auto Export в зависимости
 * от версии отдаёт то долю, то проценты. Человека с одним процентом жира не бывает, поэтому
 * всё, что не больше единицы, считаем долей.
 */
function fatPercent(value: number | null): number | null {
  if (value === null) return null;
  return percent(value <= 1 ? value * 100 : value);
}

/**
 * Метрики выгрузки → взвешивания. Возвращает [] если веса в теле нет: выгрузка одних
 * тренировок или шагов — штатный запрос, ошибкой это не считаем.
 */
export function parseHaeBody(body: unknown): ScaleMeasurement[] {
  const metrics = metricsOf(body);
  const weight = metrics.get('weight_body_mass') ?? metrics.get('body_mass');
  if (!weight) return [];

  const fat = metrics.get('body_fat_percentage');
  const lean = metrics.get('lean_body_mass');

  const result: ScaleMeasurement[] = [];
  for (const point of weight.points) {
    const kg = toKg(point.value, weight.units);
    if (kg === null || kg <= 0 || kg > 500) continue;
    const weightKg = Math.round(kg * 100) / 100;

    const leanRaw = nearest(lean, point.at);
    const leanKg = leanRaw === null ? null : toKg(leanRaw, lean?.units ?? '');

    result.push({
      // id у точки нет; момент взвешивания между выгрузками не меняется — по нему сервер и дедуплицирует
      scaleEntryId: null,
      scaleUserId: null,
      scaleUsername: null,
      measuredAt: new Date(point.at),
      weightKg,
      bodyFat: fatPercent(nearest(fat, point.at)),
      // Apple хранит массу без жира; база — долю мышц от веса, считаем от веса того же взвешивания
      muscle: leanKg !== null ? percent((leanKg / weightKg) * 100) : null,
      // в HealthKit нет процента воды: у iOS эта графа остаётся пустой
      water: null,
    });
  }
  return result;
}
