<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';
import type {
  AdminChallenge,
  DebtRow,
  DebtsOverview,
  LedgerEntry,
  Participant,
  PaymentEntry,
  Quote,
  RecentDay,
  RecentDayRow,
  RecentParticipant,
} from '../types';
import {
  STATE_LABEL,
  formatDateRu,
  formatDateTimeRu,
  formatDayTitleRu,
  formatMoney,
  formatTimeRu,
  daysBetweenISO,
  todayISO,
  yesterdayISO,
} from '../helpers';
import { confirmAction, haptic } from '../telegram';

type Sub = 'settings' | 'bank' | 'debts' | 'quotes' | 'people' | 'day' | 'report' | 'reset';
const sub = ref<Sub>('settings');

const toast = ref<string | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function showToast(msg: string, ok = true) {
  toast.value = msg;
  haptic(ok ? 'success' : 'error');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = null), 2200);
}
async function run(fn: () => Promise<void>, okMsg = 'Сохранено') {
  try {
    await fn();
    showToast(okMsg);
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Ошибка', false);
  }
}

// ---- Настройки ----
const settings = ref<AdminChallenge | null>(null);
async function loadSettings() {
  settings.value = await api.adminGetChallenge();
}
async function saveSettings() {
  if (!settings.value) return;
  await run(async () => {
    settings.value = await api.adminUpdateChallenge(settings.value as AdminChallenge);
  });
}

// ---- Банк ----
const ledger = ref<LedgerEntry[]>([]);
const bank = ref(0);
const bankValue = ref<number | null>(null);
const adjAmount = ref<number | null>(null);
const adjNote = ref('');
const spendAmount = ref<number | null>(null);
const spendNote = ref('');
async function loadBank() {
  const res = await api.adminGetLedger();
  ledger.value = res.entries;
  bank.value = res.bank;
}
async function setBank() {
  if (bankValue.value === null) return;
  await run(async () => {
    const r = await api.adminSetBank(bankValue.value as number);
    bank.value = r.bank;
    bankValue.value = null;
    await loadBank();
  }, 'Банк обновлён');
}
async function addAdjustment() {
  if (!adjAmount.value) return;
  await run(async () => {
    await api.adminAddLedger({ type: 'adjustment', amount: adjAmount.value as number, note: adjNote.value });
    adjAmount.value = null;
    adjNote.value = '';
    await loadBank();
  }, 'Запись добавлена');
}
async function addSpend() {
  if (!spendAmount.value) return;
  await run(async () => {
    await api.adminAddLedger({ type: 'spend', amount: spendAmount.value as number, note: spendNote.value });
    spendAmount.value = null;
    spendNote.value = '';
    await loadBank();
  }, 'Трата записана');
}

// ---- Долги / оплаты ----
const debts = ref<DebtsOverview | null>(null);
const payInput = ref<Record<number, number | null>>({});
const payNote = ref<Record<number, string>>({});
async function loadDebts() {
  debts.value = await api.adminGetDebts();
}
async function addPayment(row: DebtRow) {
  const amount = payInput.value[row.participationId];
  if (!amount || amount <= 0) return;
  await run(async () => {
    debts.value = await api.adminAddPayment({
      participationId: row.participationId,
      amount,
      note: payNote.value[row.participationId] || undefined,
    });
    payInput.value[row.participationId] = null;
    payNote.value[row.participationId] = '';
  }, 'Оплата записана');
}
function payFull(row: DebtRow) {
  if (row.debt > 0) payInput.value[row.participationId] = row.debt;
}
async function deletePayment(pmt: PaymentEntry) {
  const ok = await confirmAction(`Удалить оплату ${formatMoney(pmt.amount)}${pmt.participant ? ' · ' + pmt.participant : ''}?`);
  if (!ok) return;
  await run(async () => {
    debts.value = await api.adminDeletePayment(pmt.id);
  }, 'Оплата удалена');
}

