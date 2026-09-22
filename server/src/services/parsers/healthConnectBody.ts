import type { WeightMeasurement } from '../weight';

/**
 * Health Connect Webhook (Android) → взвешивания. Кроме тренировок приложение умеет слать
 * состав тела, который в Health Connect пишут Mi Fitness, Zepp, Samsung Health, Withings и
 * прочие весы с приложением. В выгрузке это отдельные массивы точек, каждая со своим временем:
 *
 *   "weight":          [ { "kilograms": 84.3,  "time": "2026-09-22T05:31:12Z" } ],
 *   "body_fat":        [ { "percentage": 24.1, "time": "2026-09-22T05:31:12Z" } ],
 *   "lean_body_mass":  [ { "kilograms": 63.9,  "time": "2026-09-22T05:31:12Z" } ],
 *   "body_water_mass": [ { "kilograms": 46.2,  "time": "2026-09-22T05:31:12Z" } ]
 *
 * Одно взвешивание — несколько точек с одним временем (у некоторых весов расходятся на секунды),
 * поэтому склеиваем по окну. Без веса точка бесполезна: жир и мышцы без веса не сохраняем —
 * `WeightEntry` требует килограммы.
 *
 * Мышцы и вода в базе лежат долей от веса, а Health Connect отдаёт их массой — пересчитываем
 * через вес того же взвешивания. Так работает и ручной ввод в килограммах.
 */

/** Точки одного взвешивания, разъехавшиеся по секундам, считаем одним замером. */
const MERGE_WINDOW_MS = 60 * 1000;

function parseTime(v: unknown): Date | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const at = new Date(v);
  return Number.isNaN(at.getTime()) ? null : at;
}

function finite(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** Метрика состава тела в процентах: 0 и мусор → null. */
function percent(value: number | null): number | null {
  if (value === null || value <= 0 || value > 100) return null;
  return Math.round(value * 10) / 10;
}

interface Point {
  at: number;
  value: number;
}

function points(raw: unknown, field: string): Point[] {
  if (!Array.isArray(raw)) return [];
  const out: Point[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const at = parseTime(o.time)?.getTime();
    const value = finite(o[field]);
    if (at !== undefined && value !== null && value > 0) out.push({ at, value });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Ближайшая по времени точка в окне склейки. */
function nearest(list: Point[], at: number): number | null {
  let best: Point | null = null;
  for (const p of list) {
    const gap = Math.abs(p.at - at);
    if (gap > MERGE_WINDOW_MS) continue;
    if (!best || gap < Math.abs(best.at - at)) best = p;
  }
  return best?.value ?? null;
}

/**
 * Массивы состава тела из выгрузки → взвешивания. Возвращает [] если в теле нет веса:
 * выгрузка одних тренировок — штатный запрос, ошибкой это не считаем.
 */
export function parseHealthConnectBody(body: unknown): WeightMeasurement[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
  const b = body as Record<string, unknown>;

  const weights = points(b.weight, 'kilograms');
  if (weights.length === 0) return [];
  const fat = points(b.body_fat, 'percentage');
  const lean = points(b.lean_body_mass, 'kilograms');
  const water = points(b.body_water_mass, 'kilograms');

  const result: WeightMeasurement[] = [];
  for (const w of weights) {
    if (w.value > 500) continue;
    const weightKg = Math.round(w.value * 100) / 100;
    const leanKg = nearest(lean, w.at);
    const waterKg = nearest(water, w.at);
    result.push({
      // момент взвешивания между выгрузками не меняется — по нему сервер и дедуплицирует
      measuredAt: new Date(w.at),
      weightKg,
      bodyFat: percent(nearest(fat, w.at)),
      // Health Connect хранит массу, база — долю от веса; считаем от веса того же взвешивания
      muscle: leanKg !== null ? percent((leanKg / weightKg) * 100) : null,
      water: waterKg !== null ? percent((waterKg / weightKg) * 100) : null,
    });
  }
  return result;
}
