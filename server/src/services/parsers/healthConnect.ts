import type { ExternalWorkout } from '../fitness/workouts';

/**
 * Health Connect Webhook (Android) → наши тренировки. Приложение читает Health Connect, куда
 * пишут Mi Fitness, Zepp (Amazfit), Samsung Health, Garmin Connect, Polar Flow и другие.
 *
 * {
 *   "timestamp": "2026-05-09T14:00:00.123Z", "app_version": "1.2.3",
 *   "exercise":        [ { "type": "RUNNING", "start_time": "…Z", "end_time": "…Z",
 *                          "duration_seconds": 1800, "distance_meters": 5200 } ],
 *   "active_calories": [ { "calories": 120, "start_time": "…Z", "end_time": "…Z" } ],
 *   "heart_rate":      [ { "bpm": 142, "time": "…Z" } ]   // либо { time, avg, min, max }
 * }
 *
 * Две особенности формата. У тренировки нет ни id, ни калорий: опознаём её по моменту начала,
 * а калории и пульс собираем из соседних массивов по пересечению во времени. И приложение
 * шлёт скользящее окно в 48 часов — одна тренировка приходит много раз, это штатно.
 */

const SPORT_MAP: [RegExp, string][] = [
  [/RUNNING/, 'run'],
  [/WALKING|HIKING/, 'walk'],
  [/BIKING|CYCLING/, 'cycling'],
  [/SWIMMING/, 'swim'],
  [/STRENGTH|WEIGHTLIFTING|CALISTHENICS/, 'strength'],
  [/HIGH_INTENSITY|BOOT_CAMP|CROSS_TRAINING|ROWING|STAIR|ELLIPTICAL/, 'hiit'],
  [/YOGA|PILATES|STRETCHING|GUIDED_BREATHING/, 'yoga'],
  [/SOCCER|FOOTBALL|BASKETBALL|VOLLEYBALL|HOCKEY|RUGBY|HANDBALL|BASEBALL|CRICKET/, 'team'],
  [/TENNIS|BADMINTON|SQUASH|RACQUETBALL/, 'racket'],
  [/BOXING|MARTIAL_ARTS|WRESTLING|FENCING/, 'martial'],
  [/SKIING|SNOWBOARDING|SNOWSHOEING|SKATING/, 'ski'],
];

function parseTime(v: unknown): Date | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const at = new Date(v);
  return Number.isNaN(at.getTime()) ? null : at;
}

function finite(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** "EXERCISE_TYPE_RUNNING_TREADMILL" / "running" → ключ нашего справочника и читаемое название. */
function sportOf(type: unknown): { sport: string; sportRaw: string | null } {
  if (typeof type !== 'string' && typeof type !== 'number') return { sport: 'other', sportRaw: null };
  const normalized = String(type).toUpperCase().replace(/^EXERCISE_TYPE_/, '').replace(/[\s-]+/g, '_');
  const sport = SPORT_MAP.find(([re]) => re.test(normalized))?.[1] ?? 'other';
  return { sport, sportRaw: normalized.toLowerCase().replace(/_/g, ' ') };
}

interface Span {
  start: number;
  end: number;
  calories: number;
}

/**
 * Калории за интервал тренировки: записи энергии берутся пропорционально пересечению. Браслеты
 * пишут энергию кусками по своей сетке, и кусок на границе тренировки принадлежит ей лишь частично.
 */
function caloriesWithin(spans: Span[], start: number, end: number): number | null {
  let total = 0;
  let found = false;
  for (const s of spans) {
    const overlap = Math.min(s.end, end) - Math.max(s.start, start);
    if (overlap <= 0) continue;
    found = true;
    total += s.calories * (overlap / Math.max(1, s.end - s.start));
  }
  return found ? Math.round(total) : null;
}

export function parseHealthConnectPayload(body: unknown): ExternalWorkout[] | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  // Это вообще выгрузка приложения? У неё всегда есть метка времени либо хотя бы один массив данных
  if (b.timestamp === undefined && !Object.values(b).some(Array.isArray)) return null;
  if (b.exercise === undefined || b.exercise === null) return [];
  if (!Array.isArray(b.exercise)) return null;

  const spans: Span[] = [];
  for (const raw of Array.isArray(b.active_calories) ? b.active_calories : []) {
    const c = raw as Record<string, unknown>;
    const start = parseTime(c.start_time)?.getTime();
    const end = parseTime(c.end_time)?.getTime();
    const calories = finite(c.calories);
    if (start !== undefined && end !== undefined && end > start && calories !== null && calories >= 0) {
      spans.push({ start, end, calories });
    }
  }

  const beats: { at: number; avg: number; max: number }[] = [];
  for (const raw of Array.isArray(b.heart_rate) ? b.heart_rate : []) {
    const h = raw as Record<string, unknown>;
    const at = parseTime(h.time)?.getTime();
    const avg = finite(h.avg) ?? finite(h.bpm);
    if (at !== undefined && avg !== null && avg > 0) beats.push({ at, avg, max: finite(h.max) ?? avg });
  }

  const result: ExternalWorkout[] = [];
  for (const raw of b.exercise) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    const startedAt = parseTime(e.start_time);
    if (!startedAt) continue;
    const endedAt = parseTime(e.end_time);

    let durationSec = Math.round(finite(e.duration_seconds) ?? 0);
    if (durationSec <= 0 && endedAt) durationSec = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);
    if (durationSec <= 0 || durationSec > 24 * 3600) continue;

    const from = startedAt.getTime();
    const to = endedAt?.getTime() ?? from + durationSec * 1000;
    const inside = beats.filter((h) => h.at >= from && h.at <= to);
    const distance = finite(e.distance_meters);

    result.push({
      // id в JSON нет; момент начала у тренировки один и между выгрузками не меняется
      externalId: `start:${startedAt.toISOString()}`,
      startedAt,
      endedAt: endedAt ?? new Date(to),
      durationSec,
      tzOffsetMin: null,
      ...sportOf(e.type),
      kcal: caloriesWithin(spans, from, to),
      avgHr: inside.length ? Math.round(inside.reduce((s, h) => s + h.avg, 0) / inside.length) : null,
      maxHr: inside.length ? Math.round(Math.max(...inside.map((h) => h.max))) : null,
      distanceM: distance !== null && distance >= 0 ? Math.round(distance) : null,
      strain: null,
      scoreState: null,
      raw: { ...e },
    });
  }
  return result;
}