// ---- Речи ----
const quotes = ref<Quote[]>([]);
const newQuote = ref('');
async function loadQuotes() {
  quotes.value = (await api.adminGetQuotes()).quotes;
}
async function addQuote() {
  if (!newQuote.value.trim()) return;
  await run(async () => {
    await api.adminAddQuote(newQuote.value.trim());
    newQuote.value = '';
    await loadQuotes();
  }, 'Речь добавлена');
}
async function toggleQuote(q: Quote) {
  await run(async () => {
    await api.adminUpdateQuote(q.id, { isActive: !q.isActive });
    await loadQuotes();
  }, 'Обновлено');
}
async function saveQuote(q: Quote) {
  await run(async () => {
    await api.adminUpdateQuote(q.id, { text: q.text });
  });
}
async function deleteQuote(q: Quote) {
  await run(async () => {
    await api.adminDeleteQuote(q.id);
    await loadQuotes();
  }, 'Удалено');
}

// ---- Участники ----
const people = ref<Participant[]>([]);
async function loadPeople() {
  people.value = (await api.adminGetParticipants()).rows;
}
async function toggleStatus(p: Participant) {
  await run(async () => {
    await api.adminUpdateParticipant(p.participationId, {
      status: p.status === 'active' ? 'left' : 'active',
    });
    await loadPeople();
  }, 'Обновлено');
}
async function toggleAdmin(p: Participant) {
  await run(async () => {
    await api.adminUpdateParticipant(p.participationId, { isAdmin: !p.isAdmin });
    await loadPeople();
  }, 'Обновлено');
}

// ---- Корректировки: лента последних событий ----
const PAGE_DAYS = 10;
// сколько пустых окон подряд пролистываем за один «показать ещё»
const MAX_EMPTY_PAGES = 6;
const recentDays = ref<RecentDay[]>([]);
const recentParticipants = ref<RecentParticipant[]>([]);
const recentFilter = ref(0); // 0 = все участники
const recentHasMore = ref(false);
const recentNextBefore = ref<string | null>(null);
const recentFrom = ref<string | null>(null); // самый ранний загруженный день
const recentLoading = ref(false);
const recentLoaded = ref(false);
const openRow = ref<string | null>(null);

function rowKey(day: string, participationId: number) {
  return `${day}|${participationId}`;
}
function toggleRow(day: string, participationId: number) {
  const key = rowKey(day, participationId);
  openRow.value = openRow.value === key ? null : key;
}

/**
 * Загрузка ленты: reset — с начала, иначе догружаем более ранние дни.
 * Пустые окна (участник тогда ещё не вступил / уже вышел) пролистываем сами,
 * чтобы не заставлять жать «показать ещё» по пустым страницам.
 */
async function loadRecent(reset = true) {
  if (recentLoading.value) return;
  if (!reset && (!recentHasMore.value || !recentNextBefore.value)) return;
  recentLoading.value = true;
  try {
    let before = reset ? undefined : (recentNextBefore.value as string);
    let added: RecentDay[] = [];
    for (let i = 0; i < MAX_EMPTY_PAGES && !added.length; i += 1) {
      const res = await api.adminGetRecent({
        days: PAGE_DAYS,
        before,
        participationId: recentFilter.value || undefined,
      });
      added = res.days;
      recentParticipants.value = res.participants;
      recentHasMore.value = res.hasMore;
      recentNextBefore.value = res.nextBefore;
      recentFrom.value = res.from;
      before = res.nextBefore ?? undefined;
      if (!res.hasMore) break;
    }
    recentDays.value = reset ? added : [...recentDays.value, ...added];
    recentLoaded.value = true;
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Ошибка', false);
  } finally {
    recentLoading.value = false;
  }
}

/**
 * Перечитать всё загруженное окно после ручной правки: штраф за один день
 * сдвигает накопительный итог всех последующих дней.
 */
async function refreshLoaded() {
  const span = recentFrom.value ? daysBetweenISO(recentFrom.value, todayISO()) + 2 : PAGE_DAYS;
  const res = await api.adminGetRecent({
    days: span,
    participationId: recentFilter.value || undefined,
  });
  recentDays.value = res.days;
  recentParticipants.value = res.participants;
  recentHasMore.value = res.hasMore;
  recentNextBefore.value = res.nextBefore;
  recentFrom.value = res.from;
}

function changeRecentFilter() {
  openRow.value = null;
  recentDays.value = [];
  recentHasMore.value = false;
  recentNextBefore.value = null;
  recentFrom.value = null;
  void loadRecent(true);
}

