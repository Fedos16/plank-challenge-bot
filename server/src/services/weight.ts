import { randomBytes } from 'node:crypto';
import type { ScaleProfile, User, WeightEntry } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { config } from '../lib/config';
import { challengeDay, dateToDay, dayToDate, dayjs } from '../lib/time';
import type { ScaleMeasurement } from './openscale';
import { displayName } from './users';

function tz(): string {
  return config.defaultTimezone;
}

/** Сколько измерений отдаём в кабинет (хватает на график за пару месяцев). */
const HISTORY_LIMIT = 90;

/** Свежим считаем взвешивание не старше этого срока — только о нём пишем в ЛС. */
const FRESH_NOTIFY_HOURS = 12;

export interface WeightPoint {
  id: number;
  measuredAt: string;
  day: string;
  weightKg: number;
  bodyFat: number | null;
  water: number | null;
  /** Доля мышц, % — так присылают весы и так она лежит в базе. */
  muscle: number | null;
  /** Та же величина массой: вес × доля. */
  muscleKg: number | null;
}

/** Мышцы массой из доли. Хранится только доля, килограммы всегда выводятся из неё и веса. */
export function muscleKgOf(weightKg: number, musclePct: number): number {
  return round1((weightKg * musclePct) / 100);
}

/**
 * Доля мышц из массы. Два знака, а не один, как у остальных процентов: иначе обратный пересчёт
 * в килограммы на весе под сотню гуляет на ±0,05 кг и человек видит не то число, что вводил.
 */
export function musclePctOf(weightKg: number, muscleKg: number): number {
  return Math.round((muscleKg / weightKg) * 10000) / 100;
}

/** Профиль весов с телефона владельца: кому уходят его взвешивания. */
export interface ScaleProfileDTO {
  id: number;
  scaleUserId: number;
  scaleUsername: string | null;
  /** Получатель взвешиваний: сам владелец, пока профиль никому не отдан. */
  targetUserId: number;
  targetName: string;
  entries: number;
  lastWeightKg: number | null;
  lastSeenAt: string;
}

export interface WeightOverview {
  /** Куда вбить адрес в openScale sync и каким секретом он защищён. */
  connection: { webhookUrl: string; token: string; configured: boolean };
  latest: WeightPoint | null;
  /** Насколько вес изменился за период (кг, минус = похудел). null — не с чем сравнивать. */
  deltas: { week: number | null; month: number | null; total: number | null };
  stats: { count: number; min: number | null; max: number | null; firstDay: string | null };
  /** От старых к новым — так фронт рисует график без разворота. */
  history: WeightPoint[];
  /** Профили openScale, замеченные на этом токене (пусто, пока телефон один на одного). */
  profiles: ScaleProfileDTO[];
  /** Кому можно отдать профиль: участники общих челленджей и сам владелец. */
  candidates: { userId: number; name: string }[];
}

function toPoint(e: WeightEntry): WeightPoint {
  return {
    id: e.id,
    measuredAt: e.measuredAt.toISOString(),
    day: dateToDay(e.day),
    weightKg: e.weightKg,
    bodyFat: e.bodyFat,
    water: e.water,
    muscle: e.muscle,
    muscleKg: e.muscle === null ? null : muscleKgOf(e.weightKg, e.muscle),
  };
}

/** Полный адрес вебхука для openScale sync. Пусто, если публичный домен не настроен. */
export function scaleWebhookUrl(): string {
  const base = config.webAppUrl || (config.publicDomain ? `https://${config.publicDomain}` : '');
  if (!base) return '';
  return `${base.replace(/\/+$/, '')}/api/ingest/openscale`;
}

/** Токен пользователя для вебхука: создаётся при первом обращении из кабинета. */
export async function ensureScaleToken(userId: number): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { scaleToken: true } });
  if (user?.scaleToken) return user.scaleToken;
  return rotateScaleToken(userId);
}

/** Перевыпуск токена: старый адрес сразу перестаёт работать. */
export async function rotateScaleToken(userId: number): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  await prisma.user.update({ where: { id: userId }, data: { scaleToken: token } });
  return token;
}

