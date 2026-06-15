<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';
import type { AdminChallenge, DayStatusRow, LedgerEntry, Participant, Quote } from '../types';
import { STATE_LABEL, formatMoney, yesterdayISO } from '../helpers';
import { haptic } from '../telegram';

type Sub = 'settings' | 'bank' | 'quotes' | 'people' | 'day' | 'report';
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

// ---- День ----
const dayDate = ref(yesterdayISO());
const dayRows = ref<DayStatusRow[]>([]);
async function loadDay() {
  await run(async () => {
    dayRows.value = (await api.adminGetDay(dayDate.value)).rows;
  }, 'Загружено');
}
async function override(p: DayStatusRow, action: 'done' | 'missed' | 'sick' | 'clear') {
  await run(async () => {
    await api.adminDayOverride({ participationId: p.participationId, day: dayDate.value, action });
    dayRows.value = (await api.adminGetDay(dayDate.value)).rows;
  }, 'Применено');
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

function openSub(s: Sub) {
  sub.value = s;
  if (s === 'settings' && !settings.value) void loadSettings();
  if (s === 'bank') void loadBank();
  if (s === 'quotes') void loadQuotes();
  if (s === 'people') void loadPeople();
}

onMounted(loadSettings);
</script>

<template>
  <div>
    <div class="subtabs">
      <button :class="{ active: sub === 'settings' }" @click="openSub('settings')">Настройки</button>
      <button :class="{ active: sub === 'bank' }" @click="openSub('bank')">Банк</button>
      <button :class="{ active: sub === 'quotes' }" @click="openSub('quotes')">Речи</button>
      <button :class="{ active: sub === 'people' }" @click="openSub('people')">Участники</button>
      <button :class="{ active: sub === 'day' }" @click="openSub('day')">День</button>
      <button :class="{ active: sub === 'report' }" @click="openSub('report')">Отчёт</button>
    </div>

    <!-- Настройки -->
    <div v-if="sub === 'settings' && settings" class="card">
      <h3>Настройки челленджа</h3>
      <label class="field"><span class="lbl">Название</span><input v-model="settings.title" /></label>
      <label class="field"><span class="lbl">Описание</span><textarea v-model="settings.description" /></label>
      <label class="field"><span class="lbl">Текст правил</span><textarea v-model="settings.rulesText" style="min-height: 160px" /></label>
      <label class="field"><span class="lbl">Часовой пояс</span><input v-model="settings.timezone" /></label>
      <label class="field"><span class="lbl">Дата старта (YYYY-MM-DD)</span><input v-model="settings.startDate" /></label>
      <label class="field"><span class="lbl">Дедлайн кружка (HH:mm)</span><input v-model="settings.dailyDeadline" /></label>
      <label class="field"><span class="lbl">Дедлайн болезни (HH:mm)</span><input v-model="settings.sickDeadline" /></label>
      <label class="field"><span class="lbl">Минимум планки (сек)</span><input type="number" v-model.number="settings.minDurationSec" /></label>
      <label class="field"><span class="lbl">Штраф за пропуск (₽)</span><input type="number" v-model.number="settings.fineAmount" /></label>
      <label class="field"><span class="lbl">Множитель за фейк</span><input type="number" v-model.number="settings.fakeFineMultiplier" /></label>
      <label class="field"><span class="lbl">Время отчёта (HH:mm)</span><input v-model="settings.reportTime" /></label>
      <label class="field"><span class="lbl">Время напоминания (HH:mm)</span><input v-model="settings.reminderTime" /></label>
      <label class="field"><span class="lbl">ID чата для мониторинга</span><input v-model="settings.chatId" placeholder="напр. -1001234567890" /></label>
      <label class="field" style="display: flex; align-items: center; gap: 10px">
        <input type="checkbox" style="width: auto" v-model="settings.freezeStreakOnSick" />
        <span class="lbl" style="margin: 0">Больничный замораживает серию</span>
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
            <div class="muted">{{ e.participant || e.note || '' }} {{ e.day ? '· ' + e.day : '' }}</div>
          </div>
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

    <!-- День -->
    <div v-else-if="sub === 'day'" class="card">
      <h3>Статусы за день</h3>
      <label class="field"><span class="lbl">Дата (YYYY-MM-DD)</span><input v-model="dayDate" /></label>
      <button class="btn secondary" @click="loadDay">Загрузить</button>
      <div v-for="p in dayRows" :key="p.participationId" class="list-item" style="margin-top: 8px">
        <div class="grow">
          <b>{{ p.name }}</b>
          <span :class="`badge ${p.state}`" style="margin-left: 6px">{{ STATE_LABEL[p.state] }}</span>
          <div class="inline-actions" style="margin-top: 6px">
            <button class="btn small" @click="override(p, 'done')">✅</button>
            <button class="btn small danger" @click="override(p, 'missed')">❌</button>
            <button class="btn small secondary" @click="override(p, 'sick')">🤒</button>
            <button class="btn small secondary" @click="override(p, 'clear')">Сброс</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Отчёт -->
    <div v-else-if="sub === 'report'" class="card">
      <h3>Сформировать отчёт</h3>
      <label class="field"><span class="lbl">Дата (YYYY-MM-DD)</span><input v-model="reportDay" /></label>
      <button class="btn" @click="runReport">Сформировать и отправить</button>
      <div v-if="reportContent" style="margin-top: 12px">
        <div class="muted">{{ reportSent ? 'Отправлено в чат.' : 'Чат не привязан — отчёт не отправлен, но штрафы начислены.' }}</div>
        <pre class="report" v-html="reportContent"></pre>
      </div>
    </div>

    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>
