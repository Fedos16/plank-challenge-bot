import type { Challenge, Prisma, Workout } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { dateToDay, deadlineInstant, dayjs, type DayStr } from '../../lib/time';
import type { DayWindow } from '../../lib/weeks';
import { challengeEndDay } from '../challenge';
import { assignDuplicates, classify, type CountingRules, type Session, type Verdict } from './counting';

/** Виды активности для ручного ввода. Источники присылают свои названия — они ложатся в sportRaw. */
export const SPORTS = [
  'strength',
  'run',
  'walk',
  'cycling',
  'swim',
  'hiit',
  'yoga',
  'team',
  'racket',
  'martial',
  'ski',
  'other',
] as const;
export type Sport = (typeof SPORTS)[number];

export const MANUAL_SOURCE = 'manual';

/** Насколько шире окна тренировки ищем соседей при пересчёте дублей. */
const DUPLICATE_SCAN_MS = 24 * 3600 * 1000;

export function rulesOf(ch: Challenge): CountingRules {
  return { minWorkoutMin: ch.minWorkoutMin, maxWorkoutsPerDay: ch.maxWorkoutsPerDay, tz: ch.timezone };
}

/** Окно дней → полуинтервал моментов [from, to) в поясе челленджа. */
export function windowInstants(
  window: Pick<DayWindow, 'start' | 'end'>,
  tz: string,
): { from: Date; to: Date } {
  const nextDay = dayjs.utc(window.end).add(1, 'day').format('YYYY-MM-DD');
  return { from: deadlineInstant(window.start, '00:00', tz), to: deadlineInstant(nextDay, '00:00', tz) };
}

/** Живые (не удалённые) тренировки пользователя за период. */
export async function loadWorkouts(userId: number, from: Date, to: Date): Promise<Workout[]> {
  return prisma.workout.findMany({
    where: { userId, deletedAt: null, startedAt: { gte: from, lt: to } },
    orderBy: { startedAt: 'asc' },
  });
}

export interface WorkoutDTO {
  id: number;
  source: string;
  sport: string;
  sportRaw: string | null;
  startedAt: string;
  durationMin: number;
  kcal: number | null;
  avgHr: number | null;
  distanceM: number | null;
  note: string | null;
  /** Идёт ли в зачёт недели этого челленджа и если нет — почему. */
  verdict: Verdict;
  excludedNote: string | null;
  /** Засчитана админом вручную, вопреки длительности или лимиту дня. */
  forceCounted: boolean;
  forceNote: string | null;
  /**
   * Часть общей тренировки, если источник разрезал занятие на несколько записей.
   * null — запись сама по себе. В зачёт идёт сессия целиком, поэтому её длительность
   * важнее длительности отдельного сегмента.
   */
  session: WorkoutSessionDTO | null;
}

export interface WorkoutSessionDTO {
  id: number;
  durationMin: number;
  size: number;
  /** Виды активности внутри занятия, без повторов, от самого длинного: для названия «Ходьба и силовая». */
  parts: { sport: string; sportRaw: string | null }[];
}

/** Как показывается вид активности: у «other» название приходит от источника. */
function sportKey(w: Workout): string {
  return w.sport === 'other' ? `other:${w.sportRaw ?? ''}` : w.sport;
}

/** Описание сессии для DTO. null — занятие из одной записи, показывать нечего. */
export function describeSession(session: Session, segments: Workout[]): WorkoutSessionDTO | null {
  if (segments.length < 2) return null;
  const parts: { sport: string; sportRaw: string | null }[] = [];
  const seen = new Set<string>();
  for (const w of [...segments].sort((a, b) => b.durationSec - a.durationSec)) {
    const key = sportKey(w);
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push({ sport: w.sport, sportRaw: w.sportRaw });
  }
  return {
    id: session.id,
    durationMin: Math.round(session.durationSec / 60),
    size: segments.length,
    parts,
  };
}

/** Описание сессии для каждой записи, входящей в занятие из нескольких частей. */
export function describeSessions(sessions: Session[], workouts: Workout[]): Map<number, WorkoutSessionDTO> {
  const byId = new Map(workouts.map((w) => [w.id, w]));
  const result = new Map<number, WorkoutSessionDTO>();
  for (const s of sessions) {
    const segments = s.workoutIds
      .map((id) => byId.get(id))
      .filter((w): w is Workout => w !== undefined);
    const dto = describeSession(s, segments);
    if (!dto) continue;
    for (const id of s.workoutIds) result.set(id, dto);
  }
  return result;
}

