import type { Context } from 'grammy';
import { bot } from './bot';
import { appLaunchKeyboard, moderationKeyboard, restoreKeyboard, startKeyboard } from './keyboards';
import { config } from '../lib/config';
import { prisma } from '../lib/prisma';
import { dayjs, yesterdayDay } from '../lib/time';
import { getActiveChallenge } from '../services/challenge';
import {
  displayName,
  getActiveParticipation,
  getParticipationByTelegramId,
  upsertUser,
} from '../services/users';
import {
  markSubmissionCounted,
  markSubmissionFake,
  markSubmissionRejected,
  recordVideoNote,
} from '../services/submissions';
import { reportSick } from '../services/sick';
import { sendDailyReport, escapeHtml, formatRulesMessageHtml } from '../services/report';
import { parseCompositionText } from '../services/composition';
import {
  compositionLine,
  latestEntryForComposition,
  preferredMuscleUnit,
  setComposition,
  type CompositionInput,
} from '../services/weight';

async function isAdminTg(telegramId: bigint): Promise<boolean> {
  if (config.adminTelegramIds.some((id) => id === telegramId)) return true;
  const user = await prisma.user.findUnique({ where: { telegramId } });
  return Boolean(user?.isAdmin);
}

function fromTelegramId(ctx: Context): bigint | null {
  return ctx.from ? BigInt(ctx.from.id) : null;
}

/** Топик, из которого пришло сообщение; null — общий чат или группа без тем. */
function topicId(ctx: Context): number | null {
  return ctx.msg?.is_topic_message ? (ctx.msg.message_thread_id ?? null) : null;
}

