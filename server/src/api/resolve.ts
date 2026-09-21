import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Challenge, Participation } from '@prisma/client';
import { can, getChallengeById, type Capability } from '../services/challenge';
import { getActiveParticipation } from '../services/users';

export interface Resolved {
  challenge: Challenge;
  participation: Participation;
}

/** Целое положительное из параметра пути; иначе отвечает 400 и возвращает null. */
export function parseId(raw: unknown, reply: FastifyReply, error = 'bad_id'): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    reply.code(400).send({ error });
    return null;
  }
  return id;
}

/** Резолвит челлендж по :id и активное участие текущего пользователя. */
export async function resolveParticipant(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<Resolved | null> {
  const id = parseId((req.params as { id: string }).id, reply);
  if (id === null) return null;

  const challenge = await getChallengeById(id);
  if (!challenge || !challenge.isActive) {
    reply.code(404).send({ error: 'challenge_not_found' });
    return null;
  }
  const participation = await getActiveParticipation(id, req.ctx!.user.id);
  if (!participation) {
    reply.code(403).send({ error: 'not_participant' });
    return null;
  }
  return { challenge, participation };
}

/** То же, но только для челленджей, которые умеют `cap`: остальным — 400 not_applicable. */
export async function resolveWith(
  cap: Capability,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<Resolved | null> {
  const r = await resolveParticipant(req, reply);
  if (!r) return null;
  if (!can(r.challenge, cap)) {
    reply.code(400).send({ error: 'not_applicable' });
    return null;
  }
  return r;
}
