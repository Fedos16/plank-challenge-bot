import { config } from './config';

/**
 * Прямая ссылка на Mini App (Direct Link Mini App). Такая ссылка открывает Web App
 * прямо из группы/канала, без перехода в личку с ботом.
 * - если задан MINIAPP_SHORT_NAME → https://t.me/<bot>/<shortname>?startapp=<param>
 * - иначе (включён Main Mini App) → https://t.me/<bot>?startapp=<param>
 * `startParam` приложение получает при запуске и по нему открывает нужный экран
 * (Telegram пропускает только A–Z, a–z, 0–9, «_» и «-»).
 */
export function miniAppLink(botUsername: string, startParam = 'open'): string {
  if (config.miniAppShortName) {
    return `https://t.me/${botUsername}/${config.miniAppShortName}?startapp=${startParam}`;
  }
  return `https://t.me/${botUsername}?startapp=${startParam}`;
}

/** Параметр запуска отчёта недели фитнес-челленджа. */
export function weekReportParam(challengeId: number, weekNumber: number): string {
  return `week-${challengeId}-${weekNumber}`;
}
