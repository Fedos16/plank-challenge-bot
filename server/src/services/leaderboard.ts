import type { Challenge } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getParticipationStreaks } from './streaks';
import { displayName } from './users';

export interface LeaderboardRow {
  participationId: number;
  name: string;
  username: string | null;
  photoUrl: string | null;
  currentStreak: number;
  maxStreak: number;
  doneCount: number;
}

export async function getLeaderboard(challenge: Challenge): Promise<LeaderboardRow[]> {
  const participations = await prisma.participation.findMany({
    where: { challengeId: challenge.id, status: 'active' },
    include: { user: true },
  });

  const rows: LeaderboardRow[] = [];
  for (const p of participations) {
    const streaks = await getParticipationStreaks(challenge, p);
    const doneCount = await prisma.submission.count({
      where: { participationId: p.id, status: 'counted' },
    });
    rows.push({
      participationId: p.id,
      name: displayName(p.user),
      username: p.user.username,
      photoUrl: p.user.photoUrl,
      currentStreak: streaks.current,
      maxStreak: streaks.max,
      doneCount,
    });
  }

  rows.sort(
    (a, b) =>
      b.currentStreak - a.currentStreak ||
      b.maxStreak - a.maxStreak ||
      b.doneCount - a.doneCount,
  );

  return rows;
}