export async function findUserByScaleToken(token: string): Promise<User | null> {
  if (!token) return null;
  return prisma.user.findFirst({ where: { scaleToken: token } });
}

/**
 * Профиль openScale, приславший измерение. Новый профиль заводим сразу: владелец увидит
 * его в кабинете и решит, чей это вес. Пока не решил — записи идут ему самому.
 */
async function touchProfile(
  ownerId: number,
  scaleUserId: number,
  scaleUsername: string | null,
  seenAt: Date,
): Promise<ScaleProfile> {
  return prisma.scaleProfile.upsert({
    where: { ownerId_scaleUserId: { ownerId, scaleUserId } },
    create: { ownerId, scaleUserId, scaleUsername, lastSeenAt: seenAt },
    update: {
      // имя профиля в openScale могли переименовать
      scaleUsername: scaleUsername ?? undefined,
      lastSeenAt: seenAt,
    },
  });
}

export interface SaveResult {
  created: WeightEntry[];
  updated: WeightEntry[];
}

/**
 * Сохраняет измерения с телефона владельца, раскладывая их по получателям.
 *
 * Одно и то же взвешивание приходит повторно (ретраи, правка записи в openScale, начальная
 * выгрузка истории), поэтому пишем идемпотентно: сперва ищем по id записи в openScale, затем
 * по времени взвешивания у получателя.
 */
export async function saveMeasurements(
  ownerId: number,
  measurements: ScaleMeasurement[],
): Promise<SaveResult> {
  const result: SaveResult = { created: [], updated: [] };

  for (const m of measurements) {
    const profile =
      m.scaleUserId !== null
        ? await touchProfile(ownerId, m.scaleUserId, m.scaleUsername, m.measuredAt)
        : null;
    const userId = profile?.targetUserId ?? ownerId;

    const data = {
      measuredAt: m.measuredAt,
      day: dayToDate(challengeDay(m.measuredAt, tz())),
      weightKg: m.weightKg,
      bodyFat: m.bodyFat,
      water: m.water,
      muscle: m.muscle,
      scaleEntryId: m.scaleEntryId,
      scaleUserId: m.scaleUserId,
      scaleUsername: m.scaleUsername,
      sourceOwnerId: ownerId,
    };

    const byScaleId =
      m.scaleEntryId !== null
        ? await prisma.weightEntry.findFirst({
            where: { sourceOwnerId: ownerId, scaleUserId: m.scaleUserId, scaleEntryId: m.scaleEntryId },
          })
        : null;
    const existing =
      byScaleId ??
      (await prisma.weightEntry.findUnique({
        where: { userId_measuredAt: { userId, measuredAt: m.measuredAt } },
      }));

    if (existing) {
      result.updated.push(await prisma.weightEntry.update({ where: { id: existing.id }, data }));
      continue;
    }

    try {
      result.created.push(await prisma.weightEntry.create({ data: { userId, ...data } }));
    } catch {
      // Параллельный ретрай того же вебхука успел записать это взвешивание — обновляем его
      const racing = await prisma.weightEntry.findUnique({
        where: { userId_measuredAt: { userId, measuredAt: m.measuredAt } },
      });
      if (racing) {
        result.updated.push(await prisma.weightEntry.update({ where: { id: racing.id }, data }));
      }
    }
  }

  return result;
}

/**
 * Удаление одного взвешивания (openScale прислал delete). Ищем по телефону-источнику, а не
 * по получателю: профиль мог быть отдан другому участнику.
 */
export async function deleteMeasurement(
  ownerId: number,
  scaleUserId: number | null,
  measuredAt: Date,
): Promise<number> {
  const r = await prisma.weightEntry.deleteMany({
    where: {
      sourceOwnerId: ownerId,
      measuredAt,
      ...(scaleUserId !== null ? { scaleUserId } : {}),
    },
  });
  return r.count;
}

