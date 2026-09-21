import { upgradeClosedWeeks } from './evaluation';
import { announceUpgrades } from './fitnessReport';
import { saveExternalWorkouts, type ExternalWorkout, type SaveExternalResult } from './workouts';

/**
 * Единая точка входа для тренировок с устройств: сохранить, пересчитать дубли и, если
 * опоздавшая запись закрыла норму уже оценённой недели, — вернуть жизнь и сказать об этом.
 * Через неё идут и WHOOP, и телефонные хабы, чтобы правила были одни на всех.
 */
export async function ingestWorkouts(
  userId: number,
  source: string,
  items: ExternalWorkout[],
): Promise<SaveExternalResult> {
  const result = await saveExternalWorkouts(userId, source, items);
  const touched = [...result.created, ...result.updated].map((w) => w.startedAt);
  await announceUpgrades(await upgradeClosedWeeks(userId, touched));
  return result;
}
