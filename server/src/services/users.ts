import type { Participation, User } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { config } from '../lib/config';
import type { TelegramWebAppUser } from '../lib/telegramAuth';

interface UpsertInput {
  telegramId: bigint;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  photoUrl?: string | null;
}

/** Создать/обновить пользователя по данным Telegram. Выдаёт isAdmin из списка ADMIN_TELEGRAM_IDS. */
export async function upsertUser(input: UpsertInput): Promise<User> {
  const isSeedAdmin = config.adminTelegramIds.some((id) => id === input.telegramId);
  const existing = await prisma.user.findUnique({ where: { telegramId: input.telegramId } });

  return prisma.user.upsert({
    where: { telegramId: input.telegramId },
    create: {
      telegramId: input.telegramId,
      username: input.username ?? null,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      photoUrl: input.photoUrl ?? null,
      isAdmin: isSeedAdmin,
    },
    update: {
      username: input.username ?? undefined,
      firstName: input.firstName ?? undefined,
      lastName: input.lastName ?? undefined,
      photoUrl: input.photoUrl ?? undefined,
      // не понижаем права уже назначенного админа; повышаем, если попал в список
      isAdmin: isSeedAdmin || existing?.isAdmin || false,
    },
  });
}

export function userFromWebApp(tgUser: TelegramWebAppUser): UpsertInput {
  return {
    telegramId: BigInt(tgUser.id),
    username: tgUser.username ?? null,
    firstName: tgUser.first_name ?? null,
    lastName: tgUser.last_name ?? null,
    photoUrl: tgUser.photo_url ?? null,
  };
}

export function displayName(user: Pick<User, 'firstName' | 'lastName' | 'username'>): string {
  const parts = [user.firstName, user.lastName].filter(Boolean);
  if (parts.length) return parts.join(' ');
  if (user.username) return `@${user.username}`;
  return 'Участник';
}

/** Найти/создать участие пользователя в челлендже (active). */
export async function ensureParticipation(
  challengeId: number,
  userId: number,
): Promise<Participation> {
  const existing = await prisma.participation.findUnique({
    where: { challengeId_userId: { challengeId, userId } },
  });
  if (existing) {
    if (existing.status !== 'active') {
      return prisma.participation.update({
        where: { id: existing.id },
        data: { status: 'active' },
      });
    }
    return existing;
  }
  return prisma.participation.create({ data: { challengeId, userId } });
}

/** Активное участие пользователя по telegramId (или null) */
export async function getParticipationByTelegramId(
  challengeId: number,
  telegramId: bigint,
): Promise<(Participation & { user: User }) | null> {
  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) return null;
  const participation = await prisma.participation.findUnique({
    where: { challengeId_userId: { challengeId, userId: user.id } },
  });
  if (!participation || participation.status !== 'active') return null;
  return { ...participation, user };
}
