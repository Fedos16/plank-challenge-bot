import type { Integration } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { config, publicBaseUrl } from '../lib/config';
import { decryptSecret, encryptSecret, signState } from '../lib/crypto';
import { dayjs } from '../lib/time';
import { ingestWorkouts } from './fitness/ingest';
import { deleteExternalWorkout, type ExternalWorkout } from './fitness/workouts';
import { mapWhoopWorkout, type WhoopEvent } from './parsers/whoop';

export const WHOOP = 'whoop';

/** offline — чтобы выдали refresh token; profile — сопоставить user_id из вебхука с нашим пользователем. */
const SCOPES = 'offline read:workout read:profile';

/** За сколько до истечения считаем access token протухшим. */
const EXPIRY_SKEW_MS = 60_000;
/** Окно регулярной сверки: вебхук — для скорости, опрос — источник истины. */
const RECONCILE_HOURS = 48;
/** Глубина первой выгрузки, если у человека нет ни одного фитнес-челленджа. */
const DEFAULT_BACKFILL_DAYS = 30;
const MAX_BACKFILL_DAYS = 120;

/** Интеграция работает, только когда заданы ключи приложения, ключ шифрования и публичный адрес. */
export function isWhoopEnabled(): boolean {
  return Boolean(config.whoop.clientId && config.whoop.clientSecret && config.tokenEncKey && publicBaseUrl());
}

export function whoopRedirectUri(): string {
  return `${publicBaseUrl()}/api/oauth/whoop/callback`;
}

export function whoopWebhookUrl(): string {
  return `${publicBaseUrl()}/api/webhooks/whoop`;
}

/** Ссылка, по которой пользователь разрешает доступ на стороне WHOOP. */
export function buildWhoopAuthUrl(userId: number): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.whoop.clientId,
    redirect_uri: whoopRedirectUri(),
    scope: SCOPES,
    state: signState(userId),
  });
  return `${config.whoop.apiBase}/oauth/oauth2/auth?${params}`;
}

// ---------- токены ----------

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

class WhoopAuthError extends Error {}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${config.whoop.apiBase}/oauth/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ...params,
      client_id: config.whoop.clientId,
      client_secret: config.whoop.clientSecret,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 300);
    // 400/401 — провайдер отверг сам грант: токен отозван или уже использован. Повторять бесполезно
    if (res.status === 400 || res.status === 401) throw new WhoopAuthError(`${res.status} ${text}`);
    throw new Error(`whoop token ${res.status} ${text}`);
  }
  const json = (await res.json()) as TokenResponse;
  if (!json.access_token) throw new Error('whoop token: пустой ответ');
  return json;
}

function tokenFields(t: TokenResponse) {
  return {
    accessTokenEnc: encryptSecret(t.access_token),
    // WHOOP ротирует refresh token при каждом обновлении; если новый не пришёл — старый ещё годен
    ...(t.refresh_token ? { refreshTokenEnc: encryptSecret(t.refresh_token) } : {}),
    expiresAt: new Date(Date.now() + t.expires_in * 1000),
    scope: t.scope ?? null,
  };
}

/** Одновременные обновления одного токена в этом процессе сливаются в одно. */
const refreshing = new Map<number, Promise<string>>();

/**
 * Действующий access token. Refresh token у WHOOP одноразовый: два параллельных обновления
 * убивают интеграцию (второе приходит с уже погашенным токеном). Поэтому два замка: single-flight
 * внутри процесса и блокировка строки в базе — на время деплоя живут два контейнера сразу.
 */
export async function getAccessToken(integrationId: number): Promise<string> {
  const inFlight = refreshing.get(integrationId);
  if (inFlight) return inFlight;

  const task = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Integration" WHERE id = ${integrationId} FOR UPDATE`;
      const fresh = await tx.integration.findUnique({ where: { id: integrationId } });
      if (!fresh?.accessTokenEnc || !fresh.refreshTokenEnc) throw new WhoopAuthError('нет токенов');

      // пока ждали замок, токен мог обновить другой процесс
      if (fresh.expiresAt && fresh.expiresAt.getTime() - Date.now() > EXPIRY_SKEW_MS) {
        return decryptSecret(fresh.accessTokenEnc);
      }
      const tokens = await tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: decryptSecret(fresh.refreshTokenEnc),
        scope: 'offline',
      });
      await tx.integration.update({
        where: { id: integrationId },
        data: { ...tokenFields(tokens), status: 'active', lastError: null },
      });
      return tokens.access_token;
    },
    { timeout: 25_000, maxWait: 10_000 },
  );

  refreshing.set(integrationId, task);
  try {
    return await task;
  } catch (err) {
    if (err instanceof WhoopAuthError) await markReauthRequired(integrationId, err.message);
    throw err;
  } finally {
    refreshing.delete(integrationId);
  }
}

