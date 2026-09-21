import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapHaeWorkout, parseHaeDate, parseHaePayload } from '../src/services/parsers/hae';
import { parseHealthConnectPayload } from '../src/services/parsers/healthConnect';

// ---------- Health Auto Export ----------

/** Пример тренировки v2 из документации приложения. */
const HAE_V2 = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  name: 'Running',
  start: '2024-02-06 07:00:00 -0800',
  end: '2024-02-06 07:30:00 -0800',
  duration: 1800,
  location: 'Outdoor',
  activeEnergyBurned: { qty: 350, units: 'kcal' },
  totalEnergy: { qty: 450, units: 'kcal' },
  distance: { qty: 3.5, units: 'mi' },
  heartRate: { min: { qty: 120, units: 'bpm' }, avg: { qty: 150, units: 'bpm' }, max: { qty: 175, units: 'bpm' } },
  heartRateData: [{ date: '2024-02-06 07:00:00 -0800', Avg: 150 }],
  route: [{ latitude: 37.77, longitude: -122.41 }],
};

test('parseHaeDate: формат приложения со смещением пояса', () => {
  const d = parseHaeDate('2024-02-06 07:00:00 -0800')!;
  assert.equal(d.at.toISOString(), '2024-02-06T15:00:00.000Z');
  assert.equal(d.tzOffsetMin, -480);
  assert.equal(parseHaeDate('2024-02-06 18:30:00 +0300')!.at.toISOString(), '2024-02-06T15:30:00.000Z');
  assert.equal(parseHaeDate('2024-02-06T15:00:00Z')!.tzOffsetMin, null); // ISO тоже понимаем
  assert.equal(parseHaeDate('вчера'), null);
  assert.equal(parseHaeDate(undefined), null);
});

test('mapHaeWorkout: пример v2 из документации', () => {
  const w = mapHaeWorkout(HAE_V2)!;
  assert.equal(w.externalId, HAE_V2.id);
  assert.equal(w.startedAt.toISOString(), '2024-02-06T15:00:00.000Z');
  assert.deepEqual([w.durationSec, w.tzOffsetMin, w.sport, w.sportRaw], [1800, -480, 'run', 'Running']);
  assert.deepEqual([w.kcal, w.avgHr, w.maxHr], [350, 150, 175]);
  assert.equal(w.distanceM, 5633); // 3,5 мили
});

test('mapHaeWorkout: в raw не попадают пульс по секундам и маршрут', () => {
  const raw = mapHaeWorkout(HAE_V2)!.raw!;
  assert.equal('heartRateData' in raw, false);
  assert.equal('route' in raw, false);
});

test('mapHaeWorkout: единицы зависят от настроек телефона — килоджоули и километры', () => {
  const w = mapHaeWorkout({ ...HAE_V2, activeEnergyBurned: { qty: 1464.4, units: 'kJ' }, distance: { qty: 5, units: 'km' } })!;
  assert.deepEqual([w.kcal, w.distanceM], [350, 5000]);
});

test('mapHaeWorkout: формат v1 — без id, энергия в activeEnergy, пульс отдельными полями', () => {
  const w = mapHaeWorkout({
    name: 'Traditional Strength Training',
    start: '2024-02-06 19:00:00 +0300',
    end: '2024-02-06 20:00:00 +0300',
    activeEnergy: { qty: 410, units: 'kcal' },
    avgHeartRate: { qty: 118, units: 'bpm' },
    maxHeartRate: { qty: 152, units: 'bpm' },
  })!;
  // без id тренировку опознаём по моменту начала — повторная выгрузка даст тот же ключ
  assert.equal(w.externalId, 'start:2024-02-06T16:00:00.000Z');
  assert.deepEqual([w.durationSec, w.sport, w.kcal, w.avgHr, w.maxHr], [3600, 'strength', 410, 118, 152]);
});

test('mapHaeWorkout: название на языке телефона', () => {
  assert.equal(mapHaeWorkout({ ...HAE_V2, name: 'Бег на улице' })!.sport, 'run');
  assert.equal(mapHaeWorkout({ ...HAE_V2, name: 'Силовая тренировка' })!.sport, 'strength');
  const unknown = mapHaeWorkout({ ...HAE_V2, name: 'Подводное плетение корзин' })!;
  assert.deepEqual([unknown.sport, unknown.sportRaw], ['other', 'Подводное плетение корзин']);
});

test('mapHaeWorkout: мусор отбрасывается', () => {
  assert.equal(mapHaeWorkout(null), null);
  assert.equal(mapHaeWorkout({ ...HAE_V2, start: undefined }), null);
  assert.equal(mapHaeWorkout({ ...HAE_V2, duration: 0, end: HAE_V2.start }), null);
  assert.equal(mapHaeWorkout({ ...HAE_V2, duration: 90000 }), null); // больше суток
});

