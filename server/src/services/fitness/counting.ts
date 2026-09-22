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
  /** Админ засчитал вручную: минимальная длительность и лимит дня на неё не действуют. */
  forceCounted: boolean;
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

/**
 * Пауза, внутри которой соседние записи остаются одной тренировкой. Источники режут занятие
 * по видам активности: дорожка и сразу за ней силовая приходят двумя записями с разрывом
 * в секунды. Полчаса между ними — это уже разные занятия, поэтому окно короткое.
 */
export const SESSION_GAP_MIN = 15;

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
 * Тренировка целиком: одна запись либо несколько подряд идущих. В зачёт недели идёт именно
 * сессия, а не отдельная запись источника.
 */
export interface Session {
  /** id первой записи: устойчивый ключ, по которому сегменты видно как одно занятие. */
  id: number;
  workoutIds: number[];
  /** День начала в поясе челленджа. */
  day: DayStr;
  /** Сумма длительностей сегментов: паузы между ними тренировкой не считаются. */
  durationSec: number;
  verdict: Verdict;
  /** Засчитана админом вручную. */
  forced: boolean;
}

export interface Classification {
  sessions: Session[];
  /** Вердикт каждой записи: у сегментов одной сессии он общий. */
  verdicts: Map<number, Verdict>;
}

/**
 * Собирает записи в сессии и решает, какие из них идут в зачёт недели. В журнале и в сумме
 * калорий остаётся любая запись — вердикт решает только про норму.
 */
export function classify(workouts: WorkoutLike[], rules: CountingRules): Classification {
  const verdicts = new Map<number, Verdict>();
  const active: WorkoutLike[] = [];

  // Снятые и дубли в сессии не входят: иначе снятая запись продлевала бы соседнюю тренировку.
  for (const w of workouts) {
    if (w.excluded) verdicts.set(w.id, 'excluded');
    else if (w.duplicateOfId !== null) verdicts.set(w.id, 'duplicate');
    else active.push(w);
  }

  const ordered = [...active].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime() || a.id - b.id);
  const gapMs = SESSION_GAP_MIN * 60_000;

  const groups: { first: WorkoutLike; items: WorkoutLike[]; endMs: number }[] = [];
  for (const w of ordered) {
    const current = groups[groups.length - 1];
    if (current && w.startedAt.getTime() - current.endMs <= gapMs) {
      current.items.push(w);
      current.endMs = Math.max(current.endMs, endMs(w));
    } else {
      groups.push({ first: w, items: [w], endMs: endMs(w) });
    }
  }

  // В зачёт идут самые ранние сессии дня — порядок важен для лимита
  const perDay = new Map<DayStr, number>();
  const sessions: Session[] = [];
  for (const group of groups) {
    const day = challengeDay(group.first.startedAt, rules.tz);
    const durationSec = group.items.reduce((sum, w) => sum + w.durationSec, 0);
    const forced = group.items.some((w) => w.forceCounted);

    let verdict: Verdict;
    if (forced) {
      // Ручной зачёт — решение админа: он и слот дня не занимает, и лимитом не отсекается
      verdict = 'counted';
    } else if (durationSec < rules.minWorkoutMin * 60) {
      verdict = 'too_short';
    } else if ((perDay.get(day) ?? 0) >= rules.maxWorkoutsPerDay) {
      verdict = 'day_limit';
    } else {
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
      verdict = 'counted';
    }

    for (const w of group.items) verdicts.set(w.id, verdict);
    sessions.push({
      id: group.first.id,
      workoutIds: group.items.map((w) => w.id),
      day,
      durationSec,
      verdict,
      forced,
    });
  }

  return { sessions, verdicts };
}

/** Почему тренировка идёт или не идёт в зачёт недели. */
export function classifyWorkouts(workouts: WorkoutLike[], rules: CountingRules): Map<number, Verdict> {
  return classify(workouts, rules).verdicts;
}

/** Сколько засчитанных тренировок попало в окно, по дням и всего. Считаются сессии, а не записи. */
export function countInWindow(
  workouts: WorkoutLike[],
  rules: CountingRules,
  window: Pick<DayWindow, 'start' | 'end'>,
): { done: number; byDay: Map<DayStr, number> } {
  const { sessions } = classify(workouts, rules);
  const byDay = new Map<DayStr, number>();
  let done = 0;
  for (const s of sessions) {
    if (s.verdict !== 'counted') continue;
    if (s.day < window.start || s.day > window.end) continue;
    byDay.set(s.day, (byDay.get(s.day) ?? 0) + 1);
    done += 1;
  }
  return { done, byDay };
}
