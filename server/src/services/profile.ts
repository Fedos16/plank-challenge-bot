import type { Challenge, Participation, User } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { challengeDayNumber, dateToDay, todayDay } from '../lib/time';
import { getParticipationStreaks } from './streaks';
import { getParticipantDayState } from './dayStatus';
import { getParticipantFines } from './bank';
import { displayName } from './users';

export interface ProfileDTO {
  user: {
    name: string;
    username: string | null;
    photoUrl: string | null;
  };
  isAdmin: boolean;
  challenge: {
    id: number;
    title: string;
    dayNumber: number;
    startDate: string;
  };
  todayState: string;
  streak: { current: number; max: number };
  totals: {
    done: number;
    late: number;
    missed: number; // дней со штрафом (miss + fake)
    sick: number;
    finesTotal: number;
  };
}

export async function getProfile(
  challenge: Challenge,
  participation: Participation,
  user: User,
): Promise<ProfileDTO> {
  const today = todayDay(challenge.timezone);
  const [streaks, todayState, doneCount, lateCount, sickCount, finesTotal, fineDays] =
    await Promise.all([
      getParticipationStreaks(challenge, participation),
      getParticipantDayState(challenge, participation.id, today),
      prisma.submission.count({ where: { participationId: participation.id, status: 'counted' } }),
      prisma.submission.count({ where: { participationId: participation.id, status: 'late' } }),
      prisma.sickDay.count({ where: { participationId: participation.id, status: 'valid' } }),
      getParticipantFines(participation.id),
      prisma.ledgerEntry.count({
        where: { participationId: participation.id, type: { in: ['miss', 'fake'] } },
      }),
    ]);

  return {
    user: {
      name: displayName(user),
      username: user.username,
      photoUrl: user.photoUrl,
    },
    isAdmin: user.isAdmin,
    challenge: {
      id: challenge.id,
      title: challenge.title,
      dayNumber: challengeDayNumber(dateToDay(challenge.startDate), today),
      startDate: dateToDay(challenge.startDate),
    },
    todayState,
    streak: streaks,
    totals: {
      done: doneCount,
      late: lateCount,
      missed: fineDays,
      sick: sickCount,
      finesTotal,
    },
  };
}
