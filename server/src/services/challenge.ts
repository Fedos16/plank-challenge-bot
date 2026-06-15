import type { Challenge } from '@prisma/client';
import { prisma } from '../lib/prisma';

/** Активный челлендж (на текущем этапе он один) */
export async function getActiveChallenge(): Promise<Challenge | null> {
  return prisma.challenge.findFirst({
    where: { isActive: true },
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
