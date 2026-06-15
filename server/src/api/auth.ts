import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Challenge, Participation, User } from '@prisma/client';
import { validateInitData, type TelegramWebAppUser } from '../lib/telegramAuth';
import { config } from '../lib/config';
import { getActiveChallenge } from '../services/challenge';
import { ensureParticipation, upsertUser, userFromWebApp } from '../services/users';

export interface RequestCtx {
  user: User;
  challenge: Challenge | null;
  participation: Participation | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    ctx?: RequestCtx;
  }
}

/**
 * Аутентификация запроса из Web App по заголовку X-Telegram-Init-Data.
 * В dev-режиме допускается X-Dev-Telegram-Id для локального тестирования без initData.
 */
export async function authPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const initData = req.headers['x-telegram-init-data'];
  let tgUser: TelegramWebAppUser | null = null;

  if (typeof initData === 'string' && initData.length > 0) {
    const validated = validateInitData(initData, config.botToken);
    if (validated) tgUser = validated.user;
  }

  if (!tgUser && config.nodeEnv !== 'production') {
    const devId = req.headers['x-dev-telegram-id'];
    if (typeof devId === 'string' && devId.length > 0) {
      tgUser = {
        id: Number(devId),
        first_name: (req.headers['x-dev-name'] as string) || 'Dev User',
        username: (req.headers['x-dev-username'] as string) || undefined,
      };
    }
  }

  if (!tgUser) {
    reply.code(401).send({ error: 'unauthorized' });
    return;
  }

  const user = await upsertUser(userFromWebApp(tgUser));
  const challenge = await getActiveChallenge();
  const participation = challenge ? await ensureParticipation(challenge.id, user.id) : null;

  req.ctx = { user, challenge, participation };
}

export async function adminPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.ctx?.user?.isAdmin) {
    reply.code(403).send({ error: 'forbidden' });
  }
}
