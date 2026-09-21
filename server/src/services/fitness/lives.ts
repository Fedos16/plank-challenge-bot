/**
 * Жизни нигде не хранятся: они выводятся прогоном итогов недель по порядку. Поэтому «простить
 * неделю» или поменять число жизней в настройках не требует ничего пересчитывать и
 * синхронизировать — достаточно прогнать историю заново.
 */

export interface WeekOutcome {
  weekIndex: number;
  passed: boolean;
  forgiven: boolean;
}

export interface WeekLifeState {
  weekIndex: number;
  /** Эта неделя сняла жизнь. */
  lifeLost: boolean;
  livesAfter: number;
  /** Неделя шла уже после выбывания: итог записан, но на жизни не влияет. */
  outOfGame: boolean;
}

export interface LivesState {
  total: number;
  left: number;
  eliminated: boolean;
  /** Неделя, на которой кончились жизни. */
  eliminatedAtWeek: number | null;
  weeks: WeekLifeState[];
}

/** Проваленная и не прощённая неделя снимает жизнь; на нуле участник выбывает. */
export function replayLives(outcomes: WeekOutcome[], totalLives: number): LivesState {
  const ordered = [...outcomes].sort((a, b) => a.weekIndex - b.weekIndex);
  const weeks: WeekLifeState[] = [];
  let left = Math.max(0, totalLives);
  let eliminatedAtWeek: number | null = null;

  for (const w of ordered) {
    if (eliminatedAtWeek !== null) {
      weeks.push({ weekIndex: w.weekIndex, lifeLost: false, livesAfter: 0, outOfGame: true });
      continue;
    }
    const lifeLost = !w.passed && !w.forgiven;
    if (lifeLost) left -= 1;
    weeks.push({ weekIndex: w.weekIndex, lifeLost, livesAfter: left, outOfGame: false });
    if (left <= 0) eliminatedAtWeek = w.weekIndex;
  }

  return { total: totalLives, left, eliminated: eliminatedAtWeek !== null, eliminatedAtWeek, weeks };
}

/**
 * Какие недели надо простить, чтобы вернуть выбывшего: ту, на которой кончились жизни, и все
 * проваленные после неё — иначе первая же из них выбьет его снова.
 */
export function weeksToForgiveForReinstate(outcomes: WeekOutcome[], totalLives: number): number[] {
  const state = replayLives(outcomes, totalLives);
  if (state.eliminatedAtWeek === null) return [];
  const from = state.eliminatedAtWeek;
  return outcomes
    .filter((w) => w.weekIndex >= from && !w.passed && !w.forgiven)
    .map((w) => w.weekIndex)
    .sort((a, b) => a - b);
}
