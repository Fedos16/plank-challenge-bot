import { buildServer } from '../src/api/server';

const HEADERS = { 'X-Dev-Telegram-Id': '999', 'Content-Type': 'application/json' };

async function jget(url: string) {
  return (await fetch(url, { headers: HEADERS })).json() as Promise<any>;
}
async function jpost(url: string, body: unknown) {
  return (await fetch(url, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) })).json() as Promise<any>;
}

async function main() {
  const app = await buildServer();
  await app.listen({ host: '127.0.0.1', port: 3001 });
  const base = 'http://127.0.0.1:3001';

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

main().catch((e) => {
  console.error('SMOKE FAIL', e);
  process.exit(1);
});
