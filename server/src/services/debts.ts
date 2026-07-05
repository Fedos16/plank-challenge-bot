import { prisma } from '../lib/prisma';
import { displayName } from './users';

export interface DebtRow {
  participationId: number;
  userId: number;
  name: string;
  status: string;
  accrued: number; // начислено штрафов (miss + fake)
  paid: number; // сколько скинул (payment)
  debt: number; // accrued - paid (может быть < 0 при переплате)
}

export interface PaymentEntry {
  id: number;
  participationId: number | null;
  participant: string | null;
  amount: number;
  note: string | null;
  createdAt: string;
}

export interface DebtsOverview {
  rows: DebtRow[];
  recentPayments: PaymentEntry[];
  totals: { accrued: number; paid: number; debt: number };
}

/** Сводка по долгам: сколько каждый участник должен и сколько уже скинул. */
export async function getDebtsOverview(challengeId: number): Promise<DebtsOverview> {
  const [participations, fines, payments, recent] = await Promise.all([
    prisma.participation.findMany({
      where: { challengeId },
      include: { user: true },
      orderBy: { joinedAt: 'asc' },
    }),
    prisma.ledgerEntry.groupBy({
      by: ['participationId'],
      where: { challengeId, type: { in: ['miss', 'fake'] } },
      _sum: { amount: true },
    }),
    prisma.ledgerEntry.groupBy({
      by: ['participationId'],
      where: { challengeId, type: 'payment' },
      _sum: { amount: true },
    }),
    prisma.ledgerEntry.findMany({
      where: { challengeId, type: 'payment' },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { participation: { include: { user: true } } },
    }),
  ]);

  const fineMap = new Map<number, number>();
  for (const f of fines) if (f.participationId != null) fineMap.set(f.participationId, f._sum.amount ?? 0);
  const payMap = new Map<number, number>();
  for (const p of payments) if (p.participationId != null) payMap.set(p.participationId, p._sum.amount ?? 0);

  const rows: DebtRow[] = participations.map((p) => {
    const accrued = fineMap.get(p.id) ?? 0;
    const paid = payMap.get(p.id) ?? 0;
    return {
      participationId: p.id,
      userId: p.userId,
      name: displayName(p.user),
      status: p.status,
      accrued,
      paid,
      debt: accrued - paid,
    };
  });
  // сначала самые большие должники, затем по имени
  rows.sort((a, b) => b.debt - a.debt || a.name.localeCompare(b.name, 'ru'));

  const totals = rows.reduce(
    (acc, r) => ({ accrued: acc.accrued + r.accrued, paid: acc.paid + r.paid, debt: acc.debt + r.debt }),
    { accrued: 0, paid: 0, debt: 0 },
  );

  const recentPayments: PaymentEntry[] = recent.map((e) => ({
    id: e.id,
    participationId: e.participationId,
    participant: e.participation ? displayName(e.participation.user) : null,
    amount: e.amount,
    note: e.note,
    createdAt: e.createdAt.toISOString(),
  }));

  return { rows, recentPayments, totals };
}
