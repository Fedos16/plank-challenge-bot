import type { Challenge, SickDay } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  challengeDay,
  dayToDate,
  isBeforeDeadline,
  type DayStr,
} from '../lib/time';
import { removeFine } from './bank';

export interface SickResult {
  sickDay: SickDay;
  day: DayStr;
  valid: boolean;
}

/**
 * Зафиксировать заявку о болезни на текущий день челленджа.
 * valid, если момент <= дедлайна болезни (по умолчанию 14:00), иначе late.
 */
export async function reportSick(params: {
  challenge: Challenge;
  participationId: number;
  reportedAt: Date;
  note?: string;
}): Promise<SickResult> {
  const { challenge, participationId, reportedAt } = params;
  const day = challengeDay(reportedAt, challenge.timezone);
  const dayDate = dayToDate(day);

  const inTime = isBeforeDeadline(reportedAt, day, challenge.sickDeadline, challenge.timezone);
  const status = inTime ? 'valid' : 'late';

  const sickDay = await prisma.sickDay.upsert({
    where: { participationId_day: { participationId, day: dayDate } },
    create: {
      challengeId: challenge.id,
      participationId,
      day: dayDate,
      reportedAt,
      status,
      note: params.note ?? null,
    },
    update: { reportedAt, status, note: params.note ?? undefined },
  });

  // валидный больничный снимает штраф за этот день (если был начислен)
  if (status === 'valid') {
    await removeFine({ challengeId: challenge.id, participationId, day });
  }

  return { sickDay, day, valid: status === 'valid' };
}
