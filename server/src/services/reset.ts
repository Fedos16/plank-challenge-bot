import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

/**
 * Кого можно удалить после сброса челленджа: только тех, у кого не осталось вообще ничего.
 * Личные данные (вес, замеры, анкета, профили весов, личные челленджи) привязаны
 * к пользователю, а не к участию, и каскадом ушли бы вместе с ним — сброс планки не должен
 * их задевать. Новую пользовательскую таблицу обязательно добавлять сюда.
 */
const ORPHAN_USER: Prisma.UserWhereInput = {
  participations: { none: {} },
  weights: { none: {} },
  measurements: { none: {} },
  workouts: { none: {} },
  integrations: { none: {} },
  foodEntries: { none: {} },
  bodyProfile: { is: null },
  personalChallenges: { none: {} },
};

/** Очистить штрафы и банк челленджа (все записи реестра). */
export async function resetLedger(challengeId: number): Promise<number> {
  const r = await prisma.ledgerEntry.deleteMany({ where: { challengeId } });
  return r.count;
}

/** Удалить всех участников челленджа вместе с их подтверждениями, болезнями, заморозками и штрафами. */
export async function resetParticipants(challengeId: number): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await tx.ledgerEntry.deleteMany({ where: { challengeId, participationId: { not: null } } });
    await tx.submission.deleteMany({ where: { challengeId } });
    await tx.sickDay.deleteMany({ where: { challengeId } });
    await tx.streakFreeze.deleteMany({ where: { challengeId } });
    const r = await tx.participation.deleteMany({ where: { challengeId } });
    await tx.user.deleteMany({ where: ORPHAN_USER });
    return r.count;
  });
}

/** Отвязать чат от челленджа (сбросить chatId). */
export async function unbindChat(challengeId: number): Promise<void> {
  await prisma.challenge.update({ where: { id: challengeId }, data: { chatId: null } });
}

/**
 * Полный сброс данных челленджа: участники, подтверждения, болезни, заморозки, штрафы/банк, отчёты.
 * Настройки челленджа, привязка чата и мотивационные речи сохраняются.
 */
export async function resetAllData(challengeId: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.ledgerEntry.deleteMany({ where: { challengeId } });
    await tx.submission.deleteMany({ where: { challengeId } });
    await tx.sickDay.deleteMany({ where: { challengeId } });
    await tx.streakFreeze.deleteMany({ where: { challengeId } });
    await tx.dailyReport.deleteMany({ where: { challengeId } });
    await tx.participation.deleteMany({ where: { challengeId } });
    await tx.user.deleteMany({ where: ORPHAN_USER });
  });
}
