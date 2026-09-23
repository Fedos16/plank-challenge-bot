import type { Challenge } from '@prisma/client';
import { todayDay } from '../lib/time';
import { getDayStatuses } from './dayStatus';
import type { ReminderTarget } from './notifications';
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
  const { sendToChallengeChat } = await import('../bot/challengeChat');
  await sendToChallengeChat(bot.api, challenge, text, {
    parse_mode: 'HTML',
    reply_markup: username ? appLaunchKeyboard(username) : undefined,
  });
  return true;
}

/**
 * Личные напоминания в ЛС тем из `targets`, кто сегодня ещё не сделал планку.
 * Кому бот не может написать (не нажали /start) — пропускаем.
 * Возвращает id участий, которым сообщение действительно ушло.
 */
export async function sendPersonalReminders(
  challenge: Challenge,
  targets: ReminderTarget[],
  opts: { lastChance?: boolean } = {},
): Promise<number[]> {
  if (targets.length === 0) return [];
  const day = todayDay(challenge.timezone);
  const statuses = await getDayStatuses(challenge, day);
  const wanted = new Set(targets.map((t) => t.participation.id));
  const pending = statuses.filter((s) => s.state === 'pending' && wanted.has(s.participation.id));
  if (pending.length === 0) return [];

  const { bot } = await import('../bot/bot');
  if (!bot) return [];
  let username: string | undefined;
  try {
    username = bot.botInfo.username;
  } catch {
    username = undefined;
  }
  const { appLaunchKeyboard } = await import('../bot/keyboards');
  const keyboard = username ? appLaunchKeyboard(username) : undefined;

  const sent: number[] = [];
  for (const s of pending) {
    const name = escapeHtml(displayName(s.user));
    const text = opts.lastChance
      ? [
          `🔥 <b>${name}, последний шанс!</b>`,
          `Скоро дедлайн ${challenge.dailyDeadline} — успей прислать кружок (минимум ${challenge.minDurationSec} сек).`,
          `Иначе штраф ${challenge.fineAmount} ₽ в банк 💰`,
        ].join('\n')
      : [
          `⏰ <b>${name}, не забудь сегодня про планку!</b>`,
          `Минимум ${challenge.minDurationSec} сек, кружок в общий чат до ${challenge.dailyDeadline}.`,
          `Иначе штраф ${challenge.fineAmount} ₽ в банк 💰`,
        ].join('\n');
    try {
      await bot.api.sendMessage(Number(s.user.telegramId), text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
      sent.push(s.participation.id);
    } catch {
      // пользователь не начинал диалог с ботом — пропускаем
    }
  }
  return sent;
}