export function toWorkoutDTO(w: Workout, verdict: Verdict, session?: WorkoutSessionDTO | null): WorkoutDTO {
  return {
    id: w.id,
    source: w.source,
    sport: w.sport,
    sportRaw: w.sportRaw,
    startedAt: w.startedAt.toISOString(),
    durationMin: Math.round(w.durationSec / 60),
    kcal: w.kcal,
    avgHr: w.avgHr,
    distanceM: w.distanceM,
    note: w.note,
    verdict,
    excludedNote: w.excludedNote,
    forceCounted: w.forceCounted,
    forceNote: w.forceNote,
    session: session ?? null,
  };
}

/**
 * Сессия одной строкой: разрезанное источником занятие в ленте должно выглядеть как одна
 * тренировка. Длительность, калории и дистанция суммируются по сегментам, вид спорта берём
 * у самого длинного из них, время — у первого.
 */
export function sessionToWorkoutDTO(items: Workout[], session: Session): WorkoutDTO | null {
  const first = items[0];
  if (!first) return null;
  const main = items.reduce((a, b) => (b.durationSec > a.durationSec ? b : a), first);
  const sum = (pick: (w: Workout) => number | null): number | null => {
    const values = items.map(pick).filter((v): v is number => v !== null);
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  };
  return {
    ...toWorkoutDTO(main, session.verdict, describeSession(session, items)),
    startedAt: first.startedAt.toISOString(),
    durationMin: Math.round(session.durationSec / 60),
    kcal: sum((w) => w.kcal),
    distanceM: sum((w) => w.distanceM),
  };
}

/** Период челленджа как моменты: от старта до конца (у бессрочного — до «сейчас плюс сутки»). */
export function challengeInstants(ch: Challenge): { from: Date; to: Date } {
  const start = dateToDay(ch.startDate);
  const end: DayStr = challengeEndDay(ch) ?? dayjs().add(1, 'day').format('YYYY-MM-DD');
  return windowInstants({ start, end }, ch.timezone);
}

/** Журнал тренировок участника за время челленджа, от новых к старым, с вердиктами. */
export async function listWorkouts(ch: Challenge, userId: number): Promise<WorkoutDTO[]> {
  const { from, to } = challengeInstants(ch);
  const workouts = await loadWorkouts(userId, from, to);
  const { verdicts, sessions } = classify(workouts, rulesOf(ch));
  const bySession = describeSessions(sessions, workouts);
  return workouts
    .map((w) => toWorkoutDTO(w, verdicts.get(w.id) ?? 'counted', bySession.get(w.id)))
    .reverse();
}

/**
 * Пересчитывает дубли вокруг изменившейся тренировки. Зовётся после каждой вставки, правки
 * и удаления: при удалении основной записи её дубль должен снова стать основным.
 */
export async function reassignDuplicates(userId: number, around: Date, durationSec: number): Promise<void> {
  const from = new Date(around.getTime() - DUPLICATE_SCAN_MS);
  const to = new Date(around.getTime() + durationSec * 1000 + DUPLICATE_SCAN_MS);
  const workouts = await loadWorkouts(userId, from, to);
  const assigned = assignDuplicates(workouts);

  for (const w of workouts) {
    const next = assigned.get(w.id) ?? null;
    if (next !== w.duplicateOfId) {
      await prisma.workout.update({ where: { id: w.id }, data: { duplicateOfId: next } });
    }
  }
}

export type WorkoutError =
  | 'bad_client_id'
  | 'bad_sport'
  | 'bad_started_at'
  | 'bad_workout_duration'
  | 'bad_kcal'
  | 'bad_distance'
  | 'bad_hr'
  | 'bad_note'
  | 'not_found'
  | 'not_editable';

interface ManualFields {
  sport: Sport;
  startedAt: Date;
  durationSec: number;
  tzOffsetMin: number | null;
  kcal: number | null;
  distanceM: number | null;
  avgHr: number | null;
  note: string | null;
}

/** Необязательное целое в диапазоне: пусто — null, мусор — 'bad'. */
function optionalInt(v: unknown, min: number, max: number): number | null | 'bad' {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : 'bad';
}

