/**
 * Разбор вебхука openScale sync (Android-компаньон приложения openScale).
 *
 * Приложение слушает весы по Bluetooth и на каждое изменение шлёт POST с JSON:
 *   { "event": "test" }
 *   { "event": "insert" | "update", "id": 12, "userId": 1, "username": "Олег",
 *     "date": "2026-09-21T07:14:33.120Z", "weight": 78.4, "body_fat": 18.2,
 *     "water": 55.1, "muscle": 42.0, "values": [...] }
 *   { "event": "insert" | "update", "measurements": [ {...}, {...} ] }  // пачкой
 *   { "event": "delete", "userId": 1, "date": "..." }
 *   { "event": "clear", "userId": 1 }
 *
 * Вес приходит в килограммах, жир/вода/мышцы — в процентах. Отсутствующие метрики
 * приложение шлёт нулями, поэтому 0 трактуем как «не измерено».
 */

export interface ScaleMeasurement {
  scaleEntryId: number | null;
  scaleUserId: number | null;
  scaleUsername: string | null;
  measuredAt: Date;
  weightKg: number;
  bodyFat: number | null;
  water: number | null;
  muscle: number | null;
}

export type ScaleEvent =
  | { kind: 'test' }
  | { kind: 'upsert'; measurements: ScaleMeasurement[] }
  | { kind: 'delete'; scaleUserId: number | null; measuredAt: Date }
  | { kind: 'clear'; scaleUserId: number | null }
  | { kind: 'unsupported'; event: string };

type Raw = Record<string, unknown>;

function num(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** Метрика состава тела: 0 и мусор → null, проценты держим в разумных границах. */
function percent(value: unknown): number | null {
  const n = num(value);
  if (n === null || n <= 0 || n > 100) return null;
  return Math.round(n * 10) / 10;
}

function parseDate(value: unknown): Date | null {
  if (typeof value === 'number') {
    const fromEpoch = new Date(value < 1e12 ? value * 1000 : value);
    return Number.isNaN(fromEpoch.getTime()) ? null : fromEpoch;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseMeasurement(raw: Raw): ScaleMeasurement | null {
  const measuredAt = parseDate(raw.date ?? raw.dateTime ?? raw.timestamp);
  const weight = num(raw.weight);
  // Без веса мерить нечего: openScale сам пропускает такие записи.
  if (!measuredAt || weight === null || weight <= 0 || weight > 500) return null;

  return {
    scaleEntryId: num(raw.id),
    scaleUserId: num(raw.userId),
    scaleUsername: typeof raw.username === 'string' && raw.username.trim() ? raw.username.trim() : null,
    measuredAt,
    weightKg: Math.round(weight * 100) / 100,
    bodyFat: percent(raw.body_fat ?? raw.fat),
    water: percent(raw.water),
    muscle: percent(raw.muscle),
  };
}

export function parseScaleWebhook(body: unknown): ScaleEvent | null {
  if (!body || typeof body !== 'object') return null;
  const raw = body as Raw;
  const event = typeof raw.event === 'string' ? raw.event.toLowerCase() : '';

  if (event === 'test') return { kind: 'test' };

  if (event === 'delete') {
    const measuredAt = parseDate(raw.date);
    if (!measuredAt) return null;
    return { kind: 'delete', scaleUserId: num(raw.userId), measuredAt };
  }

  if (event === 'clear') {
    return { kind: 'clear', scaleUserId: num(raw.userId) };
  }

  if (event === 'insert' || event === 'update' || event === '') {
    const batch = Array.isArray(raw.measurements) ? (raw.measurements as Raw[]) : null;
    const items = batch ?? [raw];
    const measurements = items
      .filter((item): item is Raw => !!item && typeof item === 'object')
      .map(parseMeasurement)
      .filter((m): m is ScaleMeasurement => m !== null);
    if (measurements.length === 0) return null;
    return { kind: 'upsert', measurements };
  }

  return { kind: 'unsupported', event: event || 'unknown' };
}
