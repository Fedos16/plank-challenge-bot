import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import type { HubProvider } from './integrations';

/**
 * Журнал выгрузок с телефонных хабов. Логи контейнера живут только до следующего деплоя,
 * а разбираться, почему у человека не появляются тренировки или вес, приходится позже —
 * поэтому последние обращения к приёмнику складываем в базу.
 */

/** Сколько выгрузок храним по каждому хабу участника. Старые вытесняются новыми. */
export const KEEP_PER_HUB = 10;

/** Сколько имён метрик показываем в сводке: остальное — шум для разбора. */
const MAX_SUMMARY_KEYS = 20;

export type IngestStatus = 'ok' | 'bad_payload';

export interface IngestCounts {
  workouts?: number;
  workoutsCreated?: number;
  workoutsUpdated?: number;
  measurements?: number;
  measurementsCreated?: number;
  measurementsUpdated?: number;
}

function arrayLength(v: unknown): number | null {
  return Array.isArray(v) ? v.length : null;
}

/**
 * Что лежало в теле запроса: имена и размеры, без самих данных. По сводке видно, включил ли
 * человек в приложении нужные галочки — например, приходят ли метрики веса вместе с тренировками.
 */
export function summarizeBody(provider: HubProvider, body: unknown): Prisma.InputJsonValue {
  if (!body || typeof body !== 'object') return { shape: 'не объект' };

  if (provider === 'hae') {
    const data = (body as { data?: unknown }).data;
    if (!data || typeof data !== 'object') return { shape: 'нет поля data' };
    const d = data as Record<string, unknown>;
    const metrics: Record<string, number> = {};
    if (Array.isArray(d.metrics)) {
      for (const item of d.metrics.slice(0, MAX_SUMMARY_KEYS)) {
        if (!item || typeof item !== 'object') continue;
        const m = item as Record<string, unknown>;
        const name = typeof m.name === 'string' ? m.name : '(без имени)';
        metrics[name] = arrayLength(m.data) ?? 0;
      }
    }
    return {
      workouts: arrayLength(d.workouts) ?? 0,
      metrics,
      metricsTotal: Array.isArray(d.metrics) ? d.metrics.length : 0,
    };
  }

  // Health Connect кладёт всё массивами в корень: exercise, weight, body_fat и прочие
  const keys: Record<string, number> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    const len = arrayLength(value);
    if (len !== null && Object.keys(keys).length < MAX_SUMMARY_KEYS) keys[key] = len;
  }
  return { arrays: keys };
}

/**
 * Записывает выгрузку и подрезает историю до последних KEEP_PER_HUB по этому хабу.
 * Журнал — вспомогательный: его сбой не должен ронять приём данных с телефона.
 */
export async function recordIngest(input: {
  userId: number;
  provider: HubProvider;
  status: IngestStatus;
  bytes: number;
  summary: Prisma.InputJsonValue;
  counts?: IngestCounts;
}): Promise<void> {
  const c = input.counts ?? {};
  try {
    await prisma.ingestLog.create({
      data: {
        userId: input.userId,
        provider: input.provider,
        status: input.status,
        bytes: input.bytes,
        summary: input.summary,
        workouts: c.workouts ?? 0,
        workoutsCreated: c.workoutsCreated ?? 0,
        workoutsUpdated: c.workoutsUpdated ?? 0,
        measurements: c.measurements ?? 0,
        measurementsCreated: c.measurementsCreated ?? 0,
        measurementsUpdated: c.measurementsUpdated ?? 0,
      },
    });

    const stale = await prisma.ingestLog.findMany({
      where: { userId: input.userId, provider: input.provider },
      orderBy: { at: 'desc' },
      skip: KEEP_PER_HUB,
      select: { id: true },
    });
    if (stale.length) {
      await prisma.ingestLog.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } });
    }
  } catch (e) {
    console.warn('[ingest-log] не удалось записать выгрузку:', (e as Error).message);
  }
}

export interface IngestLogDTO {
  id: number;
  provider: string;
  at: string;
  status: IngestStatus;
  bytes: number;
  workouts: number;
  workoutsCreated: number;
  workoutsUpdated: number;
  measurements: number;
  measurementsCreated: number;
  measurementsUpdated: number;
  summary: unknown;
}

/** Последние выгрузки участника по всем его хабам, от свежих к старым. */
export async function listIngests(userId: number): Promise<IngestLogDTO[]> {
  const rows = await prisma.ingestLog.findMany({
    where: { userId },
    orderBy: { at: 'desc' },
    take: KEEP_PER_HUB * 2,
  });
  return rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    at: r.at.toISOString(),
    status: r.status as IngestStatus,
    bytes: r.bytes,
    workouts: r.workouts,
    workoutsCreated: r.workoutsCreated,
    workoutsUpdated: r.workoutsUpdated,
    measurements: r.measurements,
    measurementsCreated: r.measurementsCreated,
    measurementsUpdated: r.measurementsUpdated,
    summary: r.summary,
  }));
}