function parseManual(body: Record<string, unknown>): ManualFields | WorkoutError {
  const sport = body.sport as Sport;
  if (!SPORTS.includes(sport)) return 'bad_sport';

  const startedAt = typeof body.startedAt === 'string' ? new Date(body.startedAt) : new Date(NaN);
  const now = Date.now();
  // будущее не принимаем (сутки запаса на пояса), глубокое прошлое — тоже: это уже не журнал
  if (
    Number.isNaN(startedAt.getTime()) ||
    startedAt.getTime() > now + 86_400_000 ||
    startedAt.getTime() < now - 400 * 86_400_000
  ) {
    return 'bad_started_at';
  }

  const durationMin = Number(body.durationMin);
  if (!Number.isFinite(durationMin) || durationMin < 1 || durationMin > 24 * 60) return 'bad_workout_duration';

  const kcal = optionalInt(body.kcal, 0, 20000);
  if (kcal === 'bad') return 'bad_kcal';
  const distanceM = optionalInt(body.distanceM, 0, 1_000_000);
  if (distanceM === 'bad') return 'bad_distance';
  const avgHr = optionalInt(body.avgHr, 30, 250);
  if (avgHr === 'bad') return 'bad_hr';
  const tzOffsetMin = optionalInt(body.tzOffsetMin, -840, 840);

  let note: string | null = null;
  if (typeof body.note === 'string' && body.note.trim()) {
    note = body.note.trim();
    if (note.length > 300) return 'bad_note';
  }

  return {
    sport,
    startedAt,
    durationSec: Math.round(durationMin * 60),
    tzOffsetMin: tzOffsetMin === 'bad' ? null : tzOffsetMin,
    kcal,
    distanceM,
    avgHr,
    note,
  };
}

/**
 * Ручная тренировка. clientId — UUID, который клиент генерирует один раз на форму: повторная
 * отправка (двойной тап, ретрай на плохой сети) находит ту же запись, а не создаёт вторую.
 */
export async function createManualWorkout(
  userId: number,
  body: Record<string, unknown>,
): Promise<Workout | WorkoutError> {
  const clientId = body.clientId;
  if (typeof clientId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(clientId)) return 'bad_client_id';
  const fields = parseManual(body);
  if (typeof fields === 'string') return fields;

  const key = { userId_source_externalId: { userId, source: MANUAL_SOURCE, externalId: clientId } };
  const existing = await prisma.workout.findUnique({ where: key });
  if (existing) return existing;

  const endedAt = new Date(fields.startedAt.getTime() + fields.durationSec * 1000);
  let created: Workout;
  try {
    created = await prisma.workout.create({
      data: { userId, source: MANUAL_SOURCE, externalId: clientId, endedAt, ...fields },
    });
  } catch {
    // гонка двух одинаковых запросов: второй упирается в уникальный индекс
    const raced = await prisma.workout.findUnique({ where: key });
    if (!raced) throw new Error('workout create failed');
    return raced;
  }
  await reassignDuplicates(userId, created.startedAt, created.durationSec);
  return created;
}

/** Править можно только свои ручные записи: данные с устройств приходят как есть. */
export async function updateManualWorkout(
  userId: number,
  id: number,
  body: Record<string, unknown>,
): Promise<Workout | WorkoutError> {
  const existing = await prisma.workout.findFirst({ where: { id, userId, deletedAt: null } });
  if (!existing) return 'not_found';
  if (existing.source !== MANUAL_SOURCE) return 'not_editable';
  const fields = parseManual(body);
  if (typeof fields === 'string') return fields;

  const endedAt = new Date(fields.startedAt.getTime() + fields.durationSec * 1000);
  const updated = await prisma.workout.update({ where: { id }, data: { ...fields, endedAt } });
  // соседи могли измениться и на старом месте, и на новом
  await reassignDuplicates(userId, existing.startedAt, existing.durationSec);
  await reassignDuplicates(userId, updated.startedAt, updated.durationSec);
  return updated;
}

/**
 * Удаление — тумбстоун: строка остаётся с deletedAt, иначе следующая синхронизация с устройства
 * вернула бы удалённую тренировку обратно.
 */
export async function deleteWorkout(userId: number, id: number): Promise<boolean> {
  const existing = await prisma.workout.findFirst({ where: { id, userId, deletedAt: null } });
  if (!existing) return false;
  await prisma.workout.update({ where: { id }, data: { deletedAt: new Date(), duplicateOfId: null } });
  await reassignDuplicates(userId, existing.startedAt, existing.durationSec);
  return true;
}

// ---------- тренировки из внешних источников ----------

