import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapHaeWorkout, parseHaeDate, parseHaePayload } from '../src/services/parsers/hae';
import { parseHealthConnectPayload } from '../src/services/parsers/healthConnect';
import { parseHaeBody } from '../src/services/parsers/haeBody';
import { parseHealthConnectBody } from '../src/services/parsers/healthConnectBody';

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

// ---------- Health Connect: состав тела ----------

test('parseHealthConnectBody: вес, жир, мышцы и вода одного взвешивания склеиваются по времени', () => {
  const [m] = parseHealthConnectBody({
    timestamp: '2026-09-22T05:35:00Z',
    weight: [{ kilograms: 113.92, time: '2026-09-22T05:31:12Z' }],
    body_fat: [{ percentage: 30.53, time: '2026-09-22T05:31:14Z' }], // весы пишут точки с разбегом в секунды
    lean_body_mass: [{ kilograms: 79.14, time: '2026-09-22T05:31:12Z' }],
    body_water_mass: [{ kilograms: 56.14, time: '2026-09-22T05:31:12Z' }],
  });
  assert.ok(m);
  assert.equal(m.measuredAt.toISOString(), '2026-09-22T05:31:12.000Z');
  assert.equal(m.weightKg, 113.92);
  assert.equal(m.bodyFat, 30.5);
  assert.equal(m.muscle, 69.5); // 79.14 / 113.92 — база хранит долю, а не килограммы
  assert.equal(m.water, 49.3);
  assert.equal(m.scaleUserId, null); // пишется владельцу токена без профилей openScale
});

test('parseHealthConnectBody: без веса взвешивания нет, тренировочная выгрузка — не ошибка', () => {
  assert.deepEqual(parseHealthConnectBody({ timestamp: '2026-09-22T05:35:00Z', exercise: [] }), []);
  assert.deepEqual(parseHealthConnectBody({ body_fat: [{ percentage: 30.5, time: '2026-09-22T05:31:12Z' }] }), []);
  assert.deepEqual(parseHealthConnectBody(null), []);
  assert.deepEqual(parseHealthConnectBody([]), []);
});

test('parseHealthConnectBody: жир далеко по времени не приклеивается, мусор в процентах → null', () => {
  const [m] = parseHealthConnectBody({
    weight: [{ kilograms: 84.3, time: '2026-09-22T05:31:12Z' }],
    body_fat: [{ percentage: 24.1, time: '2026-09-22T09:00:00Z' }], // другое взвешивание без веса
    lean_body_mass: [{ kilograms: 0, time: '2026-09-22T05:31:12Z' }],
  });
  assert.equal(m!.bodyFat, null);
  assert.equal(m!.muscle, null);
  assert.equal(m!.water, null);
});

test('parseHealthConnectBody: несколько взвешиваний за окно — по записи на каждый вес', () => {
  const list = parseHealthConnectBody({
    weight: [
      { kilograms: 84.3, time: '2026-09-21T05:30:00Z' },
      { kilograms: 84.0, time: '2026-09-22T05:31:12Z' },
    ],
    body_fat: [{ percentage: 24.0, time: '2026-09-22T05:31:12Z' }],
  });
  assert.equal(list.length, 2);
  assert.equal(list[0]!.bodyFat, null);
  assert.equal(list[1]!.bodyFat, 24);
});

// ---------- Health Auto Export: состав тела ----------

/** Метрика выгрузки: имя, единицы и точки с временем телефона. */
function metric(name: string, units: string, qty: number, date = '2026-09-22 08:31:12 +0300') {
  return { name, units, data: [{ qty, date }] };
}

test('parseHaeBody: вес, жир и мышцы одного взвешивания склеиваются по времени', () => {
  const [m] = parseHaeBody({
    data: {
      metrics: [
        metric('weight_body_mass', 'kg', 84.3),
        metric('body_fat_percentage', '%', 24.1, '2026-09-22 08:31:14 +0300'), // весы пишут точки с разбегом в секунды
        metric('lean_body_mass', 'kg', 63.9),
        metric('step_count', 'count', 8500), // посторонние метрики не мешают
      ],
    },
  });
  assert.ok(m);
  assert.equal(m.measuredAt.toISOString(), '2026-09-22T05:31:12.000Z');
  assert.equal(m.weightKg, 84.3);
  assert.equal(m.bodyFat, 24.1);
  assert.equal(m.muscle, 75.8); // 63.9 / 84.3 — база хранит долю, а не килограммы
  assert.equal(m.water, null); // процента воды в HealthKit нет
  assert.equal(m.scaleUserId, null); // пишется владельцу токена без профилей openScale
});

test('parseHaeBody: фунты переводятся в килограммы', () => {
  const [m] = parseHaeBody({ data: { metrics: [metric('weight_body_mass', 'lb', 185.5)] } });
  assert.equal(m?.weightKg, 84.14);
});

test('parseHaeBody: доля жира из HealthKit разворачивается в проценты', () => {
  const [m] = parseHaeBody({
    data: {
      metrics: [metric('weight_body_mass', 'kg', 84.3), metric('body_fat_percentage', '%', 0.241)],
    },
  });
  assert.equal(m?.bodyFat, 24.1); // человека с одним процентом жира не бывает
});

test('parseHaeBody: без веса взвешивания нет, тренировочная выгрузка — не ошибка', () => {
  assert.deepEqual(parseHaeBody({ data: { metrics: [metric('body_fat_percentage', '%', 24.1)] } }), []);
  assert.deepEqual(parseHaeBody({ data: { workouts: [HAE_V2] } }), []);
  assert.deepEqual(parseHaeBody({}), []);
});
