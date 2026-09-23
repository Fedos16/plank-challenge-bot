import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GrammyError } from 'grammy';
import { sendToChallengeChat } from '../src/bot/challengeChat';

type Call = { chatId: number; text: string; options: Record<string, unknown> };

/** Api с одним sendMessage: пишет вызовы и падает, пока в очереди есть ошибки. */
function fakeApi(errors: Error[] = []) {
  const calls: Call[] = [];
  const api = {
    sendMessage: async (chatId: number, text: string, options: Record<string, unknown> = {}) => {
      calls.push({ chatId, text, options });
      const err = errors.shift();
      if (err) throw err;
      return { message_id: calls.length };
    },
  };
  return { api: api as unknown as Parameters<typeof sendToChallengeChat>[0], calls };
}

function telegramError(description: string) {
  return new GrammyError(
    `Call to 'sendMessage' failed! (400: ${description})`,
    { ok: false, error_code: 400, description },
    'sendMessage',
    {},
  );
}

const CHAT = -1001234567890n;

test('sendToChallengeChat: без топика — в общий чат', async () => {
  const { api, calls } = fakeApi();
  await sendToChallengeChat(api, { id: 1, chatId: CHAT, chatThreadId: null }, 'отчёт', { parse_mode: 'HTML' });
  assert.deepEqual(calls, [{ chatId: Number(CHAT), text: 'отчёт', options: { parse_mode: 'HTML' } }]);
});

test('sendToChallengeChat: с топиком — в топик', async () => {
  const { api, calls } = fakeApi();
  await sendToChallengeChat(api, { id: 1, chatId: CHAT, chatThreadId: 42 }, 'отчёт', { parse_mode: 'HTML' });
  assert.deepEqual(calls[0].options, { parse_mode: 'HTML', message_thread_id: 42 });
  assert.equal(calls.length, 1);
});

test('sendToChallengeChat: топик пропал — повтор в общий чат', async () => {
  for (const description of ['Bad Request: message thread not found', 'Bad Request: TOPIC_CLOSED']) {
    const { api, calls } = fakeApi([telegramError(description)]);
    await sendToChallengeChat(api, { id: 1, chatId: CHAT, chatThreadId: 42 }, 'отчёт');
    assert.equal(calls.length, 2, description);
    assert.equal(calls[1].options.message_thread_id, undefined, description);
  }
});

test('sendToChallengeChat: прочие ошибки не глотает', async () => {
  const { api, calls } = fakeApi([telegramError('Forbidden: bot was kicked from the supergroup chat')]);
  await assert.rejects(sendToChallengeChat(api, { id: 1, chatId: CHAT, chatThreadId: 42 }, 'отчёт'), GrammyError);
  assert.equal(calls.length, 1);
});