async function override(
  day: string,
  p: RecentDayRow,
  action: 'done' | 'missed' | 'sick' | 'clear' | 'fake',
) {
  await run(async () => {
    await api.adminDayOverride({ participationId: p.participationId, day, action });
    await refreshLoaded();
  }, 'Применено');
}

function dayCounts(d: RecentDay) {
  const counts = { done: 0, missed: 0, sick: 0, frozen: 0, pending: 0 };
  for (const r of d.rows) {
    if (r.state === 'done') counts.done += 1;
    else if (r.state === 'sick') counts.sick += 1;
    else if (r.state === 'frozen') counts.frozen += 1;
    else if (r.state === 'pending') counts.pending += 1;
    else counts.missed += 1;
  }
  return counts;
}

// ---- Отчёт ----
const reportDay = ref(yesterdayISO());
const reportContent = ref('');
const reportSent = ref<boolean | null>(null);
async function runReport() {
  await run(async () => {
    const r = await api.adminRunReport(reportDay.value);
    reportContent.value = r.content;
    reportSent.value = r.sent;
  }, 'Отчёт сформирован');
}

// ---- Сброс / очистка данных ----
const resetBusy = ref(false);
async function withConfirm(message: string, fn: () => Promise<void>, okMsg: string) {
  if (resetBusy.value) return;
  const ok = await confirmAction(message);
  if (!ok) return;
  resetBusy.value = true;
  try {
    await fn();
    showToast(okMsg);
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Ошибка', false);
  } finally {
    resetBusy.value = false;
  }
}
function resetLedgerData() {
  void withConfirm('Очистить все штрафы и обнулить банк? Это нельзя отменить.', async () => {
    await api.adminResetLedger();
  }, 'Штрафы очищены, банк = 0');
}
function resetParticipantsData() {
  void withConfirm(
    'Удалить ВСЕХ участников вместе с их подтверждениями, болезнями и штрафами? Это нельзя отменить.',
    async () => {
      await api.adminResetParticipants();
    },
    'Участники удалены',
  );
}
function unbindChatData() {
  void withConfirm('Отвязать чат от челленджа? Кружки перестанут засчитываться, пока не выполните /bindchat снова.', async () => {
    await api.adminResetChat();
    if (settings.value) settings.value.chatId = null;
  }, 'Чат отвязан');
}
function resetAllData() {
  void withConfirm(
    'ПОЛНЫЙ сброс данных: участники, подтверждения, болезни, штрафы, банк и отчёты. Настройки и речи сохранятся. Продолжить?',
    async () => {
      await api.adminResetAll();
    },
    'Данные полностью очищены',
  );
}

function openSub(s: Sub) {
  sub.value = s;
  if (s === 'settings' && !settings.value) void loadSettings();
  if (s === 'bank') void loadBank();
  if (s === 'debts') void loadDebts();
  if (s === 'quotes') void loadQuotes();
  if (s === 'people') void loadPeople();
  if (s === 'day' && !recentLoaded.value) void loadRecent(true);
}

onMounted(loadSettings);
</script>