/** Тренировка, как её отдал парсер источника: уже нормализована, без привязки к пользователю. */
export interface ExternalWorkout {
  externalId: string;
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number;
  tzOffsetMin: number | null;
  sport: string;
  sportRaw: string | null;
  kcal: number | null;
  avgHr: number | null;
  maxHr: number | null;
  distanceM: number | null;
  strain: number | null;
  scoreState: string | null;
  /** Урезанный исходник для отладки парсера — без массивов (пульс по секундам, маршрут). */
  raw: Record<string, unknown> | null;
}

export interface SaveExternalResult {
  created: Workout[];
  updated: Workout[];
  /** Пользователь удалил эту тренировку у нас — синхронизация её не возвращает. */
  skippedDeleted: number;
}

/**
 * Сохраняет тренировки источника идемпотентно: одна и та же запись приходит много раз
 * (ретраи вебхука, повторная сверка, бэкфилл истории). Ключ — (пользователь, источник,
 * внешний id). Снятие с зачёта админом и тумбстоун пользователя синхронизация не трогает.
 */
export async function saveExternalWorkouts(
  userId: number,
  source: string,
  items: ExternalWorkout[],
): Promise<SaveExternalResult> {
  const result: SaveExternalResult = { created: [], updated: [], skippedDeleted: 0 };

  for (const item of items) {
    const key = { userId_source_externalId: { userId, source, externalId: item.externalId } };
    const { externalId, raw, ...fields } = item;
    const data = { ...fields, raw: (raw ?? undefined) as Prisma.InputJsonValue | undefined };

    let existing = await prisma.workout.findUnique({ where: key });
    if (!existing) {
      try {
        result.created.push(await prisma.workout.create({ data: { userId, source, externalId, ...data } }));
        continue;
      } catch {
        // гонка с параллельной доставкой того же события: запись уже создана — обновим её
        existing = await prisma.workout.findUnique({ where: key });
        if (!existing) throw new Error('external workout create failed');
      }
    }
    if (existing.deletedAt) {
      result.skippedDeleted += 1;
      continue;
    }
    result.updated.push(await prisma.workout.update({ where: { id: existing.id }, data }));
  }

  for (const w of [...result.created, ...result.updated]) {
    await reassignDuplicates(userId, w.startedAt, w.durationSec);
  }
  return result;
}

/**
 * Источник сообщил, что тренировка удалена (человек стёр её в приложении браслета).
 * Это точечное событие, и оно обратимо — в отличие от «очистить всё», которому мы не верим.
 */
export async function deleteExternalWorkout(userId: number, source: string, externalId: string): Promise<boolean> {
  const existing = await prisma.workout.findUnique({
    where: { userId_source_externalId: { userId, source, externalId } },
  });
  if (!existing || existing.deletedAt) return false;
  await prisma.workout.update({ where: { id: existing.id }, data: { deletedAt: new Date(), duplicateOfId: null } });
  await reassignDuplicates(userId, existing.startedAt, existing.durationSec);
  return true;
}

/** Админ снимает тренировку с зачёта (аналог «фейка» в планке) или возвращает её. */
export async function setWorkoutExcluded(
  workoutId: number,
  userId: number,
  excluded: boolean,
  note: string | null,
): Promise<Workout | null> {
  const existing = await prisma.workout.findFirst({ where: { id: workoutId, userId, deletedAt: null } });
  if (!existing) return null;
  return prisma.workout.update({
    where: { id: workoutId },
    data: {
      excluded,
      excludedNote: excluded ? note : null,
      // снятие и ручной зачёт противоречат друг другу: побеждает последнее решение админа
      ...(excluded ? { forceCounted: false, forceNote: null } : {}),
    },
  });
}

/**
 * Админ засчитывает тренировку вручную. Нужно там, где правило отсекает настоящее занятие:
 * источник разрезал его так, что сессия не дотянула до минимума, или человек тренировался
 * дважды за день при лимите в одну. Такая запись идёт в зачёт мимо длительности и лимита.
 */
export async function setWorkoutForceCounted(
  workoutId: number,
  userId: number,
  forceCounted: boolean,
  note: string | null,
): Promise<Workout | null> {
  const existing = await prisma.workout.findFirst({ where: { id: workoutId, userId, deletedAt: null } });
  if (!existing) return null;
  return prisma.workout.update({
    where: { id: workoutId },
    data: {
      forceCounted,
      forceNote: forceCounted ? note : null,
      ...(forceCounted ? { excluded: false, excludedNote: null } : {}),
    },
  });
}
