import { createServer, type IncomingMessage, type Server } from 'node:http';
import { createHmac } from 'node:crypto';

const HEADERS = { 'X-Dev-Telegram-Id': '999', 'Content-Type': 'application/json' };

const BASE = 'http://127.0.0.1:3001';
const WHOOP_STUB_PORT = 3002;
const OFF_STUB_PORT = 3003;
const WHOOP_SECRET = 'smoke-whoop-secret';

// Конфиг читает env при загрузке модуля, поэтому переменные задаются до импорта сервера
// (он ниже — динамический). WHOOP смотрит в локальную заглушку, а не в настоящий API.
Object.assign(process.env, {
  WEBAPP_URL: BASE,
  WHOOP_CLIENT_ID: 'smoke-whoop-client',
  WHOOP_CLIENT_SECRET: WHOOP_SECRET,
  WHOOP_API_BASE: `http://127.0.0.1:${WHOOP_STUB_PORT}`,
  TOKEN_ENC_KEY: 'smoke-token-enc-key',
  OFF_API_BASE: `http://127.0.0.1:${OFF_STUB_PORT}`,
});

async function jget(url: string) {
  return (await fetch(url, { headers: HEADERS })).json() as Promise<any>;
}
async function jpost(url: string, body: unknown) {
  return (await fetch(url, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) })).json() as Promise<any>;
}