/** Доступ отозван или протух безвозвратно: помечаем и один раз просим переподключить. */
async function markReauthRequired(integrationId: number, reason: string): Promise<void> {
  const before = await prisma.integration.findUnique({ where: { id: integrationId }, include: { user: true } });
  if (!before || before.status === 'reauth_required') return;
  await prisma.integration.update({
    where: { id: integrationId },
    data: { status: 'reauth_required', lastError: reason.slice(0, 300) },
  });
  try {
    const { bot } = await import('../bot/bot');
    await bot?.api.sendMessage(
      Number(before.user.telegramId),
      '⌚ WHOOP отключился: доступ отозван или истёк. Подключите его заново в приложении — раздел «Ещё» → «Подключения». До тех пор тренировки можно вносить вручную.',
    );
  } catch {
    // пользователь не начинал диалог с ботом — пропускаем
  }
}

async function whoopGet<T>(integrationId: number, path: string, query: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams(query).toString();
  const url = `${config.whoop.apiBase}/developer${path}${qs ? `?${qs}` : ''}`;

  // Вторая попытка — на случай, когда токен только что обновил другой процесс: WHOOP при этом
  // гасит старый access token, хотя по часам он ещё годен. Перечитываем из базы уже новый.
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getAccessToken(integrationId);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401) continue;
    if (!res.ok) throw new Error(`whoop ${path} -> ${res.status}`);
    return (await res.json()) as T;
  }
  await markReauthRequired(integrationId, '401 от API');
  throw new WhoopAuthError('401 от API');
}

// ---------- подключение ----------

export type ConnectError = 'whoop_disabled' | 'whoop_exchange_failed' | 'whoop_account_taken';

/** Завершение OAuth: меняем code на токены, узнаём user_id браслета, запускаем выгрузку истории. */
export async function connectWhoop(userId: number, code: string): Promise<Integration | ConnectError> {
  if (!isWhoopEnabled()) return 'whoop_disabled';

  let tokens: TokenResponse;
  let externalUserId: string;
  try {
    tokens = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: whoopRedirectUri() });
    const res = await fetch(`${config.whoop.apiBase}/developer/v2/user/profile/basic`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`profile ${res.status}`);
    externalUserId = String(((await res.json()) as { user_id?: unknown }).user_id ?? '');
    if (!externalUserId) throw new Error('profile без user_id');
  } catch (err) {
    console.error('[whoop] обмен кода не удался:', err);
    return 'whoop_exchange_failed';
  }

  // один браслет — один человек: иначе вебхук не поймёт, кому писать тренировку
  const taken = await prisma.integration.findUnique({
    where: { provider_externalUserId: { provider: WHOOP, externalUserId } },
  });
  if (taken && taken.userId !== userId) return 'whoop_account_taken';

  const data = { ...tokenFields(tokens), externalUserId, status: 'active', lastError: null };
  const integration = await prisma.integration.upsert({
    where: { userId_provider: { userId, provider: WHOOP } },
    create: { userId, provider: WHOOP, ...data },
    update: data,
  });

  // История выгружается в фоне: пользователь ждёт только редиректа, а не десятков запросов
  void backfillWhoop(integration).catch((err) => console.error('[whoop] бэкфилл не удался:', err));
  return integration;
}

