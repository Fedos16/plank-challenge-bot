import { InlineKeyboard } from 'grammy';
import { config } from '../lib/config';
import { miniAppLink } from '../lib/links';

export function startKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (config.webAppUrl) {
    kb.webApp('🏆 Открыть приложение', config.webAppUrl).row();
  }
  kb.text('🤒 Заболел сегодня', 'sick:today');
  return kb;
}

/** Кнопки модерации под засчитанным кружком (нажимать может только админ). */
export function moderationKeyboard(submissionId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('🚫 Не засчитывать', `mod:reject:${submissionId}`)
    .text('❌ Фейк (×2)', `mod:fake:${submissionId}`);
}

/** Кнопка вернуть зачёт (после reject/fake). */
export function restoreKeyboard(submissionId: number): InlineKeyboard {
  return new InlineKeyboard().text('✅ Вернуть зачёт', `mod:count:${submissionId}`);
}

/** Кнопка запуска Web App из группы (через Direct Link Mini App). */
export function appLaunchKeyboard(botUsername: string): InlineKeyboard {
  return new InlineKeyboard().url('🏆 Открыть приложение', miniAppLink(botUsername));
}
