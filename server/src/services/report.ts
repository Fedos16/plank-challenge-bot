import type { Challenge } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  challengeDayNumber,
  dateToDay,
  dayToDate,
  dayjs,
  type DayStr,
} from '../lib/time';
import { getBank } from './bank';
import { addFine } from './bank';
import { getDayStatuses, isMissState, type ParticipantDayStatus } from './dayStatus';
import { getParticipationStreaks } from './streaks';
import { pickNextQuote } from './quotes';
import { displayName } from './users';

/** Начислить штрафы за пропуски в этот день (идемпотентно). */
export async function applyDailyFines(challenge: Challenge, day: DayStr): Promise<void> {
  const statuses = await getDayStatuses(challenge, day);
  for (const s of statuses) {
    if (isMissState(s.state)) {
      await addFine({
        challengeId: challenge.id,
        participationId: s.participation.id,
        day,
        type: 'miss',
        amount: challenge.fineAmount,
        note: 'Пропуск планки',
      });
    }
  }
}

function formatMoney(n: number): string {
  return `${n.toLocaleString('ru-RU')} ₽`;
}

/** Текст дневного отчёта за указанный день. */
export async function buildDailyReportContent(
  challenge: Challenge,
  day: DayStr,
): Promise<string> {
  const startDay = dateToDay(challenge.startDate);
  const dayNum = challengeDayNumber(startDay, day);
  const statuses = await getDayStatuses(challenge, day);
  const bank = await getBank(challenge.id);
  const quote = await pickNextQuote(challenge.id);

  const done: string[] = [];
  const sick: string[] = [];
  const missed: string[] = [];
  const fake: string[] = [];

  for (const s of statuses) {
    const name = escapeHtml(displayName(s.user));
    if (s.state === 'done') {
      const streaks = await getParticipationStreaks(challenge, s.participation);
      done.push(`• ${name} — серия 🔥 ${streaks.current}`);
    } else if (s.state === 'sick') {
      sick.push(`• ${name}`);
    } else if (s.state === 'fake') {
      fake.push(`• ${name} — фейк, штраф ${formatMoney(challenge.fineAmount * challenge.fakeFineMultiplier)}`);
    } else if (isMissState(s.state)) {
      missed.push(`• ${name} — штраф ${formatMoney(challenge.fineAmount)}`);
    }
  }

  const dateStr = dayjs(day).format('DD.MM.YYYY');
  const lines: string[] = [];
  lines.push(`📅 <b>Отчёт за ${dateStr}</b>`);
  lines.push(`День ${dayNum} челленджа «${escapeHtml(challenge.title)}»`);
  lines.push('');

  lines.push(`✅ <b>Сделали планку (${done.length}):</b>`);
  lines.push(done.length ? done.join('\n') : '—');

  if (sick.length) {
    lines.push('');
    lines.push(`🤒 <b>Болели (${sick.length}):</b>`);
    lines.push(sick.join('\n'));
  }

  if (missed.length) {
    lines.push('');
    lines.push(`❌ <b>Пропустили (${missed.length}):</b>`);
    lines.push(missed.join('\n'));
  }

  if (fake.length) {
    lines.push('');
    lines.push(`🚫 <b>Фейк (${fake.length}):</b>`);
    lines.push(fake.join('\n'));
  }

  lines.push('');
  lines.push(`💰 <b>Банк:</b> ${formatMoney(bank)}`);

  if (quote) {
    lines.push('');
    lines.push(`💪 <i>${escapeHtml(quote)}</i>`);
  }

  return lines.join('\n');
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface SendReportResult {
  sent: boolean;
  skipped: boolean;
  reason?: string;
  content: string;
}

/**
 * Сформировать и отправить дневной отчёт в чат челленджа.
 * Идемпотентно: если отчёт за день уже отправлен и не force — не дублирует.
 */
export async function sendDailyReport(
  challenge: Challenge,
  day: DayStr,
  options: { force?: boolean } = {},
): Promise<SendReportResult> {
  const dayDate = dayToDate(day);
  const existing = await prisma.dailyReport.findUnique({
    where: { challengeId_day: { challengeId: challenge.id, day: dayDate } },
  });
  if (existing && !options.force) {
    return { sent: false, skipped: true, reason: 'already_sent', content: existing.content };
  }

  await applyDailyFines(challenge, day);
  const content = await buildDailyReportContent(challenge, day);

  // ленивый импорт, чтобы не тянуть бота при работе без него (тесты/сид)
  let sent = false;
  if (challenge.chatId) {
    const { bot } = await import('../bot/bot');
    if (bot) {
      let username: string | undefined;
      try {
        username = bot.botInfo.username;
      } catch {
        username = undefined;
      }
      const { appLaunchKeyboard } = await import('../bot/keyboards');
      await bot.api.sendMessage(Number(challenge.chatId), content, {
        parse_mode: 'HTML',
        reply_markup: username ? appLaunchKeyboard(username) : undefined,
      });
      sent = true;
    }
  }

  await prisma.dailyReport.upsert({
    where: { challengeId_day: { challengeId: challenge.id, day: dayDate } },
    create: { challengeId: challenge.id, day: dayDate, content },
    update: { content, sentAt: new Date() },
  });

  return { sent, skipped: false, content };
}
