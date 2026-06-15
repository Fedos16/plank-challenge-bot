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

/**
 * Личные напоминания в ЛС тем, кто сегодня ещё не сделал планку.
 * Кому бот не может написать (не нажали /start) — пропускаем. Возвращает число отправленных.
 */
export async function sendPersonalReminders(challenge: Challenge): Promise<number> {
  const day = todayDay(challenge.timezone);
  const statuses = await getDayStatuses(challenge, day);
  const pending = statuses.filter((s) => s.state === 'pending');
  if (pending.length === 0) return 0;

  const { bot } = await import('../bot/bot');
  if (!bot) return 0;
  let username: string | undefined;
  try {
    username = bot.botInfo.username;
  } catch {
    username = undefined;
  }
  const { appLaunchKeyboard } = await import('../bot/keyboards');
  const keyboard = username ? appLaunchKeyboard(username) : undefined;

  let sent = 0;
  for (const s of pending) {
    const text = [
      `⏰ <b>${escapeHtml(displayName(s.user))}, не забудь сегодня про планку!</b>`,
      `Минимум ${challenge.minDurationSec} сек, кружок в общий чат до ${challenge.dailyDeadline}.`,
      `Иначе штраф ${challenge.fineAmount} ₽ в банк 💰`,
    ].join('\n');
    try {
      await bot.api.sendMessage(Number(s.user.telegramId), text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
      sent++;
    } catch {
      // пользователь не начинал диалог с ботом — пропускаем
    }
  }
  return sent;
}
