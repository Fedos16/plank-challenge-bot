import type { Challenge } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { dayToDate, type DayStr } from '../lib/time';
import { addFine, removeFine } from './bank';

export type OverrideAction = 'done' | 'missed' | 'sick' | 'clear' | 'fake';

/** Ручная правка статуса участника за день из админки. */
export async function applyDayOverride(
  challenge: Challenge,
  participationId: number,
  day: DayStr,
  action: OverrideAction,
): Promise<void> {
  const dayDate = dayToDate(day);

  if (action === 'clear') {
    await prisma.submission.deleteMany({ where: { participationId, day: dayDate } });
    await prisma.sickDay.deleteMany({ where: { participationId, day: dayDate } });
    await removeFine({ challengeId: challenge.id, participationId, day });
    return;
  }

  if (action === 'done') {
    await prisma.sickDay.deleteMany({ where: { participationId, day: dayDate } });
    await prisma.submission.upsert({
      where: { participationId_day: { participationId, day: dayDate } },
      create: {
        challengeId: challenge.id,
        participationId,
        day: dayDate,
        status: 'counted',
        videoDuration: challenge.minDurationSec,
        submittedAt: new Date(),
      },
      update: { status: 'counted' },
    });
    await removeFine({ challengeId: challenge.id, participationId, day });
    return;
  }

  if (action === 'fake') {
    await prisma.sickDay.deleteMany({ where: { participationId, day: dayDate } });
    await prisma.submission.upsert({
      where: { participationId_day: { participationId, day: dayDate } },
      create: {
        challengeId: challenge.id,
        participationId,
        day: dayDate,
        status: 'fake',
        videoDuration: challenge.minDurationSec,
        submittedAt: new Date(),
      },
      update: { status: 'fake' },
    });
    // двойной штраф вместо обычного
    await removeFine({ challengeId: challenge.id, participationId, day });
    await addFine({
      challengeId: challenge.id,
      participationId,
      day,
      type: 'fake',
      amount: challenge.fineAmount * challenge.fakeFineMultiplier,
      note: 'Фейк (отмечено админом)',
    });
    return;
  }

  if (action === 'sick') {
    await prisma.submission.deleteMany({ where: { participationId, day: dayDate } });
    await prisma.sickDay.upsert({
      where: { participationId_day: { participationId, day: dayDate } },
      create: {
        challengeId: challenge.id,
        participationId,
        day: dayDate,
        status: 'valid',
        reportedAt: new Date(),
      },
      update: { status: 'valid' },
    });
    await removeFine({ challengeId: challenge.id, participationId, day });
    return;
  }

  // missed
  await prisma.submission.deleteMany({ where: { participationId, day: dayDate } });
  await prisma.sickDay.deleteMany({ where: { participationId, day: dayDate } });
  await addFine({
    challengeId: challenge.id,
    participationId,
    day,
    type: 'miss',
    amount: challenge.fineAmount,
    note: 'Отмечено админом как пропуск',
  });
}
