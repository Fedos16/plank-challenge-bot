import type { Challenge } from '@prisma/client';
import { prisma } from '../lib/prisma';

/** Механика челленджа: ежедневная планка со штрафами либо группа для взвешиваний. */
export const CHALLENGE_KINDS = ['plank', 'weight'] as const;
export type ChallengeKind = (typeof CHALLENGE_KINDS)[number];

export function isWeightChallenge(ch: Challenge): boolean {
  return ch.kind === 'weight';
}

/**
 * Активный челлендж с планкой (на текущем этапе он один). Именно в него бот засчитывает
 * кружки, по нему работают отчёты и напоминания, и в него автоматически попадает каждый,
 * кто открыл приложение. Группы взвешиваний сюда не попадают — в них вступают вручную.
 */
export async function getActiveChallenge(): Promise<Challenge | null> {
  return prisma.challenge.findFirst({
    where: { isActive: true, kind: 'plank' },
    orderBy: { createdAt: 'asc' },
  });
}

export async function getActiveChallengeOrThrow(): Promise<Challenge> {
  const ch = await getActiveChallenge();
  if (!ch) throw new Error('Нет активного челленджа');
  return ch;
}

export async function getChallengeById(id: number): Promise<Challenge | null> {
  return prisma.challenge.findUnique({ where: { id } });
}

/** Активные челленджи, в которых пользователь ещё не состоит: их он может выбрать сам. */
export async function listJoinableChallenges(userId: number): Promise<Challenge[]> {
  const challenges = await prisma.challenge.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (challenges.length === 0) return [];

  const mine = await prisma.participation.findMany({
    where: { userId, status: 'active', challengeId: { in: challenges.map((c) => c.id) } },
    select: { challengeId: true },
  });
  const joined = new Set(mine.map((p) => p.challengeId));
  return challenges.filter((c) => !joined.has(c.id));
}
