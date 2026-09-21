import type { ExternalWorkout } from '../fitness/workouts';

/**
 * Health Auto Export (iOS) → наши тренировки. Приложение читает Apple Health и шлёт его на
 * REST-адрес, поэтому покрывает всё, что пишет в «Здоровье»: Apple Watch, Garmin, Polar, Suunto.
 *
 * Тело запроса: { "data": { "workouts": [ … ], "metrics": [ … ] } }
 *
 * Тренировка формата v2:
 * {
 *   "id": "550e8400-…", "name": "Running",
 *   "start": "2024-02-06 07:00:00 -0800", "end": "2024-02-06 07:30:00 -0800", "duration": 1800,
 *   "activeEnergyBurned": { "qty": 350, "units": "kcal" },
 *   "distance": { "qty": 3.5, "units": "mi" },
 *   "heartRate": { "avg": { "qty": 150, "units": "bpm" }, "max": { "qty": 175, "units": "bpm" } },
 *   "heartRateData": [ … ], "route": [ … ]          // большие массивы — не читаем
 * }
 *
 * Формат v1 старее: нет id и heartRate, энергия лежит в activeEnergy. Единицы зависят от
 * настроек телефона (kcal/kJ, km/mi), название вида — от его языка. Парсер терпим ко всему этому.
 */

const SPORT_MAP: [RegExp, string][] = [
  [/run|бег/i, 'run'],
  [/walk|hik|ходьб|поход/i, 'walk'],
  [/cycl|bik|велос/i, 'cycling'],
  [/swim|плав/i, 'swim'],
  [/strength|weight|functional|core|силов/i, 'strength'],
  [/hiit|interval|cross ?training|кросс|интервал/i, 'hiit'],
  [/yoga|pilates|stretch|flexib|mind|cooldown|йога|пилатес|растяж/i, 'yoga'],
  [/soccer|football|basket|volley|hockey|rugby|handball|футбол|баскет|волейбол|хоккей/i, 'team'],
  [/tennis|badminton|squash|padel|pickle|table tennis|теннис|бадминтон/i, 'racket'],
  [/box|martial|wrestl|kickbox|бокс|единобор|борьб/i, 'martial'],
  [/ski|snowboard|лыж|сноуборд/i, 'ski'],
];

const KJ_PER_KCAL = 4.184;
const METERS: Record<string, number> = { km: 1000, mi: 1609.344, m: 1, ft: 0.3048, yd: 0.9144 };

function qty(v: unknown): { qty: number; units: string } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const n = typeof o.qty === 'string' ? Number(o.qty) : o.qty;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return { qty: n, units: typeof o.units === 'string' ? o.units : '' };
}

/** "2024-02-06 07:00:00 -0800" → момент и смещение пояса в минутах. ISO-строки тоже принимаем. */
export function parseHaeDate(v: unknown): { at: Date; tzOffsetMin: number | null } | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*([+-])(\d{2}):?(\d{2})$/.exec(v.trim());
  if (m) {
    const at = new Date(`${m[1]}T${m[2]}${m[3]}${m[4]}:${m[5]}`);
    if (Number.isNaN(at.getTime())) return null;
    const minutes = Number(m[4]) * 60 + Number(m[5]);
    return { at, tzOffsetMin: m[3] === '-' ? -minutes : minutes };
  }
  const at = new Date(v);
  return Number.isNaN(at.getTime()) ? null : { at, tzOffsetMin: null };
}

function kcalOf(v: unknown): number | null {
  const q = qty(v);
  if (!q || q.qty < 0) return null;
  return Math.round(/kj/i.test(q.units) ? q.qty / KJ_PER_KCAL : q.qty);
}

function metersOf(v: unknown): number | null {
  const q = qty(v);
  if (!q || q.qty < 0) return null;
  const factor = METERS[q.units.toLowerCase()];
  return factor === undefined ? null : Math.round(q.qty * factor);
}

function bpmOf(...candidates: unknown[]): number | null {
  for (const c of candidates) {
    const q = qty(c);
    if (q && q.qty > 0) return Math.round(q.qty);
  }
  return null;
}

function sportOf(name: string | null): string {
  if (!name) return 'other';
  return SPORT_MAP.find(([re]) => re.test(name))?.[1] ?? 'other';
}

export function mapHaeWorkout(input: unknown): ExternalWorkout | null {
  if (!input || typeof input !== 'object') return null;
  const w = input as Record<string, unknown>;

  const start = parseHaeDate(w.start);
  if (!start) return null;
  const end = parseHaeDate(w.end);

  // Длительность: поле в секундах, иначе — разница конца и начала
  let durationSec = typeof w.duration === 'number' && Number.isFinite(w.duration) ? Math.round(w.duration) : 0;
  if (durationSec <= 0 && end) durationSec = Math.round((end.at.getTime() - start.at.getTime()) / 1000);
  if (durationSec <= 0 || durationSec > 24 * 3600) return null;

  const hr = (w.heartRate && typeof w.heartRate === 'object' ? w.heartRate : {}) as Record<string, unknown>;
  const name = typeof w.name === 'string' && w.name.trim() ? w.name.trim() : null;
  // У формата v1 нет id: тогда тренировку опознаём по моменту начала — он у неё один
  const id = typeof w.id === 'string' && w.id.trim() ? w.id.trim() : `start:${start.at.toISOString()}`;

  return {
    externalId: id,
    startedAt: start.at,
    endedAt: end?.at ?? new Date(start.at.getTime() + durationSec * 1000),
    durationSec,
    tzOffsetMin: start.tzOffsetMin,
    sport: sportOf(name),
    sportRaw: name,
    kcal: kcalOf(w.activeEnergyBurned) ?? kcalOf(w.activeEnergy) ?? kcalOf(w.totalEnergy),
    avgHr: bpmOf(hr.avg, w.avgHeartRate),
    maxHr: bpmOf(hr.max, w.maxHeartRate),
    distanceM: metersOf(w.distance),
    strain: null,
    scoreState: null,
    raw: {
      id: w.id,
      name: w.name,
      start: w.start,
      end: w.end,
      duration: w.duration,
      location: w.location,
      activeEnergyBurned: w.activeEnergyBurned ?? w.activeEnergy,
      distance: w.distance,
    },
  };
}

/** Тренировки из тела запроса. null — это вообще не выгрузка Health Auto Export. */
export function parseHaePayload(body: unknown): ExternalWorkout[] | null {
  if (!body || typeof body !== 'object') return null;
  const data = (body as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return null;
  const workouts = (data as { workouts?: unknown }).workouts;
  // Выгрузка одних метрик (шаги, сон) — законный запрос без тренировок
  if (workouts === undefined || workouts === null) return [];
  if (!Array.isArray(workouts)) return null;

  const result: ExternalWorkout[] = [];
  for (const w of workouts) {
    const mapped = mapHaeWorkout(w);
    if (mapped) result.push(mapped);
  }
  return result;
}
