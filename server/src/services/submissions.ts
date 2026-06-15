import type { Challenge, Submission } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  challengeDay,
  dateToDay,
  dayToDate,
  isBeforeDeadline,
  type DayStr,
} from '../lib/time';
import { addFine, removeFine } from './bank';

export type RecordResult =
  | { ok: true; status: 'counted' | 'late'; submission: Submission; day: DayStr }
  | { ok: false; reason: 'too_short'; minDurationSec: number }
  | { ok: false; reason: 'already_done'; day: DayStr };

/**
 * Зафиксировать видео-кружок участника. Засчитывается, если длительность >= минимума.
 * Если момент после дедлайна дня — статус 'late' (= пропуск по правилам).
 */
export async function recordVideoNote(params: {
  challenge: Challenge;
  participationId: number;
  durationSec: number;
  messageId: number | bigint;
  submittedAt: Date;
}): Promise<RecordResult> {
  const { challenge, participationId, durationSec, submittedAt } = params;

  if (durationSec < challenge.minDurationSec) {
    return { ok: false, reason: 'too_short', minDurationSec: challenge.minDurationSec };
  }

  const day = challengeDay(submittedAt, challenge.timezone);
  const dayDate = dayToDate(day);

  // уже есть засчитанный кружок за этот день?
  const existing = await prisma.submission.findUnique({
    where: { participationId_day: { participationId, day: dayDate } },
  });
  if (existing && (existing.status === 'counted' || existing.status === 'late')) {
    return { ok: false, reason: 'already_done', day };
  }

  const inTime = isBeforeDeadline(submittedAt, day, challenge.dailyDeadline, challenge.timezone);
  const status: 'counted' | 'late' = inTime ? 'counted' : 'late';

  const submission = await prisma.submission.upsert({
    where: { participationId_day: { participationId, day: dayDate } },
    create: {
      challengeId: challenge.id,
      participationId,
      day: dayDate,
      messageId: BigInt(params.messageId),
      videoDuration: durationSec,
      submittedAt,
      status,
    },
    update: {
      messageId: BigInt(params.messageId),
      videoDuration: durationSec,
      submittedAt,
      status,
    },
  });

  // если опоздал — это пропуск, начисляем штраф; если вовремя — снимаем возможный штраф за этот день
  if (status === 'late') {
    await addFine({
      challengeId: challenge.id,
      participationId,
      day,
      type: 'miss',
      amount: challenge.fineAmount,
      note: 'Кружок после дедлайна',
    });
  } else {
    await removeFine({ challengeId: challenge.id, participationId, day });
  }

  return { ok: true, status, submission, day };
}

/** Пометить кружок фейком: двойной штраф, снимаем обычный штраф за день. */
export async function markSubmissionFake(submissionId: number): Promise<Submission | null> {
  const sub = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { challenge: true },
  });
  if (!sub) return null;

  const day = dateToDay(sub.day); // sub.day хранится как полночь UTC
  const fakeAmount = sub.challenge.fineAmount * sub.challenge.fakeFineMultiplier;

  const updated = await prisma.submission.update({
    where: { id: submissionId },
    data: { status: 'fake' },
  });

  await removeFine({ challengeId: sub.challengeId, participationId: sub.participationId, day });
  await addFine({
    challengeId: sub.challengeId,
    participationId: sub.participationId,
    day,
    type: 'fake',
    amount: fakeAmount,
    note: 'Фейковое подтверждение',
  });

  return updated;
}

/** Снять зачёт (не засчитывать): обычный штраф как за пропуск. */
export async function markSubmissionRejected(submissionId: number): Promise<Submission | null> {
  const sub = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { challenge: true },
  });
  if (!sub) return null;

  const day = challengeDay(sub.day, 'UTC');

  const updated = await prisma.submission.update({
    where: { id: submissionId },
    data: { status: 'rejected' },
  });

  await removeFine({
    challengeId: sub.challengeId,
    participationId: sub.participationId,
    day,
    type: 'fake',
  });
  await addFine({
    challengeId: sub.challengeId,
    participationId: sub.participationId,
    day,
    type: 'miss',
    amount: sub.challenge.fineAmount,
    note: 'Зачёт снят админом',
  });

  return updated;
}

/** Вернуть зачёт (counted) и снять штрафы за день. */
export async function markSubmissionCounted(submissionId: number): Promise<Submission | null> {
  const sub = await prisma.submission.findUnique({ where: { id: submissionId } });
  if (!sub) return null;
  const day = challengeDay(sub.day, 'UTC');
  const updated = await prisma.submission.update({
    where: { id: submissionId },
    data: { status: 'counted' },
  });
  await removeFine({ challengeId: sub.challengeId, participationId: sub.participationId, day });
  return updated;
}
