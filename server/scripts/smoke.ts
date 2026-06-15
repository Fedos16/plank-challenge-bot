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

  await app.close();
  console.log('SMOKE OK');
}

main().catch((e) => {
  console.error('SMOKE FAIL', e);
  process.exit(1);
});
