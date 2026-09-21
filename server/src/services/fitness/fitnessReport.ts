import type { Challenge } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { dateToDay, dayToDate } from '../../lib/time';
import { weekCloseInstant, weekRange } from '../../lib/weeks';
import { challengeEndDay } from '../challenge';
import { escapeHtml } from '../report';
import { displayName } from '../users';
import { livesOf, type CreatedWeekResult, type UpgradedWeek } from './evaluation';

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

/** Текст сводки недели для чата: кто закрыл норму, кто потерял жизнь, кто выбыл. */
export async function buildWeekSummary(ch: Challenge, weekIndex: number): Promise<string> {
  const rows = await prisma.weekResult.findMany({
    where: { challengeId: ch.id, weekIndex },
    include: { participation: { include: { user: true } } },
  });

  const lines: string[] = [`🏁 <b>${escapeHtml(ch.title)}: неделя ${weekIndex + 1} закрыта</b>`, ''];
  for (const r of rows) {
    const all = await prisma.weekResult.findMany({ where: { participationId: r.participationId } });
    const lives = livesOf(ch, all);
    const state = lives.weeks.find((w) => w.weekIndex === weekIndex);
    const name = escapeHtml(displayName(r.participation.user));
    const score = `${r.done}/${r.required}`;

    if (state?.outOfGame) lines.push(`☠️ ${name} — ${score} · вне зачёта`);
    else if (lives.eliminatedAtWeek === weekIndex) lines.push(`☠️ ${name} — ${score} · жизни закончились`);
    else if (state?.lifeLost) lines.push(`💔 ${name} — ${score} · ${hearts(state.livesAfter, lives.total)}`);
    else lines.push(`✅ ${name} — ${score} · ${hearts(state?.livesAfter ?? lives.left, lives.total)}`);
  }
  return lines.join('\n');
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
 * Рассказывает об итогах только что закрытых недель: в ЛС — потерявшим жизнь, в чат — сводку.
 * Сводка идемпотентна через DailyReport (ключ — челлендж и последний день недели), ЛС — через
 * notifiedAt. Без бота (тесты, локальный запуск) молча ничего не шлёт.
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

  const content = await buildWeekSummary(ch, lastWeek);
  await bot.api.sendMessage(Number(ch.chatId), content, { parse_mode: 'HTML' });
  await prisma.dailyReport.create({ data: { challengeId: ch.id, day: dayToDate(week.end), content } });
  return { dm, chat: true };
}
