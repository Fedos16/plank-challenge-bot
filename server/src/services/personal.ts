import type { PersonalChallenge } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { config } from '../lib/config';
import { dateToDay, dayToDate, dayjs, todayDay } from '../lib/time';

function tz(): string {
  return config.defaultTimezone;
}

export interface PersonalSummary {
  id: number;
  title: string;
  unit: string;
  todayReps: number;
  todaySets: number;
  currentStreak: number;
  totalReps: number;
}

export interface PersonalDetail {
  id: number;
  title: string;
  unit: string;
  today: { day: string; totalReps: number; sets: { id: number; reps: number }[] };
  streak: number;
  totals: { totalReps: number; totalSets: number; daysActive: number; bestDayReps: number };
  history: { day: string; totalReps: number; setCount: number }[];
}

export async function createPersonalChallenge(
  userId: number,
  title: string,
  unit?: string,
): Promise<PersonalChallenge> {
  return prisma.personalChallenge.create({
    data: { userId, title: title.trim(), unit: unit?.trim() || 'повторений' },
  });
}

/** Серия: дни подряд с хотя бы одной записью (сегодня без записи не обрывает). */
async function streakFor(challengeId: number): Promise<number> {
  const sets = await prisma.workoutSet.findMany({
    where: { personalChallengeId: challengeId },
    select: { day: true },
  });
  if (sets.length === 0) return 0;
  const daysWith = new Set(sets.map((s) => dateToDay(s.day)));
  const today = todayDay(tz());
  let cursor = dayjs(today);
  if (!daysWith.has(today)) cursor = cursor.subtract(1, 'day'); // сегодня ещё можно успеть
  let streak = 0;
  while (daysWith.has(cursor.format('YYYY-MM-DD'))) {
    streak++;
    cursor = cursor.subtract(1, 'day');
  }
  return streak;
}

export async function listPersonal(userId: number): Promise<PersonalSummary[]> {
  const challenges = await prisma.personalChallenge.findMany({
    where: { userId, isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  const todayDate = dayToDate(todayDay(tz()));
  const result: PersonalSummary[] = [];
  for (const c of challenges) {
    const todaySets = await prisma.workoutSet.findMany({
      where: { personalChallengeId: c.id, day: todayDate },
      select: { reps: true },
    });
    const totalAgg = await prisma.workoutSet.aggregate({
      where: { personalChallengeId: c.id },
      _sum: { reps: true },
    });
    result.push({
      id: c.id,
      title: c.title,
      unit: c.unit,
      todayReps: todaySets.reduce((a, s) => a + s.reps, 0),
      todaySets: todaySets.length,
      currentStreak: await streakFor(c.id),
      totalReps: totalAgg._sum.reps ?? 0,
    });
  }
  return result;
}

export async function getPersonalDetail(id: number, userId: number): Promise<PersonalDetail | null> {
  const c = await prisma.personalChallenge.findFirst({ where: { id, userId } });
  if (!c) return null;

  const today = todayDay(tz());
  const todayDate = dayToDate(today);
  const todaySets = await prisma.workoutSet.findMany({
    where: { personalChallengeId: id, day: todayDate },
    orderBy: { id: 'asc' },
  });
  const allSets = await prisma.workoutSet.findMany({
    where: { personalChallengeId: id },
    orderBy: [{ day: 'desc' }, { id: 'asc' }],
  });

  const byDay = new Map<string, { day: string; totalReps: number; setCount: number }>();
  for (const s of allSets) {
    const d = dateToDay(s.day);
    const e = byDay.get(d) ?? { day: d, totalReps: 0, setCount: 0 };
    e.totalReps += s.reps;
    e.setCount += 1;
    byDay.set(d, e);
  }
  const dayAggregates = [...byDay.values()];

  return {
    id: c.id,
    title: c.title,
    unit: c.unit,
    today: {
      day: today,
      totalReps: todaySets.reduce((a, s) => a + s.reps, 0),
      sets: todaySets.map((s) => ({ id: s.id, reps: s.reps })),
    },
    streak: await streakFor(id),
    totals: {
      totalReps: allSets.reduce((a, s) => a + s.reps, 0),
      totalSets: allSets.length,
      daysActive: byDay.size,
      bestDayReps: Math.max(0, ...dayAggregates.map((e) => e.totalReps)),
    },
    history: dayAggregates.slice(0, 30),
  };
}

export async function addSet(id: number, userId: number, reps: number): Promise<boolean> {
  const c = await prisma.personalChallenge.findFirst({ where: { id, userId } });
  if (!c) return false;
  await prisma.workoutSet.create({
    data: { personalChallengeId: id, day: dayToDate(todayDay(tz())), reps },
  });
  return true;
}

export async function deleteSet(id: number, userId: number, setId: number): Promise<boolean> {
  const c = await prisma.personalChallenge.findFirst({ where: { id, userId } });
  if (!c) return false;
  await prisma.workoutSet.deleteMany({ where: { id: setId, personalChallengeId: id } });
  return true;
}

export async function deletePersonal(id: number, userId: number): Promise<boolean> {
  const r = await prisma.personalChallenge.deleteMany({ where: { id, userId } });
  return r.count > 0;
}
