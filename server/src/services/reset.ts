import { prisma } from '../lib/prisma';

/** Очистить штрафы и банк челленджа (все записи реестра). */
export async function resetLedger(challengeId: number): Promise<number> {
  const r = await prisma.ledgerEntry.deleteMany({ where: { challengeId } });
  return r.count;
}

/** Удалить всех участников челленджа вместе с их подтверждениями, болезнями и штрафами. */
export async function resetParticipants(challengeId: number): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await tx.ledgerEntry.deleteMany({ where: { challengeId, participationId: { not: null } } });
    await tx.submission.deleteMany({ where: { challengeId } });
    await tx.sickDay.deleteMany({ where: { challengeId } });
    const r = await tx.participation.deleteMany({ where: { challengeId } });
    // удаляем пользователей, не оставшихся ни в одном челлендже
    await tx.user.deleteMany({ where: { participations: { none: {} } } });
    return r.count;
  });
}

/** Отвязать чат от челленджа (сбросить chatId). */
export async function unbindChat(challengeId: number): Promise<void> {
  await prisma.challenge.update({ where: { id: challengeId }, data: { chatId: null } });
}

/**
 * Полный сброс данных челленджа: участники, подтверждения, болезни, штрафы/банк, отчёты.
 * Настройки челленджа, привязка чата и мотивационные речи сохраняются.
 */
export async function resetAllData(challengeId: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.ledgerEntry.deleteMany({ where: { challengeId } });
    await tx.submission.deleteMany({ where: { challengeId } });
    await tx.sickDay.deleteMany({ where: { challengeId } });
    await tx.dailyReport.deleteMany({ where: { challengeId } });
    await tx.participation.deleteMany({ where: { challengeId } });
    await tx.user.deleteMany({ where: { participations: { none: {} } } });
  });
}