<template>
  <div>
    <div class="subtabs">
      <button :class="{ active: sub === 'settings' }" @click="openSub('settings')">Настройки</button>
      <button :class="{ active: sub === 'bank' }" @click="openSub('bank')">Банк</button>
      <button :class="{ active: sub === 'debts' }" @click="openSub('debts')">Долги</button>
      <button :class="{ active: sub === 'quotes' }" @click="openSub('quotes')">Речи</button>
      <button :class="{ active: sub === 'people' }" @click="openSub('people')">Участники</button>
      <button :class="{ active: sub === 'day' }" @click="openSub('day')">Корректировки</button>
      <button :class="{ active: sub === 'report' }" @click="openSub('report')">Отчёт</button>
      <button :class="{ active: sub === 'reset' }" @click="openSub('reset')">Сброс</button>
    </div>

    <!-- Настройки -->
    <div v-if="sub === 'settings' && settings" class="card">
      <h3>Настройки челленджа</h3>
      <label class="field"><span class="lbl">Название</span><input v-model="settings.title" /></label>
      <label class="field"><span class="lbl">Описание</span><textarea v-model="settings.description" /></label>
      <label class="field"><span class="lbl">Текст правил</span><textarea v-model="settings.rulesText" style="min-height: 160px" /></label>
      <label class="field"><span class="lbl">Часовой пояс</span><input v-model="settings.timezone" /></label>
      <label class="field"><span class="lbl">Дата старта</span><input type="date" v-model="settings.startDate" /></label>
      <label class="field"><span class="lbl">Дедлайн кружка (HH:mm)</span><input v-model="settings.dailyDeadline" /></label>
      <label class="field"><span class="lbl">Дедлайн болезни (HH:mm)</span><input v-model="settings.sickDeadline" /></label>
      <label class="field"><span class="lbl">Минимум планки (сек)</span><input type="number" v-model.number="settings.minDurationSec" /></label>
      <label class="field"><span class="lbl">Штраф за пропуск (₽)</span><input type="number" v-model.number="settings.fineAmount" /></label>
      <label class="field"><span class="lbl">Множитель за фейк</span><input type="number" v-model.number="settings.fakeFineMultiplier" /></label>
      <label class="field">
        <span class="lbl">❄️ Заморозка за сколько дней подряд (0 — выключить)</span>
        <input type="number" min="0" v-model.number="settings.freezeEveryDays" />
      </label>
      <label class="field">
        <span class="lbl">❄️ Максимум заморозок на руках (0 — выключить)</span>
        <input type="number" min="0" v-model.number="settings.maxFreezes" />
      </label>
      <div class="muted" style="margin: -4px 0 12px">
        Заморозку тратит сам участник в своём кабинете и только на пропущенный день не раньше дня,
        когда она заработана. Серия не рвётся, штраф за пропуск остаётся.
      </div>
      <label class="field"><span class="lbl">Время отчёта (HH:mm)</span><input v-model="settings.reportTime" /></label>
      <label class="field"><span class="lbl">Время напоминания (HH:mm)</span><input v-model="settings.reminderTime" /></label>
      <label class="field"><span class="lbl">«Последний шанс» в ЛС (HH:mm, пусто — выкл)</span><input v-model="settings.lastChanceTime" /></label>
      <label class="field"><span class="lbl">ID чата для мониторинга</span><input v-model="settings.chatId" placeholder="напр. -1001234567890" /></label>
      <label class="field" style="display: flex; align-items: center; gap: 10px">
        <input type="checkbox" style="width: auto" v-model="settings.freezeStreakOnSick" />
        <span class="lbl" style="margin: 0">Больничный замораживает серию</span>
      </label>
      <label class="field" style="display: flex; align-items: center; gap: 10px">
        <input type="checkbox" style="width: auto" v-model="settings.dmReminders" />
        <span class="lbl" style="margin: 0">Личные напоминания в ЛС (помимо чата)</span>
      </label>
      <label class="field" style="display: flex; align-items: center; gap: 10px">
        <input type="checkbox" style="width: auto" v-model="settings.isActive" />
        <span class="lbl" style="margin: 0">Челлендж активен</span>
      </label>
      <button class="btn" @click="saveSettings">Сохранить</button>
    </div>

    <!-- Банк -->
    <div v-else-if="sub === 'bank'">
      <div class="bank-chip">
        <span>💰 Текущий банк</span>
        <span class="v">{{ formatMoney(bank) }}</span>
      </div>
      <div class="card">
        <h3>Установить банк</h3>
        <label class="field"><span class="lbl">Новое значение (₽)</span><input type="number" v-model.number="bankValue" /></label>
        <button class="btn" @click="setBank">Установить</button>
      </div>
      <div class="card">
        <h3>Корректировка (+/−)</h3>
        <label class="field"><span class="lbl">Сумма (₽, можно минус)</span><input type="number" v-model.number="adjAmount" /></label>
        <label class="field"><span class="lbl">Комментарий</span><input v-model="adjNote" /></label>
        <button class="btn" @click="addAdjustment">Добавить запись</button>
      </div>
      <div class="card">
        <h3>Потратить из банка</h3>
        <label class="field"><span class="lbl">Сумма (₽)</span><input type="number" v-model.number="spendAmount" /></label>
        <label class="field"><span class="lbl">На что</span><input v-model="spendNote" /></label>
        <button class="btn secondary" @click="addSpend">Записать трату</button>
      </div>
      <div class="card">
        <h3>Реестр (последние)</h3>
        <div v-for="e in ledger" :key="e.id" class="list-item">
          <div class="grow">
            <b>{{ e.amount > 0 ? '+' : '' }}{{ formatMoney(e.amount) }}</b>
            <span class="muted"> · {{ e.type }}</span>
            <div class="muted">
              {{ e.participant || e.note || '' }}
              {{ e.day ? '· ' + formatDateRu(e.day) : '' }}
              <span class="muted"> · {{ formatDateTimeRu(e.createdAt) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Долги -->
    <div v-else-if="sub === 'debts'">
      <div v-if="debts" class="debt-totals">
        <div class="bank-chip">
          <span>🧾 Всего долгов</span>
          <span class="v">{{ formatMoney(debts.totals.debt) }}</span>
        </div>
        <div class="bank-chip">
          <span>✅ Скинули</span>
          <span class="v">{{ formatMoney(debts.totals.paid) }} / {{ formatMoney(debts.totals.accrued) }}</span>
        </div>
      </div>

      <div v-if="debts" class="card">
        <h3>Кто сколько должен</h3>
        <div class="muted" style="margin-bottom: 10px">
          Долг = начисленные штрафы минус то, что участник уже скинул. Оплаты на банк не влияют
          (штраф уже учтён в банке), они лишь гасят личный долг.
        </div>
        <div v-if="!debts.rows.length" class="muted">Участников пока нет.</div>
        <div v-for="row in debts.rows" :key="row.participationId" class="list-item">
          <div class="grow">
            <b>{{ row.name }}</b>
            <span v-if="row.status === 'left'" class="badge missed" style="margin-left: 6px">вышел</span>
            <div class="muted">
              Начислено {{ formatMoney(row.accrued) }} · скинул {{ formatMoney(row.paid) }} ·
              <span
                :class="row.debt > 0 ? 'debt-pos' : row.debt < 0 ? 'debt-neg' : 'debt-zero'"
              >{{ row.debt > 0 ? 'долг ' + formatMoney(row.debt) : row.debt < 0 ? 'переплата ' + formatMoney(-row.debt) : 'рассчитался' }}</span>
            </div>
            <div class="pay-row" style="margin-top: 6px">
              <input
                type="number"
                inputmode="numeric"
                placeholder="Скинул, ₽"
                v-model.number="payInput[row.participationId]"
              />
              <input type="text" placeholder="Комментарий" v-model="payNote[row.participationId]" />
              <button class="btn small secondary" :disabled="row.debt <= 0" @click="payFull(row)">Весь долг</button>
              <button class="btn small" @click="addPayment(row)">Записать</button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="debts && debts.recentPayments.length" class="card">
        <h3>История оплат</h3>
        <div v-for="p in debts.recentPayments" :key="p.id" class="list-item">
          <div class="grow">
            <b>+{{ formatMoney(p.amount) }}</b>
            <span class="muted"> · {{ p.participant || '—' }}</span>
            <div class="muted">
              {{ p.note || '' }}<span v-if="p.note"> · </span>{{ formatDateTimeRu(p.createdAt) }}
            </div>
          </div>
          <button class="btn small danger" @click="deletePayment(p)">Удалить</button>
        </div>
      </div>
    </div>

    <!-- Речи -->
    <div v-else-if="sub === 'quotes'">
      <div class="card">
        <h3>Новая речь</h3>
        <textarea v-model="newQuote" placeholder="Текст мотивационной речи" />
        <button class="btn" style="margin-top: 8px" @click="addQuote">Добавить</button>
      </div>
      <div class="card">
        <h3>Все речи ({{ quotes.length }})</h3>
        <div v-for="q in quotes" :key="q.id" class="list-item">
          <div class="grow">
            <textarea v-model="q.text" @blur="saveQuote(q)" />
            <div class="inline-actions" style="margin-top: 6px">
              <button class="btn small secondary" @click="toggleQuote(q)">
                {{ q.isActive ? '✅ Вкл' : '⛔ Выкл' }}
              </button>
              <button class="btn small danger" @click="deleteQuote(q)">Удалить</button>
              <span v-if="q.global" class="muted">глобальная</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Участники -->
    <div v-else-if="sub === 'people'" class="card">
      <h3>Участники ({{ people.length }})</h3>
      <div v-for="p in people" :key="p.participationId" class="list-item">
        <div class="grow">
          <b>{{ p.name }}</b>
          <span v-if="p.isAdmin" class="badge sick" style="margin-left: 6px">админ</span>
          <div class="muted">
            🔥 {{ p.currentStreak }} · рекорд {{ p.maxStreak }} · {{ p.status }}
          </div>
          <div v-if="settings && settings.freezeEveryDays > 0 && settings.maxFreezes > 0" class="muted">
            ❄️ доступно {{ p.freezesAvailable }} · использовано {{ p.freezesUsed }} · заработано
            {{ p.freezesEarned }}
          </div>
          <div class="inline-actions" style="margin-top: 6px">
            <button class="btn small secondary" @click="toggleStatus(p)">
              {{ p.status === 'active' ? 'Исключить' : 'Вернуть' }}
            </button>
            <button class="btn small secondary" @click="toggleAdmin(p)">
              {{ p.isAdmin ? 'Снять админа' : 'Сделать админом' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Корректировки: лента последних событий -->
    <div v-else-if="sub === 'day'">
      <div class="card">
        <h3>Последние события</h3>
        <div class="muted" style="margin-bottom: 10px">
          Свежие дни сверху. Нажми на участника, чтобы поправить отметку вручную:
          ✅ сделал, ❌ пропуск, ⚠️ фейк, 🤒 болел, «Сброс» — убрать отметку.
          Правка меняет серию, пропуски и банк. Любая правка, кроме «Пропуск», снимает заморозку
          с этого дня и возвращает её участнику.
        </div>
        <label class="field">
          <span class="lbl">Участник</span>
          <select v-model.number="recentFilter" @change="changeRecentFilter">
            <option :value="0">Все участники</option>
            <option v-for="p in recentParticipants" :key="p.participationId" :value="p.participationId">
              {{ p.name }}{{ p.status === 'left' ? ' (вышел)' : '' }}
            </option>
          </select>
        </label>
      </div>

      <div v-if="recentLoading && !recentDays.length" class="card muted">Загружаем…</div>
      <div v-else-if="!recentDays.length" class="card muted">
        {{ recentFilter ? 'За эти дни у участника событий нет.' : 'Событий пока нет.' }}
      </div>

      <div v-for="d in recentDays" :key="d.day" class="card day-card">
        <div class="day-head">
          <div>
            <b>{{ formatDayTitleRu(d.day) }}</b>
            <span class="muted"> · день {{ d.dayNumber }}</span>
          </div>
          <div class="muted day-counts">
            ✅ {{ dayCounts(d).done }} · ❌ {{ dayCounts(d).missed }} · 🤒 {{ dayCounts(d).sick }}
            <span v-if="dayCounts(d).frozen"> · ❄️ {{ dayCounts(d).frozen }}</span>
            <span v-if="dayCounts(d).pending"> · ⏳ {{ dayCounts(d).pending }}</span>
          </div>
        </div>

        <div v-if="!d.rows.length" class="muted">Нет участников.</div>
        <div
          v-for="p in d.rows"
          :key="p.participationId"
          class="list-item day-row"
          :class="{ open: openRow === rowKey(d.day, p.participationId) }"
        >
          <div class="grow">
            <div class="day-row-head" @click="toggleRow(d.day, p.participationId)">
              <div class="grow">
                <b>{{ p.name }}</b>
                <span v-if="p.joined" class="badge done" style="margin-left: 6px">вступил</span>
                <span v-if="p.left" class="badge missed" style="margin-left: 6px">вышел</span>
                <div class="muted">
                  <span v-if="p.submittedAt">{{ formatTimeRu(p.submittedAt) }}</span>
                  <span v-if="p.submittedAt && p.videoDuration"> · {{ p.videoDuration }} сек</span>
                  <span v-if="p.freezeEarnedDay">
                    заморозка (получена за {{ formatDateRu(p.freezeEarnedDay) }})
                  </span>
                  <span v-if="p.fine">
                    {{ p.submittedAt || p.freezeEarnedDay ? ' · ' : '' }}штраф
                    {{ formatMoney(p.fine) }} · всего {{ formatMoney(p.finesTotal) }}
                  </span>
                  <span v-if="!p.submittedAt && !p.fine && !p.freezeEarnedDay">—</span>
                </div>
              </div>
              <span :class="`badge ${p.state}`">{{ STATE_LABEL[p.state] }}</span>
            </div>
            <div v-if="openRow === rowKey(d.day, p.participationId)" class="inline-actions" style="margin-top: 8px">
              <button class="btn small" @click="override(d.day, p, 'done')">✅ Засчитать</button>
              <button class="btn small danger" @click="override(d.day, p, 'missed')">❌ Пропуск</button>
              <button class="btn small danger" @click="override(d.day, p, 'fake')">⚠️ Фейк ×{{ settings?.fakeFineMultiplier ?? 2 }}</button>
              <button class="btn small secondary" @click="override(d.day, p, 'sick')">🤒 Болел</button>
              <button class="btn small secondary" @click="override(d.day, p, 'clear')">Сброс</button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="recentLoaded" class="card" style="text-align: center">
        <button v-if="recentHasMore" class="btn secondary" :disabled="recentLoading" @click="loadRecent(false)">
          {{ recentLoading ? 'Загружаем…' : `Показать ещё ${PAGE_DAYS} дней` }}
        </button>
        <div v-else class="muted">Это начало челленджа.</div>
      </div>
    </div>

    <!-- Отчёт -->
    <div v-else-if="sub === 'report'" class="card">
      <h3>Сформировать отчёт</h3>
      <label class="field"><span class="lbl">Дата</span><input type="date" v-model="reportDay" /></label>
      <button class="btn" @click="runReport">Сформировать и отправить</button>
      <div v-if="reportContent" style="margin-top: 12px">
        <div class="muted">{{ reportSent ? 'Отправлено в чат.' : 'Чат не привязан — отчёт не отправлен, но штрафы начислены.' }}</div>
        <pre class="report" v-html="reportContent"></pre>
      </div>
    </div>

    <!-- Сброс / очистка -->
    <div v-else-if="sub === 'reset'">
      <div class="card">
        <div class="muted" style="margin-bottom: 12px">
          Очистка данных челленджа. Действия необратимы. Настройки челленджа и мотивационные речи
          при этом сохраняются.
        </div>

        <div class="reset-row">
          <div class="grow">
            <b>Очистить штрафы и банк</b>
            <div class="muted">Удалит все записи реестра, банк станет 0 ₽.</div>
          </div>
          <button class="btn small danger" :disabled="resetBusy" @click="resetLedgerData">Очистить</button>
        </div>

        <div class="reset-row">
          <div class="grow">
            <b>Удалить участников</b>
            <div class="muted">Все участники + их подтверждения, больничные и штрафы.</div>
          </div>
          <button class="btn small danger" :disabled="resetBusy" @click="resetParticipantsData">Удалить</button>
        </div>

        <div class="reset-row">
          <div class="grow">
            <b>Отвязать чат</b>
            <div class="muted">Сбросит привязанный чат. Потом нужно снова /bindchat.</div>
          </div>
          <button class="btn small danger" :disabled="resetBusy" @click="unbindChatData">Отвязать</button>
        </div>
      </div>

      <div class="card">
        <b>Полный сброс данных</b>
        <div class="muted" style="margin: 4px 0 10px">
          Участники, подтверждения, болезни, штрафы, банк и отчёты — всё разом. Настройки и речи остаются.
        </div>
        <button class="btn danger" :disabled="resetBusy" @click="resetAllData">Сбросить всё</button>
      </div>
    </div>

    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>

<style scoped>
.debt-totals {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}
.pay-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.pay-row input[type='number'] {
  width: 110px;
}
.pay-row input[type='text'] {
  flex: 1;
  min-width: 120px;
}
.debt-pos {
  color: #e5484d;
  font-weight: 600;
}
.debt-neg {
  color: #f5a623;
}
.debt-zero {
  color: #30a46c;
}
.day-card {
  padding-top: 10px;
}
.day-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: baseline;
  gap: 6px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.12);
  margin-bottom: 4px;
}
.day-counts {
  white-space: nowrap;
}
.day-row-head {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
.day-row.open {
  background: rgba(128, 128, 128, 0.06);
  border-radius: 10px;
  padding-left: 8px;
  padding-right: 8px;
  margin-left: -8px;
  margin-right: -8px;
}
.reset-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid rgba(128, 128, 128, 0.12);
}
.reset-row:last-child {
  border-bottom: none;
}
.reset-row .grow {
  flex: 1;
}
</style>