async function main() {
  const { buildServer } = await import('../src/api/server');
  const app = await buildServer();
  await app.listen({ host: '127.0.0.1', port: 3001 });
  const base = BASE;

  const ch = await jget(`${base}/api/challenge`);
  console.log('challenge:', ch.title, '| bank=', ch.bank, '| day=', ch.dayNumber, '| min=', ch.minDurationSec);

  // Участие теперь всегда явное: ни /start, ни открытие приложения в челлендж не записывают
  await jpost(`${base}/api/challenges/${ch.id}/join`, {});

  const me = await jget(`${base}/api/me`);
  console.log('me:', me.user?.name, '| isAdmin=', me.isAdmin, '| streak=', JSON.stringify(me.streak), '| today=', me.todayState);

  const lb = await jget(`${base}/api/leaderboard`);
  console.log('leaderboard rows:', lb.rows.length);

  const adm = await jget(`${base}/api/admin/challenge`);
  console.log('admin challenge: fineAmount=', adm.fineAmount, '| chatId=', adm.chatId);

  const setb = await jpost(`${base}/api/admin/bank/set`, { value: 1500 });
  console.log('bank set ->', setb.bank);

  await jpost(`${base}/api/admin/quotes`, { text: 'Тестовая речь из smoke' });
  const q = await jget(`${base}/api/admin/quotes`);
  console.log('quotes count:', q.quotes.length);

  const today = new Date().toISOString().slice(0, 10);
  const ppl = await jget(`${base}/api/admin/participants`);
  const pid = ppl.rows[0]?.participationId;
  console.log('participants:', ppl.rows.length, '| pid=', pid);

  await jpost(`${base}/api/admin/day-override`, { participationId: pid, day: today, action: 'done' });
  const me2 = await jget(`${base}/api/me`);
  console.log('after override -> today=', me2.todayState, '| done=', me2.totals.done, '| streak=', me2.streak.current);

  const rep = await jpost(`${base}/api/admin/report`, { day: today });
  console.log('report: sent=', rep.sent, '| contentLen=', (rep.content ?? '').length);

  // проверка штрафа: пометим вчера как пропуск и проверим банк/штрафы
  const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await jpost(`${base}/api/admin/day-override`, { participationId: pid, day: y, action: 'missed' });
  const me3 = await jget(`${base}/api/me`);
  console.log('after missed yesterday -> finesTotal=', me3.totals.finesTotal, '| missed=', me3.totals.missed);

  // --- группа взвешиваний: отдельный челлендж, механика планки в нём выключена ---
  const my0 = await jget(`${base}/api/my/challenges`);
  const weightChallenge =
    my0.challenges.find((c: any) => c.kind === 'weight') ??
    my0.available?.find((c: any) => c.kind === 'weight');
  if (weightChallenge) {
    await jpost(`${base}/api/challenges/${weightChallenge.id}/join`, {});
    const plankRoute = await fetch(`${base}/api/challenges/${weightChallenge.id}/me`, {
      headers: HEADERS,
    });
    const my1 = await jget(`${base}/api/my/challenges`);
    const joined = my1.challenges.find((c: any) => c.id === weightChallenge.id);
    console.log(
      'вес-челлендж:', weightChallenge.title,
      '| вступил=', Boolean(joined),
      '| планочный роут ->', plankRoute.status, '(ожидаем 400)',
    );
  } else {
    console.log('вес-челлендж: не найден, выполните npm run prisma:seed');
  }

  // --- умные весы: вебхук openScale ---
  const w0 = await jget(`${base}/api/weight`);
  const scaleToken: string = w0.connection.token;
  // дата «два дня назад»: старое измерение не дёргает отправку в ЛС
  const measuredAt = new Date(Date.now() - 2 * 86400000).toISOString();
  const scaleHeaders = { Authorization: `Bearer ${scaleToken}`, 'Content-Type': 'application/json' };
  const scalePost = async (body: unknown) => {
    const res = await fetch(`${base}/api/ingest/openscale`, {
      method: 'POST',
      headers: scaleHeaders,
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  };

  const ins = await scalePost({
    event: 'insert',
    id: 1,
    userId: 1,
    username: 'Smoke',
    date: measuredAt,
    weight: 78.4,
    body_fat: 18.2,
    water: 55.1,
    muscle: 42,
  });
  // то же взвешивание второй раз — должно обновиться, а не задвоиться
  const again = await scalePost({ event: 'update', id: 1, userId: 1, date: measuredAt, weight: 78.6 });
  const w1 = await jget(`${base}/api/weight`);
  console.log(
    'scale: создано=', ins.body.created,
    '| повтор обновил=', again.body.updated,
    '| вес=', w1.latest?.weightKg,
    '| записей=', w1.stats.count,
  );

  // второй человек на тех же весах: openScale шлёт его под своим userId
  const measuredAt2 = new Date(Date.now() - 2 * 86400000 + 600000).toISOString();
  await scalePost({
    event: 'insert',
    id: 2,
    userId: 2,
    username: 'Смоук-второй',
    date: measuredAt2,
    weight: 63.4,
    body_fat: 24.1,
  });
  const w15 = await jget(`${base}/api/weight`);
  const myUserId: number | undefined = w15.profiles[0]?.targetUserId;
  console.log(
    'scale: профилей на телефоне=', w15.profiles.length,
    '| записей у владельца=', w15.stats.count,
    '| кандидатов=', w15.candidates.length,
  );

  const second = w15.profiles.find((p: any) => p.scaleUserId === 2);
  const other = w15.candidates.find((c: any) => c.userId !== myUserId);
  if (second && other) {
    const res = await fetch(`${base}/api/weight/profiles/${second.id}`, {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify({ targetUserId: other.userId }),
    });
    const assigned = (await res.json()) as any;
    console.log(
      'scale: профиль отдан участнику', other.name,
      '| переехало записей=', assigned.moved,
      '| осталось у владельца=', assigned.stats.count,
    );
  } else {
    console.log('scale: отдать профиль некому — в челлендже один участник');
  }

  const foreign = await fetch(`${base}/api/ingest/openscale`, {
    method: 'POST',
    // только ASCII: fetch в Node отвергает кириллицу в значении заголовка ещё до отправки
    headers: { Authorization: 'Bearer no-such-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'test' }),
  });
  console.log('scale: чужой токен ->', foreign.status, '(ожидаем 401)');

  const cleared = await scalePost({ event: 'clear', userId: 1 });
  const del = await scalePost({ event: 'delete', userId: 1, date: measuredAt });
  const w2 = await jget(`${base}/api/weight`);
  console.log(
    'scale: clear проигнорирован=', cleared.body.ignored === 'clear',
    '| удалено=', del.body.deleted,
    '| осталось записей=', w2.stats.count,
  );

  await fitnessScenario(base);
  await gameScenario(base);
  await whoopScenario(base);
  await hubsScenario(base);
  await foodScenario(base);

  await app.close();
  console.log('SMOKE OK');
}

/** В отличие от разделов выше, здесь расхождение роняет прогон, а не теряется в выводе. */
function expect(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? '✓' : '✗'} ${label}:`, actual, ok ? '' : `(ожидали ${JSON.stringify(expected)})`);
  if (!ok) throw new Error(`fitness: ${label}`);
}

async function call(method: string, url: string, body?: unknown, headers = HEADERS) {
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

/**
 * День со сдвигом от сегодня в поясе челленджа (Europe/Moscow, UTC+3 без перевода часов).
 * По UTC считать нельзя: с 21:00 до полуночи UTC в Москве уже завтра, и «день 11» стал бы двенадцатым.
 */
function mskDay(offset: number): string {
  return new Date(Date.now() + 3 * 3600_000 + offset * 86400_000).toISOString().slice(0, 10);
}

/** Фитнес-челлендж: создание админом, вступление, анкета, цель, ручной вес, обхваты. */
async function fitnessScenario(base: string) {
  console.log('--- фитнес-челлендж ---');
  const day = mskDay;
  const admin = `${base}/api/admin/challenges`;

  // Ручные замеры прошлого прогона мешают повторному: стартовая точка цели создаётся,
  // только если за сутки взвешиваний не было. Записи с весов (sourceOwnerId задан) не трогаем.
  const { prisma } = await import('../src/lib/prisma');
  const cleanManual = () =>
    prisma.weightEntry.deleteMany({ where: { user: { telegramId: 999n }, sourceOwnerId: null } });
  await cleanManual();

  const bad = await call('POST', admin, { title: 'Smoke', startDate: day(-10), lives: 0 });
  expect('жизни вне диапазона -> 400', [bad.status, bad.body?.error], [400, 'bad_lives']);

  const created = await call('POST', admin, {
    title: 'Smoke 100 дней',
    startDate: day(-10),
    durationDays: 100,
    weeklyWorkouts: 3,
    lives: 3,
  });
  const id: number = created.body.id;
  try {
    expect('создан', [created.status, created.body.kind], [200, 'fitness']);
    expect('сроки', [created.body.dayNumber, created.body.daysTotal, created.body.endDate], [11, 100, day(89)]);

    const my0 = await jget(`${base}/api/my/challenges`);
    expect('виден в «Ещё доступно»', my0.available.some((c: any) => c.id === id), true);

    expect('вступление', (await call('POST', `${base}/api/challenges/${id}/join`, {})).status, 200);
    for (const route of ['me', 'leaderboard', 'freezes']) {
      expect(`планочный ${route} -> 400`, (await call('GET', `${base}/api/challenges/${id}/${route}`)).status, 400);
    }
    expect('больничный -> 400', (await call('POST', `${base}/api/challenges/${id}/sick`, {})).status, 400);

    const ov = await call('GET', `${base}/api/challenges/${id}/fitness`);
    expect('сводка', [ov.status, ov.body.goal, ov.body.challenge.weekNumber, ov.body.challenge.weeksTotal], [200, null, 2, 15]);
    expect('настройки', [ov.body.settings.weeklyWorkouts, ov.body.settings.lives], [3, 3]);

    // анкета
    const badHeight = await call('PUT', `${base}/api/body-profile`, { heightCm: 20 });
    expect('рост вне диапазона -> 400', [badHeight.status, badHeight.body?.error], [400, 'bad_height']);
    const profile = await call('PUT', `${base}/api/body-profile`, { heightCm: 180, birthYear: 1990, sex: 'male' });
    expect('анкета', [profile.body.heightCm, profile.body.sex, profile.body.activityFactor], [180, 'male', 1.2]);
    const partial = await call('PUT', `${base}/api/body-profile`, { shareBody: true });
    expect('частичная правка не стирает рост', [partial.body.heightCm, partial.body.shareBody], [180, true]);

    // цель
    const goalUrl = `${base}/api/challenges/${id}/goal`;
    const wrongWay = await call('PUT', goalUrl, { goalType: 'lose_weight', startWeightKg: 90, targetValue: 95 });
    expect('цель не в ту сторону -> 400', [wrongWay.status, wrongWay.body?.error], [400, 'target_direction']);
    const noStart = await call('PUT', goalUrl, { goalType: 'lose_fat', targetValue: 15 });
    expect('цель без стартового замера -> 400', [noStart.status, noStart.body?.error], [400, 'bad_start']);
    const goal = await call('PUT', goalUrl, {
      goalType: 'lose_weight', startWeightKg: 90, startBodyFat: 24, targetValue: 80, dailyKcalTarget: 2200,
    });
    expect('цель сохранена', [goal.status, goal.body.goal.goalType, goal.body.goal.startDay], [200, 'lose_weight', day(0)]);
    expect('точка отсчёта', [goal.body.progress.metric, goal.body.progress.start, goal.body.progress.target], ['weightKg', 90, 80]);
    const regoal = await call('PUT', goalUrl, { goalType: 'lose_weight', startWeightKg: 90, targetValue: 78 });
    expect('правка цели не сдвигает день старта', [regoal.body.goal.targetValue, regoal.body.goal.startDay], [78, day(0)]);

    const my1 = await jget(`${base}/api/my/challenges`);
    const card = my1.challenges.find((c: any) => c.id === id);
    expect('карточка в «Моих»', [card.fitness.daysTotal, card.fitness.hasGoal, 'todayState' in card], [100, true, false]);

    // первая цель кладёт стартовый замер в историю веса — первой точкой графика
    const w0 = await jget(`${base}/api/weight`);
    expect('стартовый замер в истории', [w0.latest.weightKg, w0.latest.bodyFat], [90, 24]);

    // ручной вес: повтор на тот же момент обновляет запись, а не задваивает.
    // Минута вперёд — чтобы замер был новее стартового (запас на расхождение часов допустим)
    const measuredAt = new Date(Date.now() + 60_000).toISOString();
    const w1 = await call('POST', `${base}/api/weight`, { weightKg: 88.4, bodyFat: 23.5, measuredAt });
    const w2 = await call('POST', `${base}/api/weight`, { weightKg: 88.1, bodyFat: 23.5, measuredAt });
    expect('ручной вес', [w1.status, w2.body.latest.weightKg, w2.body.latest.bodyFat], [200, 88.1, 23.5]);
    expect('повтор не задвоил', w2.body.stats.count, w1.body.stats.count);
    const badWeight = await call('POST', `${base}/api/weight`, { weightKg: 900 });
    expect('вес вне диапазона -> 400', [badWeight.status, badWeight.body?.error], [400, 'bad_weight']);

    // обхваты: одно значение вида на день
    await call('PUT', `${base}/api/measurements`, { kind: 'waist', value: 92.4 });
    const m2 = await call('PUT', `${base}/api/measurements`, { kind: 'waist', value: 91 });
    const waist = m2.body.rows.filter((r: any) => r.kind === 'waist' && r.day === day(0));
    expect('обхват за день один, значение исправлено', [waist.length, waist[0]?.value], [1, 91]);
    const badKind = await call('PUT', `${base}/api/measurements`, { kind: 'ear', value: 5 });
    expect('неизвестный вид замера -> 400', [badKind.status, badKind.body?.error], [400, 'bad_kind']);
    const future = await call('PUT', `${base}/api/measurements`, { kind: 'waist', value: 90, day: day(3) });
    expect('замер из будущего -> 400', [future.status, future.body?.error], [400, 'bad_day']);
    const delM = await call('DELETE', `${base}/api/measurements/${waist[0].id}`);
    expect('обхват удалён', delM.body.rows.some((r: any) => r.id === waist[0].id), false);

    // админка
    const ppl = await call('GET', `${admin}/${id}/participants`);
    expect('участники', [ppl.body.rows.length, ppl.body.rows[0].goalType, ppl.body.rows[0].progress.target], [1, 'lose_weight', 78]);
    const patched = await call('PATCH', `${admin}/${id}`, { lives: 2, joinOpen: false, durationDays: '' });
    expect('правка настроек', [patched.body.lives, patched.body.joinOpen, patched.body.daysTotal], [2, false, null]);
    expect('планка отсюда не правится', (await call('PATCH', `${admin}/1`, { lives: 2 })).status, 400);

    // закрытый набор: второй человек челлендж не видит и вступить не может
    const other = { ...HEADERS, 'X-Dev-Telegram-Id': '998' };
    const otherList = await call('GET', `${base}/api/my/challenges`, undefined, other);
    expect('закрытый набор скрыт', otherList.body.available.some((c: any) => c.id === id), false);
    const otherJoin = await call('POST', `${base}/api/challenges/${id}/join`, {}, other);
    expect('вступление закрыто -> 403', [otherJoin.status, otherJoin.body?.error], [403, 'join_closed']);
    expect('чужая сводка -> 403', (await call('GET', `${base}/api/challenges/${id}/fitness`, undefined, other)).status, 403);
  } finally {
    // прогон не должен оставлять после себя челленджи: каскад уносит участия и цели
    await prisma.challenge.delete({ where: { id } }).catch(() => undefined);
    await cleanManual();
  }
}

/** Игра: ручные тренировки, зачёт недели, жизни, выбывание, действия админа, дубли, рейтинг. */
async function gameScenario(base: string) {
  console.log('--- игра: тренировки, недели, жизни ---');
  const { prisma } = await import('../src/lib/prisma');
  const { randomUUID } = await import('node:crypto');
  const admin = `${base}/api/admin/challenges`;
  /** Полдень по Москве в день со сдвигом: тренировка заведомо внутри этого дня челленджа. */
  const noon = (offset: number, minutes = 0) =>
    new Date(new Date(`${mskDay(offset)}T09:00:00.000Z`).getTime() + minutes * 60_000).toISOString();

  const cleanWorkouts = () => prisma.workout.deleteMany({ where: { user: { telegramId: 999n } } });
  await cleanWorkouts();

  // Старт 17 дней назад: неделя 1 = дни −17…−11, неделя 2 = −10…−4, неделя 3 (идёт) = −3…+3
  const created = await call('POST', admin, {
    title: 'Smoke игра', startDate: mskDay(-17), durationDays: 100, weeklyWorkouts: 3, lives: 2, minWorkoutMin: 20,
  });
  const id: number = created.body.id;
  try {
    await call('POST', `${base}/api/challenges/${id}/join`, {});
    // Вступивший сегодня отвечал бы только за остаток текущей недели — сдвигаем вступление в прошлое
    await prisma.participation.updateMany({
      where: { challengeId: id },
      data: { joinedAt: new Date(`${mskDay(-18)}T09:00:00.000Z`) },
    });

    const add = (startedAt: string, durationMin: number, extra: Record<string, unknown> = {}) =>
      call('POST', `${base}/api/workouts`, {
        clientId: randomUUID(), sport: 'strength', startedAt, durationMin, ...extra,
      });

    // валидация
    expect('нулевая длительность -> 400', (await add(noon(-1), 0)).body?.error, 'bad_workout_duration');
    expect('неизвестный вид -> 400', (await add(noon(-1), 30, { sport: 'chess' })).body?.error, 'bad_sport');
    expect('тренировка из будущего -> 400', (await add(noon(3), 30)).body?.error, 'bad_started_at');
    expect('без clientId -> 400', (await add(noon(-1), 30, { clientId: '' })).body?.error, 'bad_client_id');

    // неделя 1: норма закрыта; плюс вторая за день (лимит) и короткая
    for (const d of [-17, -16, -15]) await add(noon(d), 30, { kcal: 300 });
    await add(noon(-15, 300), 40);
    await add(noon(-14), 10);
    // неделя 2: одна из трёх — провал
    await add(noon(-9), 30);
    // неделя 3 (текущая)
    const clientId = randomUUID();
    const run = { clientId, sport: 'run', startedAt: noon(-1), durationMin: 45, kcal: 520 };
    const cur = await call('POST', `${base}/api/workouts`, run);
    const again = await call('POST', `${base}/api/workouts`, run);
    expect('повтор с тем же clientId — та же запись', again.body.id, cur.body.id);

    const journalUrl = `${base}/api/challenges/${id}/fitness/workouts`;
    const journal = async () => (await jget(journalUrl)).workouts as any[];
    const verdictCounts = async () => {
      const counts: Record<string, number> = {};
      for (const w of await journal()) counts[w.verdict] = (counts[w.verdict] ?? 0) + 1;
      return [counts.counted ?? 0, counts.too_short ?? 0, counts.day_limit ?? 0];
    };
    expect('вердикты журнала: в зачёте / короткая / лимит дня', await verdictCounts(), [5, 1, 1]);

    // итоги недель
    const ev1 = await call('POST', `${admin}/${id}/evaluate`, {});
    expect('закрыто недель', ev1.body.created, 2);
    expect('повторная оценка идемпотентна', (await call('POST', `${admin}/${id}/evaluate`, {})).body.created, 0);

    const game = async () => (await jget(`${base}/api/challenges/${id}/fitness`)).game;
    const brief = (g: any) => [
      g.lives.left,
      g.lives.eliminated,
      g.history.map((w: any) => `${w.weekNumber}:${w.status}:${w.done}/${w.required}`),
    ];
    let g = await game();
    expect('жизни после двух недель', brief(g), [1, false, ['2:failed:1/3', '1:passed:3/3']]);
    expect(
      'текущая неделя',
      [g.currentWeek.weekNumber, g.currentWeek.done, g.currentWeek.required, g.totalCounted],
      [3, 1, 3, 5],
    );
    expect('полоска недели — 7 дней', g.currentWeek.days.length, 7);

    const failed = g.history.find((w: any) => w.status === 'failed');
    const passedWeek = g.history.find((w: any) => w.status === 'passed');

    // прощение возвращает жизнь, отмена — забирает
    await call('POST', `${admin}/${id}/weeks/${failed.id}/forgive`, { note: 'болел' });
    g = await game();
    expect(
      'прощённая неделя жизнь не снимает',
      [g.lives.left, g.history[0].status, g.history[0].forgivenNote],
      [2, 'forgiven', 'болел'],
    );
    await call('POST', `${admin}/${id}/weeks/${failed.id}/unforgive`, {});
    expect('отмена прощения', (await game()).lives.left, 1);

    // выбывание: доступ к своим данным остаётся
    await call('PATCH', `${admin}/${id}`, { lives: 1 });
    g = await game();
    expect('выбыл на неделе 2', [g.lives.left, g.lives.eliminated, g.lives.eliminatedAtWeekNumber], [0, true, 2]);
    expect('выбывший может вести тренировки', (await add(noon(-2), 25)).status, 200);
    const board0 = await jget(`${base}/api/challenges/${id}/fitness/leaderboard`);
    expect('в рейтинге отмечен выбывшим', [board0.rows.length, board0.rows[0].eliminated], [1, true]);
    const my = await jget(`${base}/api/my/challenges`);
    expect('остаётся в «Моих»', my.challenges.find((c: any) => c.id === id)?.fitness.eliminated, true);

    const pid = (await jget(`${admin}/${id}/participants`)).rows[0].participationId;
    const back = await call('POST', `${admin}/${id}/participants/${pid}/reinstate`, {});
    expect('возврат прощает неделю выбывания', back.body.forgivenWeekNumbers, [2]);
    expect('снова в игре', (await game()).lives.eliminated, false);
    await call('POST', `${admin}/${id}/weeks/${failed.id}/unforgive`, {});
    await call('PATCH', `${admin}/${id}`, { lives: 2 });

    // правка задним числом снимок не меняет — только осознанный пересчёт админа
    await add(noon(-8), 30);
    await add(noon(-7), 30);
    await call('POST', `${admin}/${id}/evaluate`, {});
    expect('снимок недели не переписан', (await game()).history[0].done, 1);
    const recalc = await call('POST', `${admin}/${id}/weeks/${failed.id}/recalc`, {});
    expect('пересчёт админом', [recalc.body.passed, recalc.body.done, (await game()).lives.left], [true, 3, 2]);

    // админ снимает тренировку с зачёта
    const firstWeekWorkout = (await journal()).find((w: any) => w.startedAt === noon(-17));
    await call('PATCH', `${admin}/${id}/workouts/${firstWeekWorkout.id}`, { excluded: true, note: 'не тренировка' });
    const recalc1 = await call('POST', `${admin}/${id}/weeks/${passedWeek.id}/recalc`, {});
    expect('снятая тренировка роняет неделю', [recalc1.body.passed, recalc1.body.done], [false, 2]);
    await call('PATCH', `${admin}/${id}/workouts/${firstWeekWorkout.id}`, { excluded: false });
    await call('POST', `${admin}/${id}/weeks/${passedWeek.id}/recalc`, {});
    expect('возврат в зачёт', (await game()).lives.left, 2);

    // дубли: та же тренировка с браслета главнее ручной; после удаления основной дубль возвращается
    const me = await prisma.user.findUniqueOrThrow({ where: { telegramId: 999n } });
    const whoop = await prisma.workout.create({
      data: {
        userId: me.id,
        source: 'whoop',
        externalId: randomUUID(),
        sport: 'run',
        startedAt: new Date(noon(0)),
        durationSec: 3600,
        kcal: 640,
      },
    });
    const manualDup = await add(noon(0, 10), 40, { sport: 'run' });
    const verdictOf = async (workoutId: number) => (await journal()).find((w: any) => w.id === workoutId)?.verdict;
    expect(
      'ручная запись поверх браслета — дубль',
      [await verdictOf(manualDup.body.id), await verdictOf(whoop.id)],
      ['duplicate', 'counted'],
    );
    const feed = (await jget(`${base}/api/challenges/${id}/fitness/leaderboard`)).feed as any[];
    expect('дубль не попадает в общую ленту', feed.some((w: any) => w.id === manualDup.body.id), false);

    expect('удаление', (await call('DELETE', `${base}/api/workouts/${whoop.id}`)).status, 200);
    expect(
      'после удаления основной дубль снова в зачёте',
      [await verdictOf(whoop.id), await verdictOf(manualDup.body.id)],
      [undefined, 'counted'],
    );
    const tomb = await prisma.workout.findUniqueOrThrow({ where: { id: whoop.id } });
    expect('удалённая осталась тумбстоуном', tomb.deletedAt !== null, true);

    // чужие тренировки недоступны
    const other = { ...HEADERS, 'X-Dev-Telegram-Id': '998' };
    const foreignDelete = await call('DELETE', `${base}/api/workouts/${cur.body.id}`, undefined, other);
    expect('чужую тренировку не удалить', foreignDelete.status, 404);
    const foreignPatch = await call(
      'PATCH',
      `${base}/api/workouts/${cur.body.id}`,
      { sport: 'run', startedAt: noon(-1), durationMin: 5 },
      other,
    );
    expect('чужую тренировку не править', foreignPatch.status, 404);

    const weeks = await jget(`${admin}/${id}/weeks`);
    expect('админ видит недели', weeks.weeks.map((w: any) => [w.weekNumber, w.rows.length]), [[2, 1], [1, 1]]);
  } finally {
    await prisma.challenge.delete({ where: { id } }).catch(() => undefined);
    await cleanWorkouts();
  }
}

/** Ждёт, пока условие станет истинным: обработка вебхука и бэкфилл идут в фоне. */
async function until<T>(what: string, probe: () => Promise<T | undefined | null | false>, timeoutMs = 8000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`whoop: не дождались — ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

/**
 * Заглушка WHOOP API: токены с ротацией refresh token (старый после использования мёртв —
 * как у настоящего), профиль, постраничный список тренировок и тренировка по id.
 */
function startWhoopStub() {
  const state = {
    /** refresh token → access token: у каждого подключения своя пара. */
    sessions: new Map<string, string>(),
    issued: 0,
    refreshCalls: 0,
    revoked: false,
    workouts: new Map<string, Record<string, unknown>>(),
  };
  const issue = () => {
    state.issued += 1;
    const pair = { access: `stub-access-${state.issued}`, refresh: `stub-refresh-${state.issued}` };
    state.sessions.set(pair.refresh, pair.access);
    return { access_token: pair.access, refresh_token: pair.refresh, expires_in: 3600, scope: 'offline' };
  };
  const json = (res: import('node:http').ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://stub');
    if (url.pathname === '/oauth/oauth2/token') {
      const form = new URLSearchParams(await readBody(req));
      if (form.get('client_secret') !== WHOOP_SECRET) return json(res, 401, { error: 'invalid_client' });
      if (form.get('grant_type') === 'authorization_code') {
        return form.get('code') === 'good-code' ? json(res, 200, issue()) : json(res, 400, { error: 'invalid_grant' });
      }
      state.refreshCalls += 1;
      // небольшая задержка: без неё параллельные обновления не успели бы пересечься
      await new Promise((r) => setTimeout(r, 150));
      // использованный refresh token мёртв вместе со своим access token
      if (!state.sessions.delete(form.get('refresh_token') ?? '')) return json(res, 400, { error: 'invalid_grant' });
      return json(res, 200, issue());
    }

    const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (![...state.sessions.values()].includes(bearer)) return json(res, 401, { error: 'unauthorized' });
    if (url.pathname === '/developer/v2/user/profile/basic') return json(res, 200, { user_id: 9012 });
    if (url.pathname === '/developer/v2/user/access' && req.method === 'DELETE') {
      state.revoked = true;
      res.writeHead(204);
      return res.end();
    }
    if (url.pathname === '/developer/v2/activity/workout') {
      const since = new Date(url.searchParams.get('start') ?? 0).getTime();
      const all = [...state.workouts.values()].filter((w) => new Date(String(w.start)).getTime() >= since);
      // по две записи на страницу — чтобы проверить пагинацию
      const offset = Number(url.searchParams.get('nextToken') ?? 0);
      const records = all.slice(offset, offset + 2);
      return json(res, 200, { records, next_token: offset + 2 < all.length ? String(offset + 2) : null });
    }
    const one = /^\/developer\/v2\/activity\/workout\/(.+)$/.exec(url.pathname);
    if (one) {
      const w = state.workouts.get(decodeURIComponent(one[1]!));
      return w ? json(res, 200, w) : json(res, 404, { error: 'not_found' });
    }
    return json(res, 404, { error: 'not_found' });
  });

  return new Promise<{ state: typeof state; close: () => Promise<void> }>((resolve) => {
    server.listen(WHOOP_STUB_PORT, '127.0.0.1', () =>
      resolve({ state, close: () => new Promise<void>((done) => server.close(() => done())) }),
    );
  });
}

/** WHOOP: OAuth, выгрузка истории, вебхуки с подписью, ротация токена, тумбстоуны, возврат жизни. */
async function whoopScenario(base: string) {
  console.log('--- WHOOP (через локальную заглушку API) ---');
  const { prisma } = await import('../src/lib/prisma');
  const { reconcileWhoop } = await import('../src/services/whoop');
  const admin = `${base}/api/admin/challenges`;
  const stub = await startWhoopStub();

  const noon = (offset: number, minutes = 0) =>
    new Date(new Date(`${mskDay(offset)}T09:00:00.000Z`).getTime() + minutes * 60_000).toISOString();
  const whoopWorkout = (id: string, offset: number, minutes = 50) => ({
    id,
    user_id: 9012,
    start: noon(offset),
    end: noon(offset, minutes),
    timezone_offset: '+03:00',
    sport_name: 'running',
    score_state: 'SCORED',
    score: { strain: 9.1, average_heart_rate: 140, max_heart_rate: 171, kilojoule: 2092, distance_meter: 8000 },
  });
  const webhook = (body: Record<string, unknown>, opts: { secret?: string; timestamp?: string } = {}) => {
    const raw = JSON.stringify(body);
    const timestamp = opts.timestamp ?? String(Date.now());
    const signature = createHmac('sha256', opts.secret ?? WHOOP_SECRET).update(timestamp).update(raw).digest('base64');
    return fetch(`${base}/api/webhooks/whoop`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-WHOOP-Signature': signature,
        'X-WHOOP-Signature-Timestamp': timestamp,
      },
      body: raw,
    });
  };

  const clean = async () => {
    await prisma.integration.deleteMany({ where: { user: { telegramId: { in: [999n, 998n] } } } });
    await prisma.workout.deleteMany({ where: { user: { telegramId: 999n } } });
  };
  await clean();

  // Челлендж с двумя уже проваленными неделями: на нём проверим возврат жизни
  const created = await call('POST', admin, {
    title: 'Smoke WHOOP', startDate: mskDay(-17), durationDays: 100, weeklyWorkouts: 3, lives: 3,
  });
  const id: number = created.body.id;
  try {
    await call('POST', `${base}/api/challenges/${id}/join`, {});
    await prisma.participation.updateMany({
      where: { challengeId: id },
      data: { joinedAt: new Date(`${mskDay(-18)}T09:00:00.000Z`) },
    });
    await call('POST', `${admin}/${id}/evaluate`, {});
    const game = async () => (await jget(`${base}/api/challenges/${id}/fitness`)).game;
    expect('до WHOOP: две недели провалены', (await game()).lives.left, 1);

    // --- подключение ---
    const list0 = await jget(`${base}/api/integrations`);
    expect('WHOOP доступен, но не подключён', [list0.available.whoop, list0.connected.length], [true, 0]);

    const connect = await call('POST', `${base}/api/integrations/whoop/connect`);
    const authUrl = new URL(connect.body.url);
    const state = authUrl.searchParams.get('state')!;
    expect(
      'ссылка согласия',
      [authUrl.pathname, authUrl.searchParams.get('redirect_uri'), authUrl.searchParams.get('scope'), state.length >= 8],
      ['/oauth/oauth2/auth', `${base}/api/oauth/whoop/callback`, 'offline read:workout read:profile', true],
    );

    const callback = (query: string) => fetch(`${base}/api/oauth/whoop/callback?${query}`);
    expect('подделанный state -> 400', (await callback(`code=good-code&state=${state.slice(0, -2)}xx`)).status, 400);
    expect('отказ пользователя -> 400', (await callback('error=access_denied')).status, 400);
    expect('плохой code -> 400', (await callback(`code=bad&state=${state}`)).status, 400);

    // три тренировки истории во второй неделе челленджа (дни −10…−4): две страницы по две записи
    for (const [wid, d] of [['w-1', -10], ['w-2', -9], ['w-3', -8]] as const) {
      stub.state.workouts.set(wid, whoopWorkout(wid, d));
    }
    const ok = await callback(`code=good-code&state=${state}`);
    expect('callback', [ok.status, (await ok.text()).includes('WHOOP подключён')], [200, true]);

    const journalUrl = `${base}/api/challenges/${id}/fitness/workouts`;
    const whoopIds = async () =>
      ((await jget(journalUrl)).workouts as any[]).filter((w) => w.source === 'whoop').map((w) => w.id);
    await until('выгрузка истории', async () => (await whoopIds()).length === 3);
    const first = ((await jget(journalUrl)).workouts as any[]).find((w) => w.source === 'whoop');
    expect('тренировка с браслета', [first.sport, first.durationMin, first.kcal, first.verdict], ['run', 50, 500, 'counted']);

    const stored = await prisma.integration.findFirstOrThrow({ where: { user: { telegramId: 999n } } });
    expect(
      'токены в базе зашифрованы',
      [stored.accessTokenEnc?.startsWith('v1.'), stored.accessTokenEnc?.includes('stub-access'), stored.externalUserId],
      [true, false, '9012'],
    );

    // опоздавшая синхронизация закрыла норму уже оценённой недели — жизнь возвращается сама
    const g = await until('возврат жизни', async () => {
      const state = await game();
      return state.lives.left === 2 ? state : null;
    });
    const week2 = g.history.find((w: any) => w.weekNumber === 2);
    expect('неделя исправлена синхронизацией', [week2.status, week2.done, week2.upgraded], ['passed', 3, true]);

    // --- вебхуки ---
    stub.state.workouts.set('w-new', whoopWorkout('w-new', -1));
    const event = { user_id: 9012, id: 'w-new', type: 'workout.updated', trace_id: 'trace-1' };
    expect('чужая подпись -> 401', (await webhook(event, { secret: 'wrong' })).status, 401);
    expect('протухшая метка времени -> 401', (await webhook(event, { timestamp: String(Date.now() - 3 * 3600_000) })).status, 401);
    expect('вебхук принят', (await webhook(event)).status, 204);
    await until('тренировка из вебхука', async () => (await whoopIds()).length === 4);
    expect('сон и восстановление игнорируются', (await webhook({ user_id: 9012, id: 's-1', type: 'sleep.updated' })).status, 204);
    expect('повтор вебхука не задваивает', [(await webhook(event)).status, (await whoopIds()).length], [204, 4]);

    // --- ротация токена: три одновременных события на протухшем токене — одно обновление ---
    await prisma.integration.update({ where: { id: stored.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const refreshesBefore = stub.state.refreshCalls;
    await Promise.all([webhook(event), webhook(event), webhook(event)]);
    await until('обновление токена', async () => stub.state.refreshCalls > refreshesBefore);
    await new Promise((r) => setTimeout(r, 600));
    const after = await prisma.integration.findUniqueOrThrow({ where: { id: stored.id } });
    expect(
      'refresh token обновлён один раз, интеграция жива',
      [stub.state.refreshCalls - refreshesBefore, after.status, after.expiresAt! > new Date()],
      [1, 'active', true],
    );

    // --- удаление ---
    const newId = ((await jget(journalUrl)).workouts as any[]).find((w) => w.startedAt === noon(-1)).id;
    expect('удаление своей тренировки', (await call('DELETE', `${base}/api/workouts/${newId}`)).status, 200);
    await reconcileWhoop();
    expect('сверка не воскрешает удалённую', (await whoopIds()).length, 3);

    stub.state.workouts.delete('w-3');
    await webhook({ user_id: 9012, id: 'w-3', type: 'workout.deleted', trace_id: 'trace-2' });
    await until('удаление из вебхука', async () => (await whoopIds()).length === 2);

    // --- один браслет — один человек ---
    const other = { ...HEADERS, 'X-Dev-Telegram-Id': '998' };
    const otherConnect = await call('POST', `${base}/api/integrations/whoop/connect`, undefined, other);
    const otherState = new URL(otherConnect.body.url).searchParams.get('state')!;
    const taken = await callback(`code=good-code&state=${otherState}`);
    expect('чужой браслет не подключить', [taken.status, (await taken.text()).includes('уже подключён')], [400, true]);

    // --- отключение: доступ отозван у WHOOP, тренировки остаются ---
    expect('отключение', (await call('DELETE', `${base}/api/integrations/whoop`)).status, 200);
    expect(
      'после отключения',
      [stub.state.revoked, (await jget(`${base}/api/integrations`)).connected.length, (await whoopIds()).length],
      [true, 0, 2],
    );
    expect('вебхук отключённого — без ошибки и без записи', (await webhook(event)).status, 204);
  } finally {
    await prisma.challenge.delete({ where: { id } }).catch(() => undefined);
    await clean();
    await stub.close();
  }
}

/** Телефонные хабы: Health Auto Export (iOS) и Health Connect Webhook (Android). */
async function hubsScenario(base: string) {
  console.log('--- хабы: Health Auto Export и Health Connect ---');
  const { prisma } = await import('../src/lib/prisma');
  const { randomUUID } = await import('node:crypto');
  const admin = `${base}/api/admin/challenges`;
  const clean = async () => {
    await prisma.integration.deleteMany({ where: { user: { telegramId: 999n } } });
    await prisma.workout.deleteMany({ where: { user: { telegramId: 999n } } });
  };
  await clean();

  const noon = (offset: number, minutes = 0) =>
    new Date(new Date(`${mskDay(offset)}T09:00:00.000Z`).getTime() + minutes * 60_000);
  /** Дата в формате Health Auto Export: "2024-02-06 12:00:00 +0300". */
  const haeDate = (d: Date) =>
    new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 19).replace('T', ' ') + ' +0300';
  const send = (path: string, token: string, body: unknown, header = 'Authorization') =>
    fetch(`${base}/api/ingest/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [header]: header === 'Authorization' ? `Bearer ${token}` : token },
      body: JSON.stringify(body),
    }).then(async (res) => ({ status: res.status, body: (await res.json().catch(() => null)) as any }));

  const created = await call('POST', admin, { title: 'Smoke хабы', startDate: mskDay(-5), durationDays: 100 });
  const id: number = created.body.id;
  try {
    await call('POST', `${base}/api/challenges/${id}/join`, {});
    await prisma.participation.updateMany({
      where: { challengeId: id },
      data: { joinedAt: new Date(`${mskDay(-6)}T09:00:00.000Z`) },
    });
    const journal = async () => (await jget(`${base}/api/challenges/${id}/fitness/workouts`)).workouts as any[];

    // --- подключение ---
    const list0 = await jget(`${base}/api/integrations`);
    expect(
      'хабы до подключения',
      list0.hubs.map((h: any) => [h.provider, h.token, h.url.replace(base, '')]),
      [['hae', null, '/api/ingest/health-auto-export'], ['health_connect', null, '/api/ingest/health-connect']],
    );
    expect('неизвестный хаб -> 400', (await call('POST', `${base}/api/integrations/hubs/fitbit`)).status, 400);

    const tokenOf = (res: any, provider: string): string => res.body.hubs.find((h: any) => h.provider === provider).token;
    const haeToken = tokenOf(await call('POST', `${base}/api/integrations/hubs/hae`), 'hae');
    expect('повторное подключение токен не меняет', tokenOf(await call('POST', `${base}/api/integrations/hubs/hae`), 'hae'), haeToken);
    const hcToken = tokenOf(await call('POST', `${base}/api/integrations/hubs/health_connect`), 'health_connect');

    // --- Health Auto Export ---
    const run = {
      id: randomUUID(), name: 'Running', start: haeDate(noon(-1)), end: haeDate(noon(-1, 40)), duration: 2400,
      activeEnergyBurned: { qty: 1673.6, units: 'kJ' }, distance: { qty: 3.5, units: 'mi' },
      heartRate: { avg: { qty: 151, units: 'bpm' }, max: { qty: 176, units: 'bpm' } },
    };
    // формат v1: без id, энергия в activeEnergy
    const gym = { name: 'Силовая тренировка', start: haeDate(noon(-2)), end: haeDate(noon(-2, 55)), activeEnergy: { qty: 380, units: 'kcal' } };
    const haeBody = { data: { workouts: [run, gym], metrics: [] } };

    const first = await send('health-auto-export', haeToken, haeBody);
    expect('первая выгрузка', [first.status, first.body.received, first.body.created], [200, 2, 2]);
    const again = await send('health-auto-export', haeToken, haeBody);
    expect('повторная выгрузка не задваивает', [again.body.created, again.body.updated, (await journal()).length], [0, 2, 2]);

    const runRow = (await journal()).find((w) => w.sportRaw === 'Running');
    expect(
      'тренировка с iPhone: кДж и мили пересчитаны',
      [runRow.source, runRow.sport, runRow.durationMin, runRow.kcal, runRow.distanceM, runRow.avgHr, runRow.verdict],
      ['hae', 'run', 40, 400, 5633, 151, 'counted'],
    );
    expect('название на языке телефона', (await journal()).find((w) => w.sportRaw === 'Силовая тренировка').sport, 'strength');

    // тяжёлая выгрузка: пульс по секундам раздувает тело запроса сверх стандартного мегабайта
    const heavy = { ...run, heartRateData: Array.from({ length: 40000 }, (_, i) => ({ date: run.start, Avg: 120 + (i % 40), units: 'bpm', source: 'Apple Watch' })) };
    const heavyBody = { data: { workouts: [heavy] } };
    const size = Buffer.byteLength(JSON.stringify(heavyBody));
    const big = await send('health-auto-export', haeToken, heavyBody);
    expect('запрос больше мегабайта принят', [size > 1024 * 1024, big.status, big.body.updated], [true, 200, 1]);

    expect('чужой токен -> 401', (await send('health-auto-export', 'no-such-token', haeBody)).status, 401);
    expect('токен Android не подходит к адресу iOS', (await send('health-auto-export', hcToken, haeBody)).status, 401);
    expect('чужой формат -> 400', (await send('health-auto-export', haeToken, { workouts: [] })).status, 400);
    expect('выгрузка без тренировок — не ошибка', (await send('health-auto-export', haeToken, { data: { metrics: [] } })).body.received, 0);
    expect('токен в X-Ingest-Token', (await send('health-auto-export', haeToken, haeBody, 'X-Ingest-Token')).status, 200);

    // --- Health Connect: та же пробежка с другого телефона-хаба и новая тренировка ---
    const hcBody = {
      timestamp: new Date().toISOString(),
      app_version: '1.2.3',
      exercise: [
        { type: 'EXERCISE_TYPE_RUNNING', start_time: noon(-1, 1).toISOString(), end_time: noon(-1, 40).toISOString(), duration_seconds: 2340 },
        { type: 'BIKING', start_time: noon(0).toISOString(), end_time: noon(0, 60).toISOString(), duration_seconds: 3600, distance_meters: 21500 },
      ],
      active_calories: [
        { calories: 200, start_time: noon(0, -30).toISOString(), end_time: noon(0, 30).toISOString() },
        { calories: 310, start_time: noon(0, 30).toISOString(), end_time: noon(0, 60).toISOString() },
      ],
      heart_rate: [{ bpm: 132, time: noon(0, 10).toISOString() }, { bpm: 148, time: noon(0, 50).toISOString() }],
    };
    const hc = await send('health-connect', hcToken, hcBody);
    expect('выгрузка с Android', [hc.status, hc.body.received, hc.body.created], [200, 2, 2]);
    const bike = (await journal()).find((w) => w.source === 'health_connect' && w.sport === 'cycling');
    expect(
      'калории и пульс собраны из соседних массивов',
      [bike.kcal, bike.avgHr, bike.distanceM, bike.verdict],
      [410, 140, 21500, 'counted'], // половина первой записи энергии + вторая целиком
    );
    const hcRun = (await journal()).find((w) => w.source === 'health_connect' && w.sport === 'run');
    expect('одна пробежка из двух хабов — один зачёт', hcRun.verdict, 'duplicate');
    expect('окно в 48 часов приходит повторно', (await send('health-connect', hcToken, hcBody)).body.created, 0);

    // --- ручная запись поверх автоматической — дубль ---
    const manual = await call('POST', `${base}/api/workouts`, {
      clientId: randomUUID(), sport: 'strength', startedAt: noon(-2, 5).toISOString(), durationMin: 50,
    });
    expect('ручная поверх записи с телефона — дубль', (await journal()).find((w) => w.id === manual.body.id).verdict, 'duplicate');

    // --- удалённое не возвращается ---
    await call('DELETE', `${base}/api/workouts/${runRow.id}`);
    const resent = await send('health-auto-export', haeToken, haeBody);
    expect('удалённая тренировка не возвращается', [resent.body.skippedDeleted, (await journal()).some((w) => w.id === runRow.id)], [1, false]);
    expect('её дубль с Android снова в зачёте', (await journal()).find((w) => w.id === hcRun.id).verdict, 'counted');

    // --- ротация и отключение ---
    const rotated = tokenOf(await call('POST', `${base}/api/integrations/hubs/hae/rotate`), 'hae');
    expect(
      'после перевыпуска старый токен мёртв, новый работает',
      [rotated !== haeToken, (await send('health-auto-export', haeToken, haeBody)).status, (await send('health-auto-export', rotated, haeBody)).status],
      [true, 401, 200],
    );
    const before = (await journal()).length;
    await call('DELETE', `${base}/api/integrations/hubs/hae`);
    expect(
      'отключение: токен не действует, тренировки остаются',
      [(await send('health-auto-export', rotated, haeBody)).status, (await journal()).length],
      [401, before],
    );
    const seen = (await jget(`${base}/api/integrations`)).hubs.find((h: any) => h.provider === 'health_connect');
    expect('видно, когда хаб последний раз присылал данные', typeof seen.lastEventAt, 'string');
  } finally {
    await prisma.challenge.delete({ where: { id } }).catch(() => undefined);
    await clean();
  }
}

/** Питание: поиск по справочнику, запись по продукту и цифрой, свой продукт, баланс калорий. */
async function foodScenario(base: string) {
  console.log('--- питание и баланс калорий ---');
  const { prisma } = await import('../src/lib/prisma');
  const { randomUUID } = await import('node:crypto');
  const clean = async () => {
    await prisma.foodEntry.deleteMany({ where: { user: { telegramId: 999n } } });
    await prisma.foodProduct.deleteMany({ where: { source: 'custom', name: { startsWith: 'Smoke' } } });
    await prisma.workout.deleteMany({ where: { user: { telegramId: 999n } } });
    await prisma.weightEntry.deleteMany({ where: { user: { telegramId: 999n }, sourceOwnerId: null } });
  };
  await clean();
  const today = mskDay(0);
  const search = async (q: string) => (await jget(`${base}/api/food/search?q=${encodeURIComponent(q)}`)).products as any[];

  try {
    // --- справочник ---
    const seeded = await prisma.foodProduct.count({ where: { source: 'seed' } });
    expect('справочник засеян', seeded > 250, true);
    expect('поиск: начало названия выше', (await search('гречка'))[0].name, 'Гречка варёная');
    expect('поиск: слова в любом порядке', (await search('грудка кур')).some((p) => p.name === 'Куриная грудка готовая'), true);
    expect('поиск: «ё» и регистр не важны', (await search('СЕМГА'))[0].name, 'Сёмга слабосолёная');
    expect('поиск: короткий запрос пуст', (await search('г')).length, 0);
    expect('поиск: ничего не нашлось', (await search('абракадабра')).length, 0);

    // --- запись по продукту: калории и БЖУ считаются из граммовки ---
    const grechka = (await search('гречка варёная'))[0];
    const clientId = randomUUID();
    const add = (body: Record<string, unknown>) => call('POST', `${base}/api/food/entries`, { clientId: randomUUID(), ...body });
    const byProduct = await add({ clientId, productId: grechka.id, grams: 250, meal: 'lunch' });
    const entry = byProduct.body.entries[0];
    expect('250 г гречки', [byProduct.status, entry.title, entry.kcal, entry.protein, entry.grams], [200, 'Гречка варёная', 275, 10.5, 250]);
    const dup = await call('POST', `${base}/api/food/entries`, { clientId, productId: grechka.id, grams: 250 });
    expect('повторная отправка формы не задваивает', dup.body.entries.length, 1);

    // --- запись цифрой ---
    const quick = await add({ kcal: 640, title: 'Бизнес-ланч' });
    expect('запись цифрой', [quick.body.eaten.kcal, quick.body.entries[1].title, quick.body.entries[1].protein], [915, 'Бизнес-ланч', null]);
    expect('без названия — «Приём пищи»', (await add({ kcal: 100 })).body.entries[2].title, 'Приём пищи');

    // --- валидация ---
    expect('граммовка вне диапазона -> 400', (await add({ productId: grechka.id, grams: 0 })).body?.error, 'bad_grams');
    expect('калории вне диапазона -> 400', (await add({ kcal: 50000 })).body?.error, 'bad_food_kcal');
    expect('еда из будущего -> 400', (await add({ kcal: 100, day: mskDay(2) })).body?.error, 'bad_food_day');
    expect('неизвестный приём пищи -> 400', (await add({ kcal: 100, meal: 'brunch' })).body?.error, 'bad_meal');
    expect('нет такого продукта -> 404', (await add({ productId: 99999999, grams: 100 })).status, 404);

    // --- свой продукт виден всем ---
    const custom = await call('POST', `${base}/api/food/products`, {
      name: 'Smoke сырники бабушкины', kcal100: 230, protein100: 15, fat100: 11, carbs100: 18, servingGrams: 70, servingLabel: '1 шт.',
    });
    expect('свой продукт', [custom.status, custom.body.source, custom.body.servingLabel], [200, 'custom', '1 шт.']);
    expect('БЖУ больше 100 г на 100 г -> 400', (await call('POST', `${base}/api/food/products`, { name: 'Smoke мусор', kcal100: 100, protein100: 60, fat100: 50 })).body?.error, 'bad_macros');
    const other = { ...HEADERS, 'X-Dev-Telegram-Id': '998' };
    const seenByOther = await call('GET', `${base}/api/food/search?q=${encodeURIComponent('smoke сырники')}`, undefined, other);
    expect('свой продукт находит и другой участник', seenByOther.body.products.length, 1);

    await add({ productId: custom.body.id, grams: 140 });
    const recent = (await jget(`${base}/api/food/recent`)).products;
    expect('недавние: последний продукт первым, с граммовкой', [recent[0].name, recent[0].lastGrams], ['Smoke сырники бабушкины', 140]);

    // --- баланс: без анкеты расчёта нет, с анкетой — базовый обмен × 1,2 + тренировки ---
    await prisma.userBodyProfile.deleteMany({ where: { user: { telegramId: 999n } } });
    const noProfile = await jget(`${base}/api/food/day`);
    expect('без анкеты баланса нет', [noProfile.balance, noProfile.energy.missing.includes('height')], [null, true]);

    await call('PUT', `${base}/api/body-profile`, { heightCm: 180, birthYear: new Date().getFullYear() - 36, sex: 'male' });
    await call('POST', `${base}/api/weight`, { weightKg: 85 });
    await call('POST', `${base}/api/workouts`, {
      // минуту назад, а не час: сразу после полуночи час назад — это ещё вчера
      clientId: randomUUID(), sport: 'run', startedAt: new Date(Date.now() - 60_000).toISOString(), durationMin: 40, kcal: 450,
    });
    const day = await jget(`${base}/api/food/day`);
    const eaten = 275 + 640 + 100 + 322; // гречка + ланч + перекус + 140 г сырников
    expect('съедено за день', [day.day, day.isToday, day.eaten.kcal], [today, true, eaten]);
    expect('расход: Миффлин — Сан-Жеор × 1,2 и тренировки', [day.energy.bmr, day.energy.baseline, day.workoutKcal], [1800, 2160, 450]);
    expect('баланс = съедено − (расход + тренировки)', day.balance, eaten - (2160 + 450));
    expect('неделя для графика', [day.week.length, day.week[6].day, day.week[6].eaten, day.week[6].workoutKcal], [7, today, eaten, 450]);

    // --- приватность и удаление ---
    const foreign = await call('DELETE', `${base}/api/food/entries/${entry.id}`, undefined, other);
    expect('чужую запись не удалить', foreign.status, 404);
    expect('чужой дневник пуст', (await call('GET', `${base}/api/food/day`, undefined, other)).body.entries.length, 0);
    await call('DELETE', `${base}/api/food/entries/${entry.id}`);
    expect('удаление записи', (await jget(`${base}/api/food/day`)).eaten.kcal, eaten - 275);

    const yesterday = await add({ kcal: 300, day: mskDay(-1) });
    expect('запись задним числом попадает в свой день', [yesterday.body.day, yesterday.body.eaten.kcal], [mskDay(-1), 300]);

    await openFoodFactsChecks(base, search);
  } finally {
    await clean();
  }
}

/** Open Food Facts через локальную заглушку: кэш в справочнике, лимит запросов, недоступность. */
async function openFoodFactsChecks(base: string, search: (q: string) => Promise<any[]>) {
  const { prisma } = await import('../src/lib/prisma');
  await prisma.foodProduct.deleteMany({ where: { source: 'off' } });

  const stub = { calls: 0, userAgent: '', down: false };
  const server: Server = createServer((req, res) => {
    stub.calls += 1;
    stub.userAgent = String(req.headers['user-agent'] ?? '');
    if (stub.down) {
      res.writeHead(503);
      return res.end('maintenance');
    }
    const terms = new URL(req.url ?? '/', 'http://stub').searchParams.get('search_terms') ?? '';
    const products = [
      { code: '4600000000017', product_name_ru: `Батончик ${terms}`, brands: 'Smoke Foods, Другой', serving_quantity: 45,
        nutriments: { 'energy-kcal_100g': 412, proteins_100g: 21, fat_100g: 14, carbohydrates_100g: 48 } },
      { code: '4600000000024', product_name: 'Без калорий', nutriments: {} }, // бесполезная запись — отбрасывается
    ];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ count: products.length, products }));
  });
  await new Promise<void>((resolve) => server.listen(OFF_STUB_PORT, '127.0.0.1', () => resolve()));

  try {
    const off = (q: string) => call('GET', `${base}/api/food/search/off?q=${encodeURIComponent(q)}`);

    expect('локально такого батончика нет', (await search('батончик протеиновый smoke')).length, 0);
    const found = await off('Протеиновый SMOKE');
    expect(
      'найден во внешней базе',
      [found.status, found.body.products.length, found.body.products[0].name, found.body.products[0].brand, found.body.products[0].kcal100],
      [200, 1, 'Батончик протеиновый smoke', 'Smoke Foods', 412],
    );
    expect('представились внятным User-Agent', stub.userAgent.includes('SportChallengeBot'), true);
    expect('найденное осело в справочнике — теперь находит локальный поиск, и по бренду тоже', (await search('smoke foods')).length, 1);

    const callsBefore = stub.calls;
    await off('протеиновый smoke');
    expect('одинаковый запрос второй раз наружу не уходит', stub.calls, callsBefore);
    expect('слишком короткий запрос -> 400', (await off('йо')).status, 400);

    // запись в дневник по продукту из внешней базы
    const { randomUUID } = await import('node:crypto');
    const entry = await call('POST', `${base}/api/food/entries`, { clientId: randomUUID(), productId: found.body.products[0].id, grams: 45 });
    expect('батончик 45 г', entry.body.entries.find((e: any) => e.title.startsWith('Батончик')).kcal, 185);

    stub.down = true;
    const down = await off('недоступный сервис');
    expect('внешняя база лежит -> 502, дневник жив', [down.status, down.body?.error, (await jget(`${base}/api/food/day`)).day], [502, 'off_unavailable', mskDay(0)]);
    stub.down = false;

    // лимит: сервис просит не больше 10 поисков в минуту с адреса, наш порог — 8
    const statuses: number[] = [];
    for (let i = 0; i < 9; i++) statuses.push((await off(`уникальный запрос номер ${i}`)).status);
    expect('лимит запросов в минуту', [statuses.filter((s) => s === 200).length < 9, statuses.at(-1)], [true, 429]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.foodProduct.deleteMany({ where: { source: 'off' } });
  }
}

main().catch((e) => {
  console.error('SMOKE FAIL', e);
  process.exit(1);
});
