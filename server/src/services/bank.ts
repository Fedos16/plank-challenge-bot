import { prisma } from '../lib/prisma';
import { dayToDate, type DayStr } from '../lib/time';

// Типы записей, которые формируют банк. `payment` (кто сколько скинул) сюда не входит:
// штраф уже учтён в банке при начислении, а оплата лишь гасит личный долг участника.
const BANK_TYPES = ['miss', 'fake', 'adjustment', 'spend'] as const;

/** Текущий банк челленджа = сумма записей реестра, влияющих на банк (без оплат). */
export async function getBank(challengeId: number): Promise<number> {
  const agg = await prisma.ledgerEntry.aggregate({
    where: { challengeId, type: { in: BANK_TYPES as unknown as string[] } },
    _sum: { amount: true },
  });
  return agg._sum.amount ?? 0;
}

/** Сумма штрафов конкретного участника (записи miss + fake). */
export async function getParticipantFines(participationId: number): Promise<number> {
  const agg = await prisma.ledgerEntry.aggregate({
    where: { participationId, type: { in: ['miss', 'fake'] } },
    _sum: { amount: true },
  });
  return agg._sum.amount ?? 0;
}

/**
 * Начислить штраф участнику. type: 'miss' (обычный) | 'fake' (двойной).
 * Идемпотентность по (participationId, day, type) — повторно не дублируется.
 */
export async function addFine(params: {
  challengeId: number;
  participationId: number;
  day: DayStr;
  type: 'miss' | 'fake';
  amount: number;
  note?: string;
}): Promise<void> {
  const dayDate = dayToDate(params.day);
  const existing = await prisma.ledgerEntry.findFirst({
    where: {
      challengeId: params.challengeId,
      participationId: params.participationId,
      day: dayDate,
      type: params.type,
    },
  });
  if (existing) return;

  await prisma.ledgerEntry.create({
    data: {
      challengeId: params.challengeId,
      participationId: params.participationId,
      day: dayDate,
      type: params.type,
      amount: params.amount,
      note: params.note ?? null,
    },
  });
}

/** Удалить штраф участника за день (например при отмене зачёта). */
export async function removeFine(params: {
  challengeId: number;
  participationId: number;
  day: DayStr;
  type?: 'miss' | 'fake';
}): Promise<void> {
  await prisma.ledgerEntry.deleteMany({
    where: {
      challengeId: params.challengeId,
      participationId: params.participationId,
      day: dayToDate(params.day),
      type: params.type ?? { in: ['miss', 'fake'] },
    },
  });
}

/** Ручная корректировка банка (тип adjustment): любая сумма + / −. */
export async function addAdjustment(
  challengeId: number,
  amount: number,
  note?: string,
): Promise<void> {
  await prisma.ledgerEntry.create({
    data: { challengeId, type: 'adjustment', amount, note: note ?? null },
  });
}

/** Трата из банка (тип spend, amount хранится отрицательным). */
export async function addSpend(
  challengeId: number,
  amount: number,
  note?: string,
): Promise<void> {
  const negative = -Math.abs(amount);
  await prisma.ledgerEntry.create({
    data: { challengeId, type: 'spend', amount: negative, note: note ?? null },
  });
}

/**
 * Записать оплату участника («сколько скинул»). Хранится типом `payment`
 * с положительной суммой и гасит личный долг, но на банк не влияет.
 */
export async function addPayment(params: {
  challengeId: number;
  participationId: number;
  amount: number;
  note?: string;
}): Promise<void> {
  await prisma.ledgerEntry.create({
    data: {
      challengeId: params.challengeId,
      participationId: params.participationId,
      type: 'payment',
      amount: Math.abs(Math.trunc(params.amount)),
      note: params.note ?? null,
    },
  });
}

/** Удалить запись об оплате (отмена «скинул»). */
export async function removePayment(challengeId: number, id: number): Promise<void> {
  await prisma.ledgerEntry.deleteMany({ where: { id, challengeId, type: 'payment' } });
}
