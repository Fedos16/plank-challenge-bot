import cron from 'node-cron';
import { dayjs, yesterdayDay } from '../lib/time';
import { getActiveChallenge } from '../services/challenge';
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
        if (challenge.dmReminders) {
          const dm = await sendPersonalReminders(challenge);
          if (dm) console.log(`[scheduler] Личных напоминаний в ЛС: ${dm}`);
        }
      }

      if (challenge.lastChanceTime && hhmm === challenge.lastChanceTime) {
        const dm = await sendPersonalReminders(challenge, { lastChance: true });
        if (dm) console.log(`[scheduler] «Последний шанс» в ЛС: ${dm}`);
      }
    } catch (err) {
      console.error('[scheduler] Ошибка:', err);
    }
  });

  console.log('[scheduler] Планировщик запущен (тик каждую минуту)');
}