export interface ManualWeightInput {
  weightKg: number;
  bodyFat?: number | null;
  water?: number | null;
  muscle?: number | null;
  /** Мышцы массой — кому так привычнее. Задано вместе с `muscle` — побеждают килограммы. */
  muscleKg?: number | null;
  /** Когда взвесились; по умолчанию — сейчас. */
  measuredAt?: Date;
}

export type ManualWeightError = 'bad_weight' | 'bad_percent' | 'bad_muscle_kg' | 'bad_date';

/** Процент состава тела: пусто допустимо, иначе (0..100]. Ноль — «не измерено», как у весов. */
function manualPercent(v: number | null | undefined): number | null | 'bad' {
  if (v === null || v === undefined || v === 0) return null;
  if (!Number.isFinite(v) || v < 0 || v > 100) return 'bad';
  return round1(v);
}

/**
 * Взвешивание, введённое руками: у кого нет умных весов, тот ведёт вес сам.
 * От записей с весов отличается пустым sourceOwnerId. Повтор на тот же момент обновляет запись.
 */
export async function addManualWeight(
  userId: number,
  input: ManualWeightInput,
): Promise<WeightEntry | ManualWeightError> {
  if (!Number.isFinite(input.weightKg) || input.weightKg <= 0 || input.weightKg > 500) {
    return 'bad_weight';
  }
  const bodyFat = manualPercent(input.bodyFat);
  const water = manualPercent(input.water);
  let muscle = manualPercent(input.muscle);
  if (bodyFat === 'bad' || water === 'bad' || muscle === 'bad') return 'bad_percent';

  const muscleKg = input.muscleKg;
  if (muscleKg !== null && muscleKg !== undefined && muscleKg !== 0) {
    // мышц не бывает больше, чем весит человек
    if (!Number.isFinite(muscleKg) || muscleKg < 0 || muscleKg >= input.weightKg) return 'bad_muscle_kg';
    muscle = musclePctOf(input.weightKg, muscleKg);
  }

  const measuredAt = input.measuredAt ?? new Date();
  // будущее не принимаем: запас в сутки покрывает расхождение часов и поясов
  if (Number.isNaN(measuredAt.getTime()) || measuredAt.getTime() > Date.now() + 86_400_000) {
    return 'bad_date';
  }

  const data = {
    weightKg: Math.round(input.weightKg * 100) / 100,
    bodyFat,
    water,
    muscle,
    day: dayToDate(challengeDay(measuredAt, tz())),
  };
  return prisma.weightEntry.upsert({
    where: { userId_measuredAt: { userId, measuredAt } },
    create: { userId, measuredAt, ...data },
    update: data,
  });
}

/** Удаление из кабинета. */
export async function deleteEntry(userId: number, id: number): Promise<boolean> {
  const r = await prisma.weightEntry.deleteMany({ where: { id, userId } });
  return r.count > 0;
}

