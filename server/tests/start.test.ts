import { test } from 'node:test';
import assert from 'node:assert/strict';
import { earliestStartDay, startDayError } from '../src/services/fitness/start';

test('startDayError: старт сегодня или задним числом, пока первая неделя не кончилась', () => {
  // как у «Storm Fat fight 3.0»: собирались нажать 28.09, вспомнили 30.09
  const today = '2026-09-30';
  assert.equal(startDayError(today, today), null);
  assert.equal(startDayError('2026-09-28', today), null);
  // первая неделя 24.09–30.09 ещё идёт
  assert.equal(earliestStartDay(today), '2026-09-24');
  assert.equal(startDayError('2026-09-24', today), null);
  // первая неделя 23.09–29.09 уже кончилась — её итог подвёлся бы сразу
  assert.equal(startDayError('2026-09-23', today), 'start_too_early');
  // будущих взвешиваний ещё нет — стартовые замеры не из чего считать
  assert.equal(startDayError('2026-10-01', today), 'start_in_future');
});
