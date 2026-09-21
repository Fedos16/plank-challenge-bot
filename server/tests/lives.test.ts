import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replayLives, weeksToForgiveForReinstate } from '../src/services/fitness/lives';

const week = (weekIndex: number, passed: boolean, forgiven = false) => ({ weekIndex, passed, forgiven });

test('replayLives: без провалов все жизни на месте', () => {
  const s = replayLives([week(0, true), week(1, true)], 3);
  assert.deepEqual([s.left, s.eliminated, s.eliminatedAtWeek], [3, false, null]);
  assert.deepEqual(s.weeks.map((w) => w.lifeLost), [false, false]);
});

test('replayLives: провал снимает жизнь, прощённый — нет', () => {
  const s = replayLives([week(0, false), week(1, true), week(2, false, true)], 3);
  assert.equal(s.left, 2);
  assert.deepEqual(s.weeks.map((w) => w.livesAfter), [2, 2, 2]);
  assert.deepEqual(s.weeks.map((w) => w.lifeLost), [true, false, false]);
});

test('replayLives: на нуле участник выбывает, дальше недели вне игры', () => {
  const s = replayLives([week(0, false), week(1, false), week(2, false), week(3, true)], 2);
  assert.deepEqual([s.left, s.eliminated, s.eliminatedAtWeek], [0, true, 1]);
  assert.deepEqual(s.weeks.map((w) => w.outOfGame), [false, false, true, true]);
  // недели после выбывания жизни не снимают — счётчик не уходит в минус
  assert.deepEqual(s.weeks.map((w) => w.livesAfter), [1, 0, 0, 0]);
});

test('replayLives: с одной жизнью первый же провал — выбывание', () => {
  const s = replayLives([week(0, true), week(1, false)], 1);
  assert.deepEqual([s.eliminated, s.eliminatedAtWeek], [true, 1]);
});

test('replayLives: порядок входа не важен', () => {
  const s = replayLives([week(2, false), week(0, false), week(1, true)], 2);
  assert.equal(s.eliminatedAtWeek, 2);
});

test('replayLives: прощение возвращает в игру без отдельного статуса', () => {
  const lost = [week(0, false), week(1, false)];
  assert.equal(replayLives(lost, 2).eliminated, true);
  const forgiven = [week(0, false), week(1, false, true)];
  assert.deepEqual([replayLives(forgiven, 2).eliminated, replayLives(forgiven, 2).left], [false, 1]);
});

test('replayLives: увеличение числа жизней в настройках возвращает выбывших', () => {
  const weeks = [week(0, false), week(1, false)];
  assert.equal(replayLives(weeks, 2).eliminated, true);
  assert.deepEqual([replayLives(weeks, 3).eliminated, replayLives(weeks, 3).left], [false, 1]);
});

test('weeksToForgiveForReinstate: неделя выбывания и все провалы после неё', () => {
  const weeks = [week(0, false), week(1, false), week(2, true), week(3, false), week(4, false, true)];
  // жизни кончились на неделе 1; неделя 0 остаётся честно потерянной жизнью
  assert.deepEqual(weeksToForgiveForReinstate(weeks, 2), [1, 3]);
});

test('weeksToForgiveForReinstate: кто в игре, тому прощать нечего', () => {
  assert.deepEqual(weeksToForgiveForReinstate([week(0, false), week(1, true)], 3), []);
});

test('weeksToForgiveForReinstate: после прощения участник действительно в игре', () => {
  const weeks = [week(0, false), week(1, false), week(2, false)];
  const forgive = new Set(weeksToForgiveForReinstate(weeks, 2));
  const after = weeks.map((w) => ({ ...w, forgiven: w.forgiven || forgive.has(w.weekIndex) }));
  assert.deepEqual([replayLives(after, 2).eliminated, replayLives(after, 2).left], [false, 1]);
});
