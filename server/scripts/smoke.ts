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

  await app.close();
  console.log('SMOKE OK');
}

main().catch((e) => {
  console.error('SMOKE FAIL', e);
  process.exit(1);
});
