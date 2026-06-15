import type { Challenge } from '@prisma/client';
import { todayDay } from '../lib/time';
import { getDayStatuses } from './dayStatus';
import { displayName } from './users';
import { escapeHtml } from './report';

/**
 * Напоминание тем, кто сегодня ещё не прислал кружок и не в больничном.
 * Отправляется в чат челленджа.
 */
export async function sendDailyReminder(challenge: Challenge): Promise<boolean> {
  if (!challenge.chatId) return false;

  const day = todayDay(challenge.timezone);
  const statuses = await getDayStatuses(challenge, day);
  const pending = statuses.filter((s) => s.state === 'pending');
  if (pending.length === 0) return false;

  const names = pending.map((s) => {
    const handle = s.user.username ? `@${escapeHtml(s.user.username)}` : escapeHtml(displayName(s.user));
    return `• ${handle}`;
  });

  const text = [
    '⏰ <b>Напоминание!</b>',
    `Сегодня ещё не прислали кружок с планкой (минимум ${challenge.minDurationSec} сек):`,
    names.join('\n'),
    '',
    `Дедлайн — ${challenge.dailyDeadline}. Иначе штраф ${challenge.fineAmount} ₽ в банк 💰`,
  ].join('\n');

  const { bot } = await import('../bot/bot');
  if (!bot) return false;
  let username: string | undefined;
  try {
    username = bot.botInfo.username;
  } catch {
    username = undefined;
  }
  const { appLaunchKeyboard } = await import('../bot/keyboards');
  await bot.api.sendMessage(Number(challenge.chatId), text, {
    parse_mode: 'HTML',
    reply_markup: username ? appLaunchKeyboard(username) : undefined,
  });
  return true;
}