test('parseHaePayload: обёртка data.workouts', () => {
  assert.equal(parseHaePayload({ data: { workouts: [HAE_V2, { name: 'битая' }] } })!.length, 1);
  assert.deepEqual(parseHaePayload({ data: { metrics: [] } }), []); // выгрузка одних метрик — не ошибка
  assert.equal(parseHaePayload({ workouts: [HAE_V2] }), null); // не тот формат
  assert.equal(parseHaePayload({ data: { workouts: 'нет' } }), null);
  assert.equal(parseHaePayload('строка'), null);
});

// ---------- Health Connect Webhook ----------

const HC = {
  timestamp: '2026-05-09T14:00:00.123Z',
  app_version: '1.2.3',
  exercise: [
    { type: 'EXERCISE_TYPE_RUNNING', start_time: '2026-05-09T06:00:00Z', end_time: '2026-05-09T06:40:00Z', duration_seconds: 2400, distance_meters: 6100.4 },
  ],
  active_calories: [
    { calories: 100, start_time: '2026-05-09T05:50:00Z', end_time: '2026-05-09T06:10:00Z' }, // наполовину до тренировки
    { calories: 300, start_time: '2026-05-09T06:10:00Z', end_time: '2026-05-09T06:40:00Z' },
    { calories: 80, start_time: '2026-05-09T09:00:00Z', end_time: '2026-05-09T09:30:00Z' }, // другая часть дня
  ],
  heart_rate: [
    { bpm: 90, time: '2026-05-09T05:55:00Z' }, // до тренировки
    { bpm: 140, time: '2026-05-09T06:10:00Z' },
    { bpm: 160, time: '2026-05-09T06:30:00Z' },
  ],
};

test('parseHealthConnectPayload: калории и пульс собираются по пересечению во времени', () => {
  const [w] = parseHealthConnectPayload(HC)!;
  assert.equal(w!.externalId, 'start:2026-05-09T06:00:00.000Z');
  assert.deepEqual([w!.durationSec, w!.sport, w!.sportRaw, w!.distanceM], [2400, 'run', 'running', 6100]);
  assert.equal(w!.kcal, 350); // половина первой записи + вторая целиком; дневная не в счёт
  assert.deepEqual([w!.avgHr, w!.maxHr], [150, 160]);
});

test('parseHealthConnectPayload: агрегированный пульс и тренировка без калорий', () => {
  const [w] = parseHealthConnectPayload({
    timestamp: HC.timestamp,
    exercise: [{ type: 'strength_training', start_time: '2026-05-09T06:00:00Z', end_time: '2026-05-09T07:00:00Z', duration_seconds: 3600 }],
    heart_rate: [{ time: '2026-05-09T06:30:00Z', avg: 118, min: 95, max: 149 }],
  })!;
  assert.deepEqual([w!.sport, w!.kcal, w!.avgHr, w!.maxHr, w!.distanceM], ['strength', null, 118, 149, null]);
});

test('parseHealthConnectPayload: повторная выгрузка окна даёт тот же ключ тренировки', () => {
  const again = { ...HC, timestamp: '2026-05-09T16:00:00.000Z' };
  assert.equal(parseHealthConnectPayload(HC)![0]!.externalId, parseHealthConnectPayload(again)![0]!.externalId);
});

test('parseHealthConnectPayload: длительность из границ, незнакомый вид, мусор', () => {
  const parsed = parseHealthConnectPayload({
    timestamp: HC.timestamp,
    exercise: [
      { type: 'PADDLING', start_time: '2026-05-09T06:00:00Z', end_time: '2026-05-09T06:50:00Z' },
      { type: 'RUNNING', start_time: 'когда-то' },
      { type: 'RUNNING', start_time: '2026-05-09T06:00:00Z', duration_seconds: 0 },
      null,
    ],
  })!;
  assert.equal(parsed.length, 1);
  assert.deepEqual([parsed[0]!.durationSec, parsed[0]!.sport, parsed[0]!.sportRaw], [3000, 'other', 'paddling']);
});

test('parseHealthConnectPayload: выгрузка без тренировок — не ошибка, чужой формат — ошибка', () => {
  assert.deepEqual(parseHealthConnectPayload({ timestamp: HC.timestamp, steps: [] }), []);
  assert.equal(parseHealthConnectPayload({ foo: 'bar' }), null);
  assert.equal(parseHealthConnectPayload({ timestamp: HC.timestamp, exercise: 'нет' }), null);
  assert.equal(parseHealthConnectPayload([]), null);
  assert.equal(parseHealthConnectPayload(null), null);
});
