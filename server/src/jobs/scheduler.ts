import cron from 'node-cron';
import { dayjs, todayDay, yesterdayDay } from '../lib/time';
import { getActiveChallenge } from '../services/challenge';
import {
  getDailyReminderTargets,
  getOptedInTargets,
  markDailyReminderSent,
} from '../services/notifications';
import { sendDailyReport } from '../services/report';
import { sendDailyReminder, sendPersonalReminders } from '../services/reminders';

/**
 * Тик каждую минуту: сверяем текущее время (в TZ челленджа) с reportTime/reminderTime.
 * Так настройки времени из админки применяются без перезапуска. Отчёт идемпотентен.
 */
export function startScheduler(): void {
  cron.schedule('* * * * *', async () => {
    try {
      const challenge = await getActiveChallenge();
      if (!challenge) return;

      const hhmm = dayjs().tz(challenge.timezone).format('HH:mm');

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
    } catch (err) {
      console.error('[scheduler] Ошибка:', err);
    }
  });

  console.log('[scheduler] Планировщик запущен (тик каждую минуту)');
}