/** Последнее взвешивание не позже момента `at` (для дельт за период). */
async function entryBefore(userId: number, at: Date): Promise<WeightEntry | null> {
  return prisma.weightEntry.findFirst({
    where: { userId, measuredAt: { lte: at } },
    orderBy: { measuredAt: 'desc' },
  });
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Кому можно отдать профиль весов: участники групп, где вес — часть челленджа (взвешивания
 * и фитнес), в которых состоит владелец. Планка здесь ни при чём: вес к ней отношения не имеет.
 */
async function assignCandidates(ownerId: number): Promise<{ userId: number; name: string }[]> {
  const mine = await prisma.participation.findMany({
    where: {
      userId: ownerId,
      status: 'active',
      challenge: { isActive: true, kind: { in: ['weight', 'fitness'] } },
    },
    select: { challengeId: true },
  });
  const neighbours = await prisma.participation.findMany({
    where: { challengeId: { in: mine.map((p) => p.challengeId) }, status: 'active' },
    select: { user: true },
    distinct: ['userId'],
  });

  const owner = await prisma.user.findUnique({ where: { id: ownerId } });
  const byId = new Map<number, string>();
  if (owner) byId.set(owner.id, displayName(owner));
  for (const n of neighbours) byId.set(n.user.id, displayName(n.user));

  return [...byId.entries()].map(([userId, name]) => ({ userId, name }));
}

async function profilesFor(ownerId: number): Promise<ScaleProfileDTO[]> {
  const profiles = await prisma.scaleProfile.findMany({
    where: { ownerId },
    orderBy: { lastSeenAt: 'desc' },
    include: { target: true, owner: true },
  });

  const result: ScaleProfileDTO[] = [];
  for (const p of profiles) {
    const target = p.target ?? p.owner;
    const entries = await prisma.weightEntry.count({
      where: { sourceOwnerId: ownerId, scaleUserId: p.scaleUserId },
    });
    const last = await prisma.weightEntry.findFirst({
      where: { sourceOwnerId: ownerId, scaleUserId: p.scaleUserId },
      orderBy: { measuredAt: 'desc' },
      select: { weightKg: true },
    });
    result.push({
      id: p.id,
      scaleUserId: p.scaleUserId,
      scaleUsername: p.scaleUsername,
      targetUserId: target.id,
      targetName: displayName(target),
      entries,
      lastWeightKg: last?.weightKg ?? null,
      lastSeenAt: p.lastSeenAt.toISOString(),
    });
  }
  return result;
}

export interface WeightSummary {
  latestKg: number | null;
  day: string | null;
  weekDelta: number | null;
  count: number;
}

/** Вес и недельная динамика одной строкой — для карточки челленджа в списке. */
export async function getWeightSummary(userId: number): Promise<WeightSummary> {
  const latest = await prisma.weightEntry.findFirst({
    where: { userId },
    orderBy: { measuredAt: 'desc' },
  });
  const count = await prisma.weightEntry.count({ where: { userId } });
  if (!latest) return { latestKg: null, day: null, weekDelta: null, count };

  const weekAgo = await entryBefore(userId, dayjs(latest.measuredAt).subtract(7, 'day').toDate());
  return {
    latestKg: latest.weightKg,
    day: dateToDay(latest.day),
    weekDelta: weekAgo ? round1(latest.weightKg - weekAgo.weightKg) : null,
    count,
  };
}

export async function getWeightOverview(userId: number): Promise<WeightOverview> {
  const token = await ensureScaleToken(userId);
  const entries = await prisma.weightEntry.findMany({
    where: { userId },
    orderBy: { measuredAt: 'desc' },
    take: HISTORY_LIMIT,
  });
  const count = await prisma.weightEntry.count({ where: { userId } });
  const profiles = await profilesFor(userId);
  const connection = {
    webhookUrl: scaleWebhookUrl(),
    token,
    configured: count > 0 || profiles.length > 0,
  };
  const candidates = await assignCandidates(userId);
  const latest = entries[0];

  if (!latest) {
    return {
      connection,
      latest: null,
      deltas: { week: null, month: null, total: null },
      stats: { count: 0, min: null, max: null, firstDay: null },
      history: [],
      profiles,
      candidates,
    };
  }

  const weekAgo = await entryBefore(userId, dayjs(latest.measuredAt).subtract(7, 'day').toDate());
  const monthAgo = await entryBefore(userId, dayjs(latest.measuredAt).subtract(30, 'day').toDate());
  const first = await prisma.weightEntry.findFirst({
    where: { userId },
    orderBy: { measuredAt: 'asc' },
  });
  const extremes = await prisma.weightEntry.aggregate({
    where: { userId },
    _min: { weightKg: true },
    _max: { weightKg: true },
  });

  return {
    connection,
    latest: toPoint(latest),
    deltas: {
      week: weekAgo ? round1(latest.weightKg - weekAgo.weightKg) : null,
      month: monthAgo ? round1(latest.weightKg - monthAgo.weightKg) : null,
      total: first && first.id !== latest.id ? round1(latest.weightKg - first.weightKg) : null,
    },
    stats: {
      count,
      min: extremes._min.weightKg,
      max: extremes._max.weightKg,
      firstDay: first ? dateToDay(first.day) : null,
    },
    history: entries.map(toPoint).reverse(),
    profiles,
    candidates,
  };
}

export interface AssignResult {
  ok: boolean;
  error?: 'profile_not_found' | 'target_not_allowed';
  /** Сколько взвешиваний переехало к новому владельцу и сколько осталось на месте. */
  moved?: number;
  skipped?: number;
}

/**
 * Отдать профиль весов участнику (null — забрать себе). Вместе с профилем переезжает и
 * накопленная история: иначе чужой вес остался бы висеть в кабинете владельца телефона.
 */
export async function assignProfile(
  ownerId: number,
  profileId: number,
  targetUserId: number | null,
): Promise<AssignResult> {
  const profile = await prisma.scaleProfile.findFirst({ where: { id: profileId, ownerId } });
  if (!profile) return { ok: false, error: 'profile_not_found' };

  if (targetUserId !== null && targetUserId !== ownerId) {
    const allowed = await assignCandidates(ownerId);
    if (!allowed.some((c) => c.userId === targetUserId)) {
      return { ok: false, error: 'target_not_allowed' };
    }
  }

  const newOwner = targetUserId ?? ownerId;
  await prisma.scaleProfile.update({
    where: { id: profile.id },
    data: { targetUserId: targetUserId === ownerId ? null : targetUserId },
  });

  const entries = await prisma.weightEntry.findMany({
    where: { sourceOwnerId: ownerId, scaleUserId: profile.scaleUserId },
  });
  let moved = 0;
  let skipped = 0;
  for (const e of entries) {
    if (e.userId === newOwner) continue;
    try {
      await prisma.weightEntry.update({ where: { id: e.id }, data: { userId: newOwner } });
      moved++;
    } catch {
      // У получателя уже есть взвешивание с этим временем — оставляем запись как есть
      skipped++;
    }
  }

  return { ok: true, moved, skipped };
}

function formatKg(n: number): string {
  return `${n.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} кг`;
}

/**
 * Пишет в ЛС о свежем взвешивании — тому, чей это профиль весов, а не владельцу телефона.
 * О старых записях молчим: первая синхронизация тянет всю историю из openScale.
 */
export async function notifyNewMeasurement(entry: WeightEntry): Promise<boolean> {
  const ageHours = dayjs().diff(dayjs(entry.measuredAt), 'hour', true);
  if (ageHours > FRESH_NOTIFY_HOURS) return false;

  const user = await prisma.user.findUnique({ where: { id: entry.userId } });
  if (!user) return false;

  const previous = await prisma.weightEntry.findFirst({
    where: { userId: user.id, measuredAt: { lt: entry.measuredAt } },
    orderBy: { measuredAt: 'desc' },
  });

  const lines = [`⚖️ <b>${formatKg(entry.weightKg)}</b>`];
  if (previous) {
    const diff = round1(entry.weightKg - previous.weightKg);
    const days = Math.max(1, dayjs(entry.measuredAt).diff(dayjs(previous.measuredAt), 'day'));
    lines.push(
      diff === 0
        ? `Столько же, сколько ${days} дн. назад`
        : `${diff > 0 ? '+' : '−'}${formatKg(Math.abs(diff))} за ${days} дн.`,
    );
  }
  // Несколько профилей на телефоне: подписываем, чей вес приехал, пока профиль не разложен
  if (entry.scaleUsername && entry.sourceOwnerId === entry.userId) {
    const profiles = await prisma.scaleProfile.count({ where: { ownerId: entry.userId } });
    if (profiles > 1) lines.push('Профиль весов: ' + entry.scaleUsername);
  }
  const composition = [
    entry.bodyFat !== null ? `жир ${entry.bodyFat}%` : null,
    entry.muscle !== null ? `мышцы ${entry.muscle}%` : null,
    entry.water !== null ? `вода ${entry.water}%` : null,
  ].filter(Boolean);
  if (composition.length) lines.push(composition.join(' · '));

  const { bot } = await import('../bot/bot');
  if (!bot) return false;
  try {
    await bot.api.sendMessage(Number(user.telegramId), lines.join('\n'), { parse_mode: 'HTML' });
    return true;
  } catch {
    // Не нажал /start или заблокировал бота — данные всё равно сохранены.
    return false;
  }
}
