import { randomBytes } from 'node:crypto';
import type { Integration } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { publicBaseUrl } from '../lib/config';

/**
 * Телефонные хабы: приложение на телефоне читает общее хранилище здоровья и шлёт тренировки
 * на наш адрес. Авторизация — личный токен, как у умных весов: запрос идёт не из Web App.
 */
export const HUB_PROVIDERS = ['hae', 'health_connect'] as const;
export type HubProvider = (typeof HUB_PROVIDERS)[number];

const HUB_PATH: Record<HubProvider, string> = {
  hae: 'health-auto-export',
  health_connect: 'health-connect',
};

export function isHubProvider(v: unknown): v is HubProvider {
  return HUB_PROVIDERS.includes(v as HubProvider);
}

/** Адрес приёмника для вставки в приложение. Пусто, если публичный домен не настроен. */
export function hubIngestUrl(provider: HubProvider): string {
  const base = publicBaseUrl();
  return base ? `${base}/api/ingest/${HUB_PATH[provider]}` : '';
}

function newToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Подключение хаба: заводим строку с токеном. Повторный вызов возвращает ту же. */
export async function ensureHub(userId: number, provider: HubProvider): Promise<Integration> {
  return prisma.integration.upsert({
    where: { userId_provider: { userId, provider } },
    create: { userId, provider, ingestToken: newToken() },
    update: {},
  });
}

/** Перевыпуск токена: старый адрес сразу перестаёт приниматься. */
export async function rotateHubToken(userId: number, provider: HubProvider): Promise<Integration> {
  return prisma.integration.upsert({
    where: { userId_provider: { userId, provider } },
    create: { userId, provider, ingestToken: newToken() },
    update: { ingestToken: newToken() },
  });
}

/** Отключение: токен перестаёт действовать, уже загруженные тренировки остаются. */
export async function disconnectHub(userId: number, provider: HubProvider): Promise<boolean> {
  const r = await prisma.integration.deleteMany({ where: { userId, provider } });
  return r.count > 0;
}

/** Владелец токена — только для своего приёмника: токен от Android не подойдёт к адресу iOS. */
export async function findHubByToken(token: string, provider: HubProvider): Promise<Integration | null> {
  if (!token) return null;
  const integration = await prisma.integration.findUnique({ where: { ingestToken: token } });
  return integration && integration.provider === provider && integration.status === 'active' ? integration : null;
}

export async function touchHub(id: number): Promise<void> {
  const now = new Date();
  await prisma.integration.update({ where: { id }, data: { lastEventAt: now, lastSyncAt: now, lastError: null } });
}

export interface HubDTO {
  provider: HubProvider;
  url: string;
  /** null, пока человек не нажал «Подключить». */
  token: string | null;
  lastEventAt: string | null;
}

export async function listHubs(userId: number): Promise<HubDTO[]> {
  const rows = await prisma.integration.findMany({
    where: { userId, provider: { in: [...HUB_PROVIDERS] } },
  });
  return HUB_PROVIDERS.map((provider) => {
    const row = rows.find((r) => r.provider === provider);
    return {
      provider,
      url: hubIngestUrl(provider),
      token: row?.ingestToken ?? null,
      lastEventAt: row?.lastEventAt?.toISOString() ?? null,
    };
  });
}