export function registerHandlers(): void {
  if (!bot) return; // бот выключен (нет BOT_TOKEN)

  // Глобальный обработчик ошибок: ловим исключения хэндлеров, чтобы webhook возвращал 200
  // (иначе Telegram копит и ретраит апдейты), и логируем причину.
  bot.catch((err) => {
    const updateId = err.ctx?.update?.update_id;
    console.error(`[bot] ошибка при обработке апдейта ${updateId}:`, err.error);
  });

  // bot.catch срабатывает только при long polling: webhookCallback вызывает bot.handleUpdate
  // напрямую, и ошибка оттуда всплывает мимо errorHandler. Ловим её здесь, иначе при сетевом
  // сбое (например, недоступен api.telegram.org) необработанный reject роняет весь процесс.
  bot.use(async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      console.error(`[bot] ошибка при обработке апдейта ${ctx.update.update_id}:`, err);
    }
  });

  // /start — регистрация и кнопка открытия Web App
  bot.command('start', async (ctx) => {
    if (!ctx.from) return;
    const user = await upsertUser({
      telegramId: BigInt(ctx.from.id),
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
    });

    const challenge = await getActiveChallenge();
    const participation = challenge
      ? await getActiveParticipation(challenge.id, user.id)
      : null;

    const text = [
      `Привет, ${escapeHtml(displayName(user))}! 👋`,
      '',
      !challenge
        ? 'Сейчас нет активного челленджа.'
        : participation
          ? `Ты участвуешь в челлендже «${escapeHtml(challenge.title)}».`
          : `Идёт челлендж «${escapeHtml(challenge.title)}». Чтобы присоединиться, открой приложение и нажми «Участвовать»: пока не вступишь, кружки не считаются — но и штрафов нет.`,
      '',
      'Как это работает:',
      `• Каждый день делай планку и присылай кружочек в общий чат (минимум ${challenge?.minDurationSec ?? 60} сек).`,
      `• Кружок нужно успеть до ${challenge?.dailyDeadline ?? '23:59'}.`,
      `• Заболел? Нажми кнопку ниже или напиши /sick до ${challenge?.sickDeadline ?? '14:00'}.`,
      '',
      'Открой приложение, чтобы видеть свой профиль, серию и статистику 👇',
    ].join('\n');

    // web_app-кнопки разрешены только в личке; в группе используем url-кнопку запуска
    const keyboard =
      ctx.chat?.type === 'private' ? startKeyboard() : appLaunchKeyboard(ctx.me.username);
    await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'HTML' });
  });

  // /id — прислать пользователю его Telegram ID (для ADMIN_TELEGRAM_IDS / VITE_DEV_TELEGRAM_ID)
  bot.command('id', async (ctx) => {
    if (!ctx.from) return;
    const lines = [
      `Ваш Telegram ID: <code>${ctx.from.id}</code>`,
      ctx.from.username ? `Username: @${ctx.from.username}` : null,
      '',
      'Впишите этот ID в <code>server/.env → ADMIN_TELEGRAM_IDS</code> и <code>web/.env → VITE_DEV_TELEGRAM_ID</code>.',
    ].filter(Boolean) as string[];
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });

  // /app — кнопка запуска Web App (работает и в группе, не переходя в бота)
  bot.command('app', async (ctx) => {
    const username = ctx.me.username;
    await ctx.reply('Открой приложение челленджа 👇', {
      reply_markup: appLaunchKeyboard(username),
    });
  });

  // /pinapp — опубликовать и закрепить кнопку запуска приложения (только админ)
  bot.command('pinapp', async (ctx) => {
    const tgId = fromTelegramId(ctx);
    if (!tgId || !(await isAdminTg(tgId))) {
      await ctx.reply('Команда доступна только администратору.');
      return;
    }
    const msg = await ctx.reply(
      '🏆 <b>Челлендж «Планка»</b>\nОткрой приложение — профиль, серия, рейтинг и банк.',
      { parse_mode: 'HTML', reply_markup: appLaunchKeyboard(ctx.me.username) },
    );
    try {
      await ctx.api.pinChatMessage(ctx.chat.id, msg.message_id, { disable_notification: true });
    } catch {
      await ctx.reply('⚠️ Не смог закрепить — дайте боту право «Закреплять сообщения» в группе.');
    }
  });

  // /rules — правила челленджа (красивое оформление + кнопка приложения)
  bot.command('rules', async (ctx) => {
    const challenge = await getActiveChallenge();
    if (!challenge) {
      await ctx.reply('Нет активного челленджа.');
      return;
    }
    await ctx.reply(formatRulesMessageHtml(challenge), {
      parse_mode: 'HTML',
      reply_markup: appLaunchKeyboard(ctx.me.username),
    });
  });

  // /chatid — узнать id текущего чата и топика (для настройки мониторинга), только админ
  bot.command('chatid', async (ctx) => {
    const tgId = fromTelegramId(ctx);
    if (!tgId || !(await isAdminTg(tgId))) return;
    const topic = topicId(ctx);
    const lines = [`ID этого чата: <code>${ctx.chat.id}</code>`];
    if (topic !== null) lines.push(`ID топика: <code>${topic}</code>`);
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });

  // /bindchat — привязать текущий чат как мониторимый (только админ, в группе)
  bot.command('bindchat', async (ctx) => {
    const tgId = fromTelegramId(ctx);
    if (!tgId || !(await isAdminTg(tgId))) return;
    const challenge = await getActiveChallenge();
    if (!challenge) {
      await ctx.reply('Нет активного челленджа.');
      return;
    }
    // в группе с темами отчёты и напоминания пойдут в топик, где вызвали команду
    const topic = topicId(ctx);
    await prisma.challenge.update({
      where: { id: challenge.id },
      data: { chatId: BigInt(ctx.chat.id), chatThreadId: topic },
    });
    await ctx.reply(
      topic === null
        ? `✅ Чат привязан к челленджу «${challenge.title}». Кружки отсюда теперь засчитываются.`
        : `✅ Чат привязан к челленджу «${challenge.title}». Отчёты и напоминания будут приходить в этот топик, кружки засчитываются из любого топика чата.`,
    );
    // публикуем красивые правила + кнопку открытия приложения и закрепляем их
    const rulesMsg = await ctx.reply(formatRulesMessageHtml(challenge), {
      parse_mode: 'HTML',
      reply_markup: appLaunchKeyboard(ctx.me.username),
    });
    try {
      await ctx.api.pinChatMessage(ctx.chat.id, rulesMsg.message_id, {
        disable_notification: true,
      });
    } catch {
      await ctx.reply(
        '⚠️ Правила опубликованы, но закрепить не вышло — дайте боту право «Закреплять сообщения» в группе и выполните /bindchat снова.',
      );
    }
  });

  // /sick — сообщить о болезни на сегодня
  bot.command('sick', async (ctx) => {
    await handleSick(ctx);
  });

  // /report [YYYY-MM-DD] — ручной запуск дневного отчёта (только админ)
  bot.command('report', async (ctx) => {
    const tgId = fromTelegramId(ctx);
    if (!tgId || !(await isAdminTg(tgId))) {
      await ctx.reply('Команда доступна только администратору.');
      return;
    }
    const challenge = await getActiveChallenge();
    if (!challenge) {
      await ctx.reply('Нет активного челленджа.');
      return;
    }
    const arg = ctx.match?.toString().trim();
    const day = arg && /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : yesterdayDay(challenge.timezone);
    const result = await sendDailyReport(challenge, day, { force: true });
    if (result.sent) {
      await ctx.reply(`✅ Отчёт за ${day} отправлен в чат челленджа.`);
    } else {
      await ctx.reply(`Отчёт за ${day} сформирован, но чат не привязан (см. /bindchat).`);
    }
  });

  // Кнопка «Заболел сегодня»
  bot.callbackQuery('sick:today', async (ctx) => {
    await handleSick(ctx, true);
  });

  // Модерация кружков (fake / reject / count) — только админ
  bot.callbackQuery(/^mod:(fake|reject|count):(\d+)$/, async (ctx) => {
    const tgId = fromTelegramId(ctx);
    if (!tgId || !(await isAdminTg(tgId))) {
      await ctx.answerCallbackQuery({ text: 'Только для администратора', show_alert: true });
      return;
    }
    const action = ctx.match?.[1] as 'fake' | 'reject' | 'count';
    const submissionId = Number(ctx.match?.[2]);

    if (action === 'fake') {
      await markSubmissionFake(submissionId);
      await ctx.answerCallbackQuery({ text: 'Помечено как фейк, двойной штраф начислен' });
      await safeEdit(ctx, '❌ <b>Помечено как фейк</b> — двойной штраф в банк.', restoreKeyboard(submissionId));
    } else if (action === 'reject') {
      await markSubmissionRejected(submissionId);
      await ctx.answerCallbackQuery({ text: 'Зачёт снят, штраф начислен' });
      await safeEdit(ctx, '🚫 <b>Зачёт снят</b> — штраф как за пропуск.', restoreKeyboard(submissionId));
    } else {
      await markSubmissionCounted(submissionId);
      await ctx.answerCallbackQuery({ text: 'Зачёт возвращён' });
      await safeEdit(ctx, '✅ <b>Зачёт возвращён.</b>', moderationKeyboard(submissionId));
    }
  });

  // Детект видео-кружка в мониторимом чате
  bot.on('message:video_note', async (ctx) => {
    const challenge = await getActiveChallenge();
    if (!challenge) return;

    // принимаем кружки только из привязанного чата (если он задан)
    if (challenge.chatId && BigInt(ctx.chat.id) !== challenge.chatId) return;
    if (!challenge.chatId) return; // чат не привязан — игнорируем (см. /bindchat)
    if (!ctx.from) return;

    const tgId = BigInt(ctx.from.id);
    const participation = await getParticipationByTelegramId(challenge.id, tgId);
    if (!participation) {
      // не зарегистрированный участник — мягкая подсказка
      await ctx.reply(
        'Ты ещё не зарегистрирован в челлендже. Открой бота и нажми /start, чтобы участие засчитывалось.',
        { reply_parameters: { message_id: ctx.message.message_id } },
      );
      return;
    }

    const duration = ctx.message.video_note.duration;
    const result = await recordVideoNote({
      challenge,
      participationId: participation.id,
      durationSec: duration,
      messageId: ctx.message.message_id,
      submittedAt: new Date(ctx.message.date * 1000),
    });

    if (!result.ok) {
      if (result.reason === 'too_short') {
        await ctx.reply(
          `⏱ Кружок ${duration} сек — это меньше минимума (${result.minDurationSec} сек). Планка не засчитана.`,
          { reply_parameters: { message_id: ctx.message.message_id } },
        );
      } else if (result.reason === 'already_done') {
        await ctx.reply('✅ Планка на сегодня уже засчитана.', {
          reply_parameters: { message_id: ctx.message.message_id },
        });
      }
      return;
    }

    const name = escapeHtml(displayName(participation.user));
    const note =
      result.status === 'late'
        ? `⚠️ ${name}, кружок принят, но после дедлайна — засчитан как пропуск (штраф ${challenge.fineAmount} ₽).`
        : `✅ ${name}, планка засчитана! (${duration} сек)`;

    // Без публичных кнопок модерации — фейк/снятие зачёта делается в админке.
    await ctx.reply(note, {
      reply_parameters: { message_id: ctx.message.message_id },
      parse_mode: 'HTML',
    });
  });

  // Состав тела ответом на сообщение о взвешивании: весы вроде Mi Scale 2 отдают телефону
  // только вес, жир и мышцы человек переписывает с экрана приложения весов
  bot.on('message:text', async (ctx, next) => {
    if (ctx.chat.type !== 'private' || ctx.message.text.startsWith('/')) return next();
    const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
    if (!user) return next();

    const muscleUnit = await preferredMuscleUnit(user.id);
    const parsed = parseCompositionText(ctx.message.text, muscleUnit);
    if (!parsed) return next();

    const entry = await latestEntryForComposition(user.id);
    if (!entry) {
      await ctx.reply('Не нашёл взвешивания за последние двое суток — запишите вес во вкладке «Тело» в приложении.');
      return;
    }

    const input: CompositionInput = {};
    if (parsed.bodyFat !== undefined) input.bodyFat = parsed.bodyFat;
    if (parsed.water !== undefined) input.water = parsed.water;
    if (parsed.muscle) input[parsed.muscle.unit === 'kg' ? 'muscleKg' : 'muscle'] = parsed.muscle.value;

    const saved = await setComposition(user.id, entry.id, input);
    if (saved === 'bad_muscle_kg') {
      await ctx.reply('Мышц больше, чем весите вы сами, не бывает. Если это проценты, допишите «%»: <code>24,4 71,7%</code>.', {
        parse_mode: 'HTML',
      });
      return;
    }
    if (typeof saved === 'string') {
      await ctx.reply('Жир и вода — в процентах, от 0 до 100. Пример: <code>24,4 58,7</code>.', { parse_mode: 'HTML' });
      return;
    }

    const weight = saved.weightKg.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
    const when = dayjs(saved.measuredAt).tz(config.defaultTimezone).format('DD.MM HH:mm');
    await ctx.reply(`✅ Дописал к взвешиванию ${weight} кг (${when}): ${compositionLine(saved, muscleUnit)}`, {
      reply_parameters: { message_id: ctx.message.message_id },
    });
  });
}

