import type { Challenge } from '@prisma/client';
import { GrammyError, type Api } from 'grammy';

type SendOptions = NonNullable<Parameters<Api['sendMessage']>[2]>;

/** Telegram отвечает так, когда топика больше нет или он закрыт для бота. */
const LOST_TOPIC = /thread not found|topic_(closed|deleted)/i;

/**
 * Сообщение в чат челленджа: в его топик, если группа с темами. Пропал топик — пишем в общий
 * чат: отчёт не на месте лучше потерянного, а шуметь о сломанной настройке будет лог.
 */
export async function sendToChallengeChat(
  api: Pick<Api, 'sendMessage'>,
  ch: Pick<Challenge, 'id' | 'chatId' | 'chatThreadId'>,
  text: string,
  options: SendOptions = {},
) {
  const chatId = Number(ch.chatId);
  if (ch.chatThreadId === null) return api.sendMessage(chatId, text, options);
  try {
    return await api.sendMessage(chatId, text, { ...options, message_thread_id: ch.chatThreadId });
  } catch (err) {
    if (!(err instanceof GrammyError) || !LOST_TOPIC.test(err.description)) throw err;
    console.warn(`[chat] челлендж ${ch.id}: топик ${ch.chatThreadId} недоступен (${err.description}), пишу в общий чат`);
    return api.sendMessage(chatId, text, options);
  }
}
