import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapWhoopWorkout, parseTzOffset, parseWhoopWebhook } from '../src/services/parsers/whoop';

/** Пример из документации WHOOP API v2. */
const SAMPLE = {
  id: 'ecfc6a15-4661-442f-a9a4-f160dd7afae8',
  v1_id: 1043,
  user_id: 9012,
  created_at: '2022-04-24T11:25:44.774Z',
  updated_at: '2022-04-24T14:25:44.774Z',
  start: '2022-04-24T02:25:44.774Z',
  end: '2022-04-24T03:10:44.774Z',
  timezone_offset: '-05:00',
  sport_name: 'running',
  score_state: 'SCORED',
  score: {
    strain: 8.2463,
    average_heart_rate: 123,
    max_heart_rate: 146,
    kilojoule: 1569.34033203125,
    percent_recorded: 100,
    distance_meter: 1772.77035916,
    zone_durations: { zone_zero_milli: 300000 },
  },
  sport_id: 1,
};

test('mapWhoopWorkout: пример из документации', () => {
  const w = mapWhoopWorkout(SAMPLE)!;
  assert.equal(w.externalId, SAMPLE.id);
  assert.equal(w.durationSec, 45 * 60);
  assert.equal(w.tzOffsetMin, -300);
  assert.deepEqual([w.sport, w.sportRaw], ['run', 'running']);
  assert.equal(w.kcal, 375); // 1569,34 кДж / 4,184
  assert.deepEqual([w.avgHr, w.maxHr, w.distanceM], [123, 146, 1773]);
  assert.equal(w.scoreState, 'SCORED');
});

test('mapWhoopWorkout: в raw нет массивов и зон — только то, что нужно для отладки', () => {
  const raw = mapWhoopWorkout(SAMPLE)!.raw!;
  assert.deepEqual(Object.keys(raw).sort(), [
    'end', 'id', 'score_state', 'sport_id', 'sport_name', 'start', 'timezone_offset', 'updated_at',
  ]);
});

test('mapWhoopWorkout: ещё не посчитанная тренировка берётся без калорий', () => {
  const w = mapWhoopWorkout({ ...SAMPLE, score_state: 'PENDING_SCORE', score: undefined })!;
  assert.equal(w.durationSec, 45 * 60); // для зачёта недели хватает времени и длительности
  assert.deepEqual([w.kcal, w.avgHr, w.strain, w.scoreState], [null, null, null, 'PENDING_SCORE']);
});

test('mapWhoopWorkout: незнакомый вид спорта — other с исходным названием', () => {
  const w = mapWhoopWorkout({ ...SAMPLE, sport_name: 'Underwater Hockey' })!;
  assert.deepEqual([w.sport, w.sportRaw], ['other', 'Underwater Hockey']);
  assert.equal(mapWhoopWorkout({ ...SAMPLE, sport_name: 'Weightlifting' })!.sport, 'strength');
});

test('mapWhoopWorkout: мусор отбрасывается', () => {
  assert.equal(mapWhoopWorkout(null), null);
  assert.equal(mapWhoopWorkout('строка'), null);
  assert.equal(mapWhoopWorkout({ ...SAMPLE, id: undefined }), null);
  assert.equal(mapWhoopWorkout({ ...SAMPLE, start: 'вчера' }), null);
  assert.equal(mapWhoopWorkout({ ...SAMPLE, end: SAMPLE.start }), null); // нулевая длительность
  assert.equal(mapWhoopWorkout({ ...SAMPLE, end: '2022-04-23T02:25:44.774Z' }), null); // конец раньше начала
  assert.equal(mapWhoopWorkout({ ...SAMPLE, end: '2022-04-26T02:25:44.774Z' }), null); // двое суток
});

test('mapWhoopWorkout: числовой id из API v1 приводится к строке', () => {
  assert.equal(mapWhoopWorkout({ ...SAMPLE, id: 1043 })!.externalId, '1043');
});

test('parseTzOffset', () => {
  assert.equal(parseTzOffset('+03:00'), 180);
  assert.equal(parseTzOffset('-05:30'), -330);
  assert.equal(parseTzOffset('Z'), 0);
  assert.equal(parseTzOffset('+0300'), 180);
  assert.equal(parseTzOffset('Europe/Moscow'), null);
  assert.equal(parseTzOffset(undefined), null);
});

test('parseWhoopWebhook: тренировки разбираем, сон и восстановление пропускаем', () => {
  assert.deepEqual(parseWhoopWebhook({ user_id: 9012, id: 'ecfc6a15', type: 'workout.updated', trace_id: 't' }), {
    kind: 'workout_updated',
    whoopUserId: '9012',
    workoutId: 'ecfc6a15',
  });
  assert.equal(parseWhoopWebhook({ user_id: 9012, id: 'x', type: 'workout.deleted' })?.kind, 'workout_deleted');
  assert.deepEqual(parseWhoopWebhook({ user_id: 9012, id: 'x', type: 'sleep.updated' }), {
    kind: 'ignored',
    type: 'sleep.updated',
  });
  assert.equal(parseWhoopWebhook({ type: 'workout.updated' }), null); // без id и пользователя
  assert.equal(parseWhoopWebhook({}), null);
  assert.equal(parseWhoopWebhook(null), null);
});