/** Отключение: просим WHOOP отозвать доступ (и вебхуки) и забываем токены. Тренировки остаются. */
export async function disconnectWhoop(userId: number): Promise<boolean> {
  const integration = await prisma.integration.findUnique({
    where: { userId_provider: { userId, provider: WHOOP } },
  });
  if (!integration) return false;
  try {
    const token = await getAccessToken(integration.id);
    await fetch(`${config.whoop.apiBase}/developer/v2/user/access`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // отозвать не вышло (токен уже мёртв, сеть) — у себя отключаем всё равно
  }
  await prisma.integration.delete({ where: { id: integration.id } });
  return true;
}

// ---------- синхронизация ----------

interface WorkoutPage {
  records?: unknown[];
  next_token?: string | null;
}

/** Все тренировки за период, постранично. Ограничение страниц — страховка от зацикливания. */
async function fetchWorkoutsSince(integrationId: number, since: Date): Promise<ExternalWorkout[]> {
  const result: ExternalWorkout[] = [];
  let nextToken: string | null = null;
  for (let page = 0; page < 40; page++) {
    const query: Record<string, string> = { limit: '25', start: since.toISOString() };
    if (nextToken) query.nextToken = nextToken;
    const res: WorkoutPage = await whoopGet<WorkoutPage>(integrationId, '/v2/activity/workout', query);
    for (const record of res.records ?? []) {
      const mapped = mapWhoopWorkout(record);
      if (mapped) result.push(mapped);
    }
    nextToken = res.next_token ?? null;
    if (!nextToken) break;
  }
  return result;
}

async function syncSince(integration: Integration, since: Date): Promise<number> {
  const workouts = await fetchWorkoutsSince(integration.id, since);
  const saved = await ingestWorkouts(integration.userId, WHOOP, workouts);
  await prisma.integration.update({ where: { id: integration.id }, data: { lastSyncAt: new Date() } });
  return saved.created.length;
}

/** С какого момента тянуть историю: со старта самого раннего фитнес-челленджа человека. */
async function backfillStart(userId: number): Promise<Date> {
  const first = await prisma.participation.findFirst({
    where: { userId, status: 'active', challenge: { isActive: true, kind: 'fitness' } },
    orderBy: { challenge: { startDate: 'asc' } },
    include: { challenge: true },
  });
  const floor = dayjs().subtract(MAX_BACKFILL_DAYS, 'day').toDate();
  const wanted = first?.challenge.startDate ?? dayjs().subtract(DEFAULT_BACKFILL_DAYS, 'day').toDate();
  return wanted < floor ? floor : wanted;
}

export async function backfillWhoop(integration: Integration): Promise<number> {
  const created = await syncSince(integration, await backfillStart(integration.userId));
  await prisma.integration.update({ where: { id: integration.id }, data: { backfilledAt: new Date() } });
  console.log(`[whoop] пользователь=${integration.userId} выгрузка истории: новых ${created}`);
  return created;
}

/**
 * Регулярная сверка всех подключённых браслетов за последние двое суток. Заодно держит
 * токены живыми. Сбой одного человека не мешает остальным.
 */
export async function reconcileWhoop(): Promise<void> {
  if (!isWhoopEnabled()) return;
  const integrations = await prisma.integration.findMany({ where: { provider: WHOOP, status: 'active' } });
  const since = dayjs().subtract(RECONCILE_HOURS, 'hour').toDate();
  for (const integration of integrations) {
    try {
      const created = await syncSince(integration, since);
      if (created) console.log(`[whoop] пользователь=${integration.userId} сверка: новых ${created}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await prisma.integration
        .update({ where: { id: integration.id }, data: { lastError: reason.slice(0, 300) } })
        .catch(() => undefined);
    }
  }
}

/** Обработка вебхука: событие несёт только id, саму тренировку забираем из API. */
export async function handleWhoopEvent(event: WhoopEvent): Promise<void> {
  if (event.kind === 'ignored') return;
  const integration = await prisma.integration.findUnique({
    where: { provider_externalUserId: { provider: WHOOP, externalUserId: event.whoopUserId } },
  });
  if (!integration || integration.status !== 'active') return;
  await prisma.integration.update({ where: { id: integration.id }, data: { lastEventAt: new Date() } });

  if (event.kind === 'workout_deleted') {
    await deleteExternalWorkout(integration.userId, WHOOP, event.workoutId);
    return;
  }
  const record = await whoopGet<unknown>(integration.id, `/v2/activity/workout/${encodeURIComponent(event.workoutId)}`);
  const mapped = mapWhoopWorkout(record);
  if (mapped) await ingestWorkouts(integration.userId, WHOOP, [mapped]);
}

export interface IntegrationDTO {
  provider: string;
  status: string;
  lastSyncAt: string | null;
  lastEventAt: string | null;
  lastError: string | null;
}

export function toIntegrationDTO(i: Integration): IntegrationDTO {
  return {
    provider: i.provider,
    status: i.status,
    lastSyncAt: i.lastSyncAt?.toISOString() ?? null,
    lastEventAt: i.lastEventAt?.toISOString() ?? null,
    lastError: i.lastError,
  };
}
