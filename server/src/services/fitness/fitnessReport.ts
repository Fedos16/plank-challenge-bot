import type { Api } from 'grammy';
import type { Challenge } from '@prisma/client';
import { weekReportKeyboard } from '../../bot/keyboards';
import { prisma } from '../../lib/prisma';
import { dateToDay, dayToDate } from '../../lib/time';
import { weekCloseInstant, weekRange } from '../../lib/weeks';
import { challengeEndDay } from '../challenge';
import { escapeHtml } from '../report';
import { livesOf, type CreatedWeekResult, type UpgradedWeek } from './evaluation';
import { getWeekReport, lastWeekIndex } from './weekReport';

/** Старше этого итог недели — уже история: при догоне простоя о нём в ЛС не пишем. */
const FRESH_MS = 7 * 86_400_000;

export function hearts(left: number, total: number): string {
  return '❤️'.repeat(Math.max(0, left)) + '🖤'.repeat(Math.max(0, total - left));
}

/** Свежий ли итог: неделя закрылась не больше недели назад. */
function isFresh(ch: Challenge, weekIndex: number, now: Date): boolean {
  const week = weekRange(dateToDay(ch.startDate), weekIndex, challengeEndDay(ch));
  if (!week) return false;
  return now.getTime() - weekCloseInstant(week, ch.weekCloseTime, ch.timezone).getTime() <= FRESH_MS;
}

/** Бот grammY или его заглушка: нужны только API и имя для ссылки. */
type BotLike = { api: Api; botInfo: { username: string } };

/**
 * Сообщение в чат про неделю: пара строк и кнопка на отчёт. Сам отчёт — экран мини-приложения,
 * кнопка открывает его прямо в Telegram. null — недели нет (челлендж ещё не начался).
 */
async function postWeekReport(bot: BotLike, ch: Challenge, weekNumber: number) {
  const report = await getWeekReport(ch, 0, weekNumber);
  if (typeof report === 'string') return null;

  const { week, totals } = report;
  const title = `<b>${escapeHtml(ch.title)}</b>`;
  const current = week.state === 'current';
  // главное — личный результат: сначала кто приблизился к цели, потом норма тренировок
  const facts = [
    totals.withGoal ? `к цели ${current ? 'уже ' : ''}приблизились ${totals.closer} из ${totals.withGoal}` : null,
    `норму закрыли ${totals.passed} из ${totals.inGame}`,
  ].filter(Boolean);
  const summary = facts.join(', ');
  const text = current
    ? `📊 ${title}: неделя ${week.number}\n${summary[0]!.toUpperCase()}${summary.slice(1)}. До конца недели ${week.daysLeft} дн.`
    : `🏁 ${title}: неделя ${week.number} закрыта\n${summary[0]!.toUpperCase()}${summary.slice(1)}.`;

  let username: string | undefined;
  try {
    username = bot.botInfo.username;
  } catch {
    username = undefined; // бот ещё не инициализирован — без кнопки
  }
  const keyboard = username
    ? weekReportKeyboard(username, [{ challengeId: ch.id, week: week.number, label: '📊 Открыть отчёт' }])
    : undefined;

  const { sendToChallengeChat } = await import('../../bot/challengeChat');
  const message = await sendToChallengeChat(bot.api, ch, text, { parse_mode: 'HTML', reply_markup: keyboard });
  return { text, message };
}

/** Убирает прошлую промежуточную сводку: в топике остаётся одна актуальная ссылка. */
async function dropInterimSummary(bot: BotLike, ch: Challenge): Promise<void> {
  if (ch.summaryChatId === null || ch.summaryMessageId === null) return;
  try {
    await bot.api.deleteMessage(Number(ch.summaryChatId), ch.summaryMessageId);
  } catch {
    // старше 48 часов (Telegram не даёт удалить) или её уже удалили руками
  }
  await prisma.challenge.update({ where: { id: ch.id }, data: { summaryChatId: null, summaryMessageId: null } });
}

export type SendSummaryError = 'no_chat' | 'bot_disabled' | 'nothing_to_report';

/**
 * Сводка в чат по кнопке админа: пока челлендж идёт — текущая неделя, после — последняя.
 * Прошлую промежуточную заменяет. В DailyReport не пишется: ручная отправка не должна
 * отменять автоматическую при закрытии недели.
 */
