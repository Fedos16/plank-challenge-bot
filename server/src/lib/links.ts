import { config } from './config';

/**
 * Прямая ссылка на Mini App (Direct Link Mini App). Такая ссылка открывает Web App
 * прямо из группы/канала, без перехода в личку с ботом.
 * - если задан MINIAPP_SHORT_NAME → https://t.me/<bot>/<shortname>
 * - иначе (включён Main Mini App) → https://t.me/<bot>?startapp=open
 */
export function miniAppLink(botUsername: string): string {
  if (config.miniAppShortName) {
    return `https://t.me/${botUsername}/${config.miniAppShortName}`;
  }
  return `https://t.me/${botUsername}?startapp=open`;
}
