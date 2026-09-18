import type { Challenge, Participation, User } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { dayToDate, todayDay, type DayStr } from '../lib/time';

export type DayState =
  | 'done' // засчитанный кружок
  | 'late' // кружок после дедлайна (= пропуск по правилу 6)
  | 'fake' // помечен админом как фейк (двойной штраф)
  | 'rejected' // снят админом
  | 'sick' // валидный больничный
  | 'frozen' // пропуск, закрытый заморозкой серии
  | 'missed' // ничего, день прошёл
  | 'pending'; // ничего, сегодняшний день ещё не закрыт

export interface ParticipantDayStatus {
  participation: Participation;
  user: User;
  state: DayState;
}

/** Состояния, при которых начисляется обычный штраф (miss). */
export function isMissState(state: DayState): boolean {
  return state === 'missed' || state === 'late' || state === 'rejected';
}

/**
 * Состояния, за которые участник платит штраф. Заморозка спасает серию,
 * но не деньги: за замороженный день штраф остаётся.
 */
export function isFinableState(state: DayState): boolean {
  return isMissState(state) || state === 'frozen';
}

function mapSubmissionStatus(status: string): DayState {
  switch (status) {
    case 'counted':
      return 'done';
    case 'late':
      return 'late';
    case 'fake':
      return 'fake';
    case 'rejected':
      return 'rejected';
    default:
      return 'missed';
  }
}

/** Статусы всех активных участников за конкретный день челленджа. */
export async function getDayStatuses(
  challenge: Challenge,
  day: DayStr,
): Promise<ParticipantDayStatus[]> {
  const dayDate = dayToDate(day);
  const today = todayDay(challenge.timezone);

  const participations = await prisma.participation.findMany({
    where: { challengeId: challenge.id, status: 'active' },
    include: { user: true },
    orderBy: { joinedAt: 'asc' },
  });

  const submissions = await prisma.submission.findMany({
    where: { challengeId: challenge.id, day: dayDate },
  });
  const sickDays = await prisma.sickDay.findMany({
    where: { challengeId: challenge.id, day: dayDate, status: 'valid' },
  });
  const freezes = await prisma.streakFreeze.findMany({
    where: { challengeId: challenge.id, day: dayDate },
  });

  const subByPart = new Map(submissions.map((s) => [s.participationId, s]));
  const sickByPart = new Map(sickDays.map((s) => [s.participationId, s]));
  const frozenParts = new Set(freezes.map((f) => f.participationId));

  return participations.map((p) => {
    const sub = subByPart.get(p.id);
    let state: DayState;
    if (sub) {
      state = mapSubmissionStatus(sub.status);
    } else if (frozenParts.has(p.id)) {
      state = 'frozen';
    } else if (sickByPart.has(p.id)) {
      state = 'sick';
    } else if (day >= today) {
      state = 'pending';
    } else {
      state = 'missed';
    }
    const { user, ...participation } = p;
    return { participation, user, state };
  });
}

/** Статус одного участника за день. */
export async function getParticipantDayState(
  challenge: Challenge,
  participationId: number,
  day: DayStr,
): Promise<DayState> {
  const dayDate = dayToDate(day);
  const today = todayDay(challenge.timezone);

  const sub = await prisma.submission.findUnique({
    where: { participationId_day: { participationId, day: dayDate } },
  });
  if (sub) return mapSubmissionStatus(sub.status);

  const frozen = await prisma.streakFreeze.findUnique({
    where: { participationId_day: { participationId, day: dayDate } },
  });
  if (frozen) return 'frozen';

  const sick = await prisma.sickDay.findFirst({
    where: { participationId, day: dayDate, status: 'valid' },
  });
  if (sick) return 'sick';

  if (day >= today) return 'pending';
  return 'missed';
}
