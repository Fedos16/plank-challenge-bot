import { challengeDay, type DayStr } from '../../lib/time';
import type { DayWindow } from '../../lib/weeks';

/** Минимум полей тренировки, нужный правилам зачёта: чистые функции не зависят от Prisma. */
export interface WorkoutLike {
  id: number;
  source: string;
  startedAt: Date;
  durationSec: number;
  excluded: boolean;
  duplicateOfId: number | null;
}

/**
 * Чьей записи верить, когда одна тренировка пришла из нескольких мест. Браслет точнее
 * телефона-хаба, хаб точнее агрегатора, а ручная запись уступает любой автоматической.
 */
const SOURCE_PRIORITY: Record<string, number> = {
  whoop: 3,
  hae: 2,
  health_connect: 2,
  strava: 1,
  manual: 0,
};

/** С какой доли перекрытия две записи считаются одной тренировкой. */
const DUPLICATE_OVERLAP = 0.5;

function endMs(w: WorkoutLike): number {
  return w.startedAt.getTime() + Math.max(1, w.durationSec) * 1000;
}

/** Доля перекрытия от более короткой записи: 40-минутка внутри часовой — это 1, а не 0,67. */
export function overlapRatio(a: WorkoutLike, b: WorkoutLike): number {
  const overlap = Math.min(endMs(a), endMs(b)) - Math.max(a.startedAt.getTime(), b.startedAt.getTime());
  if (overlap <= 0) return 0;
  const shorter = Math.min(Math.max(1, a.durationSec), Math.max(1, b.durationSec)) * 1000;
  return overlap / shorter;
}

/**
 * Раскладывает записи на основные и дубли. Возвращает для каждой id основной записи либо null.
 * Снятые админом записи участвуют наравне с остальными: иначе, сняв запись с браслета,
 * админ нечаянно вернул бы в зачёт её ручной дубль.
 */
export function assignDuplicates(workouts: WorkoutLike[]): Map<number, number | null> {
  const ordered = [...workouts].sort(
    (a, b) => (SOURCE_PRIORITY[b.source] ?? 0) - (SOURCE_PRIORITY[a.source] ?? 0) || a.id - b.id,
  );
  const primaries: WorkoutLike[] = [];
  const result = new Map<number, number | null>();

  for (const w of ordered) {
    const primary = primaries.find((p) => overlapRatio(p, w) >= DUPLICATE_OVERLAP);
    result.set(w.id, primary ? primary.id : null);
    if (!primary) primaries.push(w);
  }
  return result;
}

export type Verdict = 'counted' | 'too_short' | 'duplicate' | 'excluded' | 'day_limit';

export interface CountingRules {
  minWorkoutMin: number;
  maxWorkoutsPerDay: number;
  /** День тренировки определяется в поясе челленджа, а не пользователя. */
  tz: string;
}

/**
 * Почему тренировка идёт или не идёт в зачёт недели. В журнале и в сумме калорий остаётся
 * любая — вердикт решает только про норму.
 */
export function classifyWorkouts(workouts: WorkoutLike[], rules: CountingRules): Map<number, Verdict> {
  const verdicts = new Map<number, Verdict>();
  const perDay = new Map<DayStr, number>();

  // В зачёт идут самые ранние тренировки дня — порядок важен для лимита
  const ordered = [...workouts].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime() || a.id - b.id);
  for (const w of ordered) {
    if (w.excluded) verdicts.set(w.id, 'excluded');
    else if (w.duplicateOfId !== null) verdicts.set(w.id, 'duplicate');
    else if (w.durationSec < rules.minWorkoutMin * 60) verdicts.set(w.id, 'too_short');
    else {
      const day = challengeDay(w.startedAt, rules.tz);
      const used = perDay.get(day) ?? 0;
      if (used >= rules.maxWorkoutsPerDay) {
        verdicts.set(w.id, 'day_limit');
      } else {
        perDay.set(day, used + 1);
        verdicts.set(w.id, 'counted');
      }
    }
  }
  return verdicts;
}

/** Сколько засчитанных тренировок попало в окно, по дням и всего. */
export function countInWindow(
  workouts: WorkoutLike[],
  rules: CountingRules,
  window: Pick<DayWindow, 'start' | 'end'>,
): { done: number; byDay: Map<DayStr, number> } {
  const verdicts = classifyWorkouts(workouts, rules);
  const byDay = new Map<DayStr, number>();
  let done = 0;
  for (const w of workouts) {
    if (verdicts.get(w.id) !== 'counted') continue;
    const day = challengeDay(w.startedAt, rules.tz);
    if (day < window.start || day > window.end) continue;
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
    done += 1;
  }
  return { done, byDay };
}
