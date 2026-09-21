import type { ExternalWorkout } from '../fitness/workouts';

/**
 * Тренировка WHOOP (API v2) → наша запись. Чистая функция без сети и базы.
 *
 * {
 *   "id": "ecfc6a15-…", "start": "2022-04-24T02:25:44.774Z", "end": "2022-04-24T10:25:44.774Z",
 *   "timezone_offset": "-05:00", "sport_name": "running", "score_state": "SCORED",
 *   "score": { "strain": 8.24, "average_heart_rate": 123, "max_heart_rate": 146,
 *              "kilojoule": 1569.34, "distance_meter": 1772.77, "zone_durations": {…} }
 * }
 *
 * score_state: SCORED — посчитана; PENDING_SCORE — WHOOP ещё считает (придёт второй вебхук);
 * UNSCORABLE — посчитать не смог. Тренировку берём в любом состоянии: для зачёта недели нужны
 * только время и длительность, а калории доедут следующим обновлением.
 */

/** Наши виды активности по названиям WHOOP. Чего нет в карте — «other» с исходным названием. */
const SPORT_MAP: Record<string, string> = {
  running: 'run',
  'trail running': 'run',
  'track & field': 'run',
  cycling: 'cycling',
  'mountain biking': 'cycling',
  spin: 'cycling',
  'assault bike': 'cycling',
  walking: 'walk',
  'hiking/rucking': 'walk',
  swimming: 'swim',
  'water polo': 'swim',
  weightlifting: 'strength',
  powerlifting: 'strength',
  'strength trainer': 'strength',
  'functional fitness': 'hiit',
  hiit: 'hiit',
  crossfit: 'hiit',
  'obstacle course racing': 'hiit',
  yoga: 'yoga',
  'hot yoga': 'yoga',
  pilates: 'yoga',
  stretching: 'yoga',
  meditation: 'yoga',
  soccer: 'team',
  basketball: 'team',
  volleyball: 'team',
  'ice hockey': 'team',
  football: 'team',
  rugby: 'team',
  handball: 'team',
  tennis: 'racket',
  squash: 'racket',
  badminton: 'racket',
  'table tennis': 'racket',
  padel: 'racket',
  pickleball: 'racket',
  boxing: 'martial',
  kickboxing: 'martial',
  'martial arts': 'martial',
  'jiu jitsu': 'martial',
  wrestling: 'martial',
  skiing: 'ski',
  'cross country skiing': 'ski',
  snowboarding: 'ski',
};

const KJ_PER_KCAL = 4.184;

function finite(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function roundOrNull(v: unknown): number | null {
  const n = finite(v);
  return n === null ? null : Math.round(n);
}

/** "+03:00" / "-05:30" / "Z" → минуты. */
export function parseTzOffset(v: unknown): number | null {
  if (v === 'Z') return 0;
  if (typeof v !== 'string') return null;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -minutes : minutes;
}

export function mapWhoopWorkout(input: unknown): ExternalWorkout | null {
  if (!input || typeof input !== 'object') return null;
  const w = input as Record<string, unknown>;

  const id = typeof w.id === 'string' || typeof w.id === 'number' ? String(w.id) : '';
  const startedAt = new Date(String(w.start ?? ''));
  const endedAt = new Date(String(w.end ?? ''));
  if (!id || Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) return null;

  const durationSec = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);
  // отрицательная или нулевая длительность — мусор, а не тренировка
  if (durationSec <= 0 || durationSec > 24 * 3600) return null;

  const score = (w.score && typeof w.score === 'object' ? w.score : {}) as Record<string, unknown>;
  const sportRaw = typeof w.sport_name === 'string' && w.sport_name.trim() ? w.sport_name.trim() : null;
  const kilojoule = finite(score.kilojoule);

  return {
    externalId: id,
    startedAt,
    endedAt,
    durationSec,
    tzOffsetMin: parseTzOffset(w.timezone_offset),
    sport: (sportRaw && SPORT_MAP[sportRaw.toLowerCase()]) || 'other',
    sportRaw,
    kcal: kilojoule === null ? null : Math.round(kilojoule / KJ_PER_KCAL),
    avgHr: roundOrNull(score.average_heart_rate),
    maxHr: roundOrNull(score.max_heart_rate),
    distanceM: roundOrNull(score.distance_meter),
    strain: finite(score.strain),
    scoreState: typeof w.score_state === 'string' ? w.score_state : null,
    raw: {
      id: w.id,
      start: w.start,
      end: w.end,
      timezone_offset: w.timezone_offset,
      sport_name: w.sport_name,
      sport_id: w.sport_id,
      score_state: w.score_state,
      updated_at: w.updated_at,
    },
  };
}

export type WhoopEvent =
  | { kind: 'workout_updated'; whoopUserId: string; workoutId: string }
  | { kind: 'workout_deleted'; whoopUserId: string; workoutId: string }
  | { kind: 'ignored'; type: string };

/** Тело вебхука: { user_id, id, type, trace_id }. Сон и восстановление нам не нужны. */
export function parseWhoopWebhook(body: unknown): WhoopEvent | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const type = typeof b.type === 'string' ? b.type : '';
  if (!type) return null;
  if (type !== 'workout.updated' && type !== 'workout.deleted') return { kind: 'ignored', type };

  const whoopUserId = b.user_id === undefined || b.user_id === null ? '' : String(b.user_id);
  const workoutId = b.id === undefined || b.id === null ? '' : String(b.id);
  if (!whoopUserId || !workoutId) return null;
  return { kind: type === 'workout.updated' ? 'workout_updated' : 'workout_deleted', whoopUserId, workoutId };
}
