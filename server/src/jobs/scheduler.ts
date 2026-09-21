import cron from 'node-cron';
import type { Challenge } from '@prisma/client';
import { dayjs, todayDay, yesterdayDay } from '../lib/time';
import { getActiveChallenge, listActiveChallengesByKind } from '../services/challenge';
import {
  getDailyReminderTargets,
  getOptedInTargets,
  markDailyReminderSent,
} from '../services/notifications';
import { sendDailyReport } from '../services/report';
import { sendDailyReminder, sendPersonalReminders } from '../services/reminders';
import { evaluateClosedWeeks } from '../services/fitness/evaluation';
import { announceWeekResults } from '../services/fitness/fitnessReport';

/** Планка: отчёт и напоминания по расписанию из настроек челленджа. */
async function runPlankJobs(challenge: Challenge, hhmm: string): Promise<void> {
  if (hhmm === challenge.reportTime) {
    const day = yesterdayDay(challenge.timezone);
    const res = await sendDailyReport(challenge, day);
    if (res.sent) console.log(`[scheduler] Отчёт за ${day} отправлен`);
  }

  if (hhmm === challenge.reminderTime) {
    const sent = await sendDailyReminder(challenge);
    if (sent) console.log('[scheduler] Напоминание в чат отправлено');
  }

  // Личные напоминания идут по времени каждого участника: у кого своё — по нему,
  // у остальных — по настройке челленджа.
  const due = await getDailyReminderTargets(challenge, hhmm);
  if (due.length) {
    const dm = await sendPersonalReminders(challenge, due);
    await markDailyReminderSent(
      due.map((t) => t.participation.id),
      todayDay(challenge.timezone),
    );
    if (dm.length) console.log(`[scheduler] Личных напоминаний в ЛС: ${dm.length}`);
  }

  if (challenge.lastChanceTime && hhmm === challenge.lastChanceTime) {
    // «Последний шанс» уважает личный выключатель уведомлений.
    const targets = await getOptedInTargets(challenge);
    const dm = await sendPersonalReminders(challenge, targets, { lastChance: true });
    if (dm.length) console.log(`[scheduler] «Последний шанс» в ЛС: ${dm.length}`);
  }
}

/**
 * Фитнес: итоги закрытых недель. В отличие от планки, срабатывает не по совпадению минуты, а по
 * условию «неделя закрыта, а итога ещё нет» — поэтому пропущенный из-за простоя сервера момент
 * не теряется: итоги подведутся на следующем же проходе.
 */
async function runFitnessJobs(): Promise<void> {
  for (const challenge of await listActiveChallengesByKind('fitness')) {
    try {
      const created = await evaluateClosedWeeks(challenge);
      if (created.length === 0) continue;
      const told = await announceWeekResults(challenge, created);
      console.log(
        `[scheduler] «${challenge.title}»: итогов недель ${created.length}, в ЛС ${told.dm}, в чат ${told.chat ? 'да' : 'нет'}`,
      );
    } catch (err) {
      // один сломанный челлендж не должен останавливать остальные
      console.error(`[scheduler] Ошибка фитнес-челленджа #${challenge.id}:`, err);
    }
  }
}

/**
 * Тик каждую минуту: сверяем текущее время (в TZ челленджа) с reportTime/reminderTime.
 * Так настройки времени из админки применяются без перезапуска. Отчёт идемпотентен.
 */
export function startScheduler(): void {
  cron.schedule('* * * * *', async () => {
    try {
      const challenge = await getActiveChallenge();
      if (challenge) await runPlankJobs(challenge, dayjs().tz(challenge.timezone).format('HH:mm'));
    } catch (err) {
      console.error('[scheduler] Ошибка:', err);
    }

    // Отдельный try: сбой фитнеса не должен задевать планку, и наоборот
    try {
      if (new Date().getMinutes() % 10 === 0) await runFitnessJobs();
    } catch (err) {
      console.error('[scheduler] Ошибка фитнес-блока:', err);
    }
  });

  // Догон сразу после старта: деплой мог прийтись на момент закрытия недели
  void runFitnessJobs().catch((err) => console.error('[scheduler] Ошибка фитнес-блока:', err));

  console.log('[scheduler] Планировщик запущен (тик каждую минуту)');
}