export async function sendWeekSummaryNow(ch: Challenge): Promise<{ error: SendSummaryError } | { content: string }> {
  if (!ch.chatId) return { error: 'no_chat' };
  const { bot } = await import('../../bot/bot');
  if (!bot) return { error: 'bot_disabled' };

  const sent = await postWeekReport(bot, ch, lastWeekIndex(ch) + 1);
  if (!sent) return { error: 'nothing_to_report' };
  await dropInterimSummary(bot, ch); // старую — только когда новая уже в чате
  await prisma.challenge.update({
    where: { id: ch.id },
    data: { summaryChatId: BigInt(sent.message.chat.id), summaryMessageId: sent.message.message_id },
  });
  return { content: sent.text };
}

/** Хорошая новость в ЛС: опоздавшая синхронизация закрыла норму уже оценённой недели. */
export async function announceUpgrades(upgraded: UpgradedWeek[]): Promise<number> {
  if (upgraded.length === 0) return 0;
  const { bot } = await import('../../bot/bot');
  if (!bot) return 0;

  let sent = 0;
  for (const u of upgraded) {
    const text = [
      `💚 <b>Неделя ${u.row.weekIndex + 1} пересчитана</b>: ${u.row.done} из ${u.row.required}.`,
      u.lifeReturned
        ? `Тренировка досинхронизировалась с устройства, норма закрыта — жизнь возвращена («${escapeHtml(u.challenge.title)}»).`
        : 'Тренировка досинхронизировалась с устройства, норма закрыта.',
    ];
    try {
      await bot.api.sendMessage(Number(u.user.telegramId), text.join('\n'), { parse_mode: 'HTML' });
      sent += 1;
    } catch {
      // пользователь не начинал диалог с ботом — пропускаем
    }
  }
  return sent;
}

/**
 * Рассказывает об итогах только что закрытых недель: в ЛС — потерявшим жизнь, в чат — ссылку
 * на отчёт. Сообщение в чат идемпотентно через DailyReport (ключ — челлендж и последний день
 * недели), ЛС — через notifiedAt. Без бота (тесты, локальный запуск) молча ничего не шлёт.
 */
export async function announceWeekResults(
  ch: Challenge,
  created: CreatedWeekResult[],
  now = new Date(),
): Promise<{ dm: number; chat: boolean }> {
  if (created.length === 0) return { dm: 0, chat: false };
  const { bot } = await import('../../bot/bot');

  let dm = 0;
  for (const row of created) {
    if (bot && isFresh(ch, row.weekIndex, now)) {
      const all = await prisma.weekResult.findMany({ where: { participationId: row.participationId } });
      const lives = livesOf(ch, all);
      const state = lives.weeks.find((w) => w.weekIndex === row.weekIndex);
      if (state?.lifeLost) {
        const score = `${row.done} из ${row.required} тренировок`;
        const text =
          lives.eliminatedAtWeek === row.weekIndex
            ? [
                '☠️ <b>Жизни закончились</b>',
                `Неделя ${row.weekIndex + 1}: ${score}. Вы выбыли из зачёта «${escapeHtml(ch.title)}».`,
                'Тренировки, вес и замеры можно вести дальше — просто вне зачёта.',
              ]
            : [
                `💔 <b>Неделя ${row.weekIndex + 1} не закрыта</b>: ${score}.`,
                `Минус жизнь — осталось ${hearts(state.livesAfter, lives.total)}`,
              ];
        try {
          await bot.api.sendMessage(Number(row.participation.user.telegramId), text.join('\n'), {
            parse_mode: 'HTML',
          });
          dm += 1;
        } catch {
          // пользователь не начинал диалог с ботом — пропускаем
        }
      }
    }
    await prisma.weekResult.update({ where: { id: row.id }, data: { notifiedAt: now } });
  }

  // При догоне нескольких недель в чат уходит только последняя: остальные — уже история
  const lastWeek = Math.max(...created.map((r) => r.weekIndex));
  const week = weekRange(dateToDay(ch.startDate), lastWeek, challengeEndDay(ch));
  if (!week || !ch.chatId || !bot || !isFresh(ch, lastWeek, now)) return { dm, chat: false };

  const key = { challengeId_day: { challengeId: ch.id, day: dayToDate(week.end) } };
  if (await prisma.dailyReport.findUnique({ where: key })) return { dm, chat: false };

  const sent = await postWeekReport(bot, ch, lastWeek + 1);
  if (!sent) return { dm, chat: false };
  // промежуточная сводка этой недели устарела: вместо неё теперь итог
  await dropInterimSummary(bot, ch);
  await prisma.dailyReport.create({ data: { challengeId: ch.id, day: dayToDate(week.end), content: sent.text } });
  return { dm, chat: true };
}
