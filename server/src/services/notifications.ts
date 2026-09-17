import type { Challenge, Participation, User } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { dateToDay, dayToDate, todayDay, type DayStr } from '../lib/time';

/** Ежедневное напоминание в ЛС тому, кто ещё не прислал кружок. */
export const DAILY_REMINDER = 'daily_reminder';

export const NOTIFICATION_TYPES = [DAILY_REMINDER] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationSettingDTO {
  type: NotificationType;
  title: string;
  description: string;
  /** Пользователь задал своё значение (иначе действует настройка челленджа). */
  enabled: boolean | null;
  time: string | null;
  /** Что получается в итоге с учётом настроек челленджа. */
  effectiveEnabled: boolean;
  effectiveTime: string;
  defaultEnabled: boolean;
  defaultTime: string;
}

const META: Record<NotificationType, { title: string; description: string }> = {
  [DAILY_REMINDER]: {
    title: 'Напоминание о планке',
    description: 'Придёт в личку, если к этому времени кружка за сегодня ещё нет.',
  },
};

/** Время в получасовых слотах: 00:00, 00:30 … 23:30. */
export function timeSlots(): string[] {
  const slots: string[] = [];
  for (let m = 0; m < 24 * 60; m += 30) {
    const h = Math.floor(m / 60);
    slots.push(`${String(h).padStart(2, '0')}:${m % 60 === 0 ? '00' : '30'}`);
  }
  return slots;
}

export function isValidSlot(hhmm: string): boolean {
  return /^([01]\d|2[0-3]):(00|30)$/.test(hhmm);
}

function toDTO(
  type: NotificationType,
  pref: { enabled: boolean | null; timeHHmm: string | null } | undefined,
  challenge: Challenge,
): NotificationSettingDTO {
  const defaultEnabled = challenge.dmReminders;
  const defaultTime = challenge.reminderTime;
  return {
    type,
    ...META[type],
    enabled: pref?.enabled ?? null,
    time: pref?.timeHHmm ?? null,
    effectiveEnabled: pref?.enabled ?? defaultEnabled,
    effectiveTime: pref?.timeHHmm ?? defaultTime,
    defaultEnabled,
    defaultTime,
  };
}

/** Настройки уведомлений участника для кабинета. */
export async function getNotificationSettings(
  challenge: Challenge,
  participationId: number,
): Promise<{ slots: string[]; settings: NotificationSettingDTO[] }> {
  const prefs = await prisma.notificationPref.findMany({ where: { participationId } });
  const byType = new Map(prefs.map((p) => [p.type, p]));
  return {
    slots: timeSlots(),
    settings: NOTIFICATION_TYPES.map((type) => toDTO(type, byType.get(type), challenge)),
  };
}

/**
 * Сохранить личную настройку. undefined — поле не трогаем, null — «как у челленджа».
 */
export async function updateNotificationSetting(
  challenge: Challenge,
  participationId: number,
  type: NotificationType,
  patch: { enabled?: boolean | null; time?: string | null },
): Promise<NotificationSettingDTO> {
  if (patch.time !== undefined && patch.time !== null && !isValidSlot(patch.time)) {
    throw new Error('bad_time');
  }
  const data = {
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(patch.time !== undefined ? { timeHHmm: patch.time } : {}),
  };
  const pref = await prisma.notificationPref.upsert({
    where: { participationId_type: { participationId, type } },
    create: { participationId, type, ...data },
    update: data,
  });
  return toDTO(type, pref, challenge);
}

export interface ReminderTarget {
  participation: Participation;
  user: User;
}

interface EffectivePref {
  enabled: boolean;
  time: string;
  lastSentDay: DayStr | null;
}

async function effectivePrefs(
  challenge: Challenge,
  type: NotificationType,
): Promise<{ targets: ReminderTarget[]; prefs: Map<number, EffectivePref> }> {
  const participations = await prisma.participation.findMany({
    where: { challengeId: challenge.id, status: 'active' },
    include: { user: true, notificationPrefs: { where: { type } } },
  });

  const prefs = new Map<number, EffectivePref>();
  const targets: ReminderTarget[] = [];
  for (const p of participations) {
    const pref = p.notificationPrefs[0];
    prefs.set(p.id, {
      enabled: pref?.enabled ?? challenge.dmReminders,
      time: pref?.timeHHmm ?? challenge.reminderTime,
      lastSentDay: pref?.lastSentDay ? dateToDay(pref.lastSentDay) : null,
    });
    const { user, notificationPrefs, ...participation } = p;
    targets.push({ participation, user });
  }
  return { targets, prefs };
}

/** Кому в эту минуту положено личное напоминание (без учёта того, сделал он планку или нет). */
export async function getDailyReminderTargets(
  challenge: Challenge,
  hhmm: string,
): Promise<ReminderTarget[]> {
  const today = todayDay(challenge.timezone);
  const { targets, prefs } = await effectivePrefs(challenge, DAILY_REMINDER);
  return targets.filter((t) => {
    const pref = prefs.get(t.participation.id)!;
    return pref.enabled && pref.time === hhmm && pref.lastSentDay !== today;
  });
}

/** Участники, которым вообще можно писать в ЛС по этому челленджу (личная настройка главнее). */
export async function getOptedInTargets(challenge: Challenge): Promise<ReminderTarget[]> {
  const { targets, prefs } = await effectivePrefs(challenge, DAILY_REMINDER);
  return targets.filter((t) => prefs.get(t.participation.id)!.enabled);
}

/** Отметить, что личное напоминание за сегодня уже ушло. */
export async function markDailyReminderSent(
  participationIds: number[],
  day: DayStr,
): Promise<void> {
  if (!participationIds.length) return;
  const sentDay = dayToDate(day);
  await Promise.all(
    participationIds.map((participationId) =>
      prisma.notificationPref.upsert({
        where: { participationId_type: { participationId, type: DAILY_REMINDER } },
        create: { participationId, type: DAILY_REMINDER, lastSentDay: sentDay },
        update: { lastSentDay: sentDay },
      }),
    ),
  );
}