async function handleSick(ctx: Context, fromButton = false): Promise<void> {
  if (fromButton) await ctx.answerCallbackQuery().catch(() => undefined);
  if (!ctx.from) return;

  const challenge = await getActiveChallenge();
  if (!challenge) {
    await ctx.reply('Нет активного челленджа.');
    return;
  }

  const participation = await getParticipationByTelegramId(challenge.id, BigInt(ctx.from.id));
  if (!participation) {
    await ctx.reply('Ты ещё не зарегистрирован. Нажми /start, чтобы участвовать.');
    return;
  }

  const result = await reportSick({
    challenge,
    participationId: participation.id,
    reportedAt: new Date(),
  });

  if (result.valid) {
    await ctx.reply(
      `🤒 Принято. Болезнь на ${dayjs(result.day).format('DD.MM.YYYY')} зафиксирована — штрафа не будет. Выздоравливай!`,
    );
  } else {
    await ctx.reply(
      `⚠️ Заявка принята, но уже позже ${challenge.sickDeadline}. По правилам это не освобождает от штрафа — решение за администратором.`,
    );
  }
}

async function safeEdit(
  ctx: Context,
  text: string,
  keyboard: ReturnType<typeof moderationKeyboard>,
): Promise<void> {
  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  } catch {
    // сообщение могло устареть/совпасть — игнорируем
  }
}
