import { prisma } from '../lib/prisma';

/**
 * Выбрать следующую мотивационную речь: активную, использованную наиболее давно
 * (lastUsedAt = null считается «никогда» и идёт первой). Помечает её использованной.
 * Берутся речи челленджа и глобальные (challengeId = null).
 */
export async function pickNextQuote(challengeId: number): Promise<string | null> {
  const quote = await prisma.motivationalQuote.findFirst({
    where: {
      isActive: true,
      OR: [{ challengeId }, { challengeId: null }],
    },
    orderBy: [{ lastUsedAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
  });

  if (!quote) return null;

  await prisma.motivationalQuote.update({
    where: { id: quote.id },
    data: { lastUsedAt: new Date() },
  });

  return quote.text;
}
