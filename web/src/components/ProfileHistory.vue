<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../api';
import type { DayState, ProfileHistory, Workout } from '../types';
import { STATE_LABEL, formatDateRu, formatTimeRu } from '../helpers';
import {
  SOURCE_LABEL,
  SPORT_EMOJI,
  VERDICT_LABEL,
  errorText,
  sessionTitle,
  sportTitle,
  weekMark,
  weekMeta,
} from '../fitness';
import WeekStrip from './WeekStrip.vue';

/**
 * История человека в одном челлендже, внутри профиля. Планка — календарь дней по месяцам,
 * от свежего месяца к старым; фитнес — текущая неделя, закрытые недели и последние тренировки.
 */
const props = defineProps<{ userId: number | 'me'; challengeId: number }>();

const data = ref<ProfileHistory | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    data.value = await api.getProfileHistory(props.userId, props.challengeId);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}

// ---------- планка ----------

const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];
const DOW = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

interface Cell {
  day: string;
  num: number;
  state: DayState;
}

/** Дни по месяцам: у каждого — пустые клетки до понедельника первой недели. */
const months = computed(() => {
  if (data.value?.kind !== 'plank') return [];
  const byMonth = new Map<string, Cell[]>();
  for (const d of data.value.days) {
    const key = d.day.slice(0, 7);
    const list = byMonth.get(key) ?? [];
    list.push({ day: d.day, num: Number(d.day.slice(8, 10)), state: d.state });
    byMonth.set(key, list);
  }
  return [...byMonth.entries()].reverse().map(([key, cells]) => {
    const [y, m] = key.split('-').map(Number) as [number, number];
    const first = cells[0]!;
    // день недели первой клетки: 0 — понедельник
    const dow = (new Date(Date.UTC(y, m - 1, first.num)).getUTCDay() + 6) % 7;
    return { key, title: `${MONTHS[m - 1]} ${y}`, pad: dow, cells };
  });
});

/** Счёт по итогам: сделано, пропуски (со штрафом), болел, заморозки. */
const plankTotals = computed(() => {
  if (data.value?.kind !== 'plank') return null;
  const t = { done: 0, missed: 0, sick: 0, frozen: 0 };
  for (const d of data.value.days) {
    if (d.state === 'done') t.done++;
    else if (d.state === 'sick') t.sick++;
    else if (d.state === 'frozen') t.frozen++;
    else if (d.state !== 'pending') t.missed++;
  }
  return t;
});

/** Легенда календаря: цвет клетки и есть значок, поэтому подписи без эмодзи. */
const LEGEND: { state: DayState; label: string }[] = [
  { state: 'done', label: 'сделал' },
  { state: 'missed', label: 'пропуск' },
  { state: 'late', label: 'поздно' },
  { state: 'sick', label: 'болел' },
  { state: 'frozen', label: 'заморозка' },
];

// ---------- фитнес ----------

function workoutTitle(w: Workout): string {
  return w.session ? sessionTitle(w.session.parts) : sportTitle(w);
}

function workoutMeta(w: Workout): string {
  const date = new Date(w.startedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  const parts = [`${date}, ${formatTimeRu(w.startedAt)}`, `${w.durationMin} мин`];
  if (w.kcal) parts.push(`${w.kcal} ккал`);
  parts.push(SOURCE_LABEL[w.source] ?? w.source);
  return parts.join(' · ');
}

onMounted(load);
watch(() => [props.userId, props.challengeId], load);
</script>

<template>
  <div class="history">
    <div v-if="loading" class="muted">Загрузка истории…</div>
    <div v-else-if="error" class="error-text">{{ error }}</div>

    <!-- Планка: календарь -->
    <template v-else-if="data?.kind === 'plank'">
      <div v-if="!data.days.length" class="muted">Истории пока нет.</div>
      <template v-else>
        <div v-if="plankTotals" class="totals">
          <span>✅ {{ plankTotals.done }}</span>
          <span>❌ {{ plankTotals.missed }}</span>
          <span v-if="plankTotals.sick">🤒 {{ plankTotals.sick }}</span>
          <span v-if="plankTotals.frozen">❄️ {{ plankTotals.frozen }}</span>
        </div>
        <div v-for="m in months" :key="m.key" class="month">
          <div class="month-title">{{ m.title }}</div>
          <div class="grid">
            <span v-for="d in DOW" :key="d" class="dow">{{ d }}</span>
            <span v-for="i in m.pad" :key="'pad' + i" />
            <span
              v-for="c in m.cells"
              :key="c.day"
              class="cell"
              :class="c.state"
              :title="`${formatDateRu(c.day)} — ${STATE_LABEL[c.state]}`"
            >
              {{ c.num }}
            </span>
          </div>
        </div>
        <div class="legend">
          <span v-for="l in LEGEND" :key="l.state"><i class="cell mini" :class="l.state" />{{ l.label }}</span>
        </div>
      </template>
    </template>

    <!-- Фитнес: недели и тренировки -->
    <template v-else-if="data?.kind === 'fitness'">
      <div v-if="data.currentWeek" class="block">
        <div class="block-title">
          Неделя {{ data.currentWeek.weekNumber }} · {{ data.currentWeek.done }} из {{ data.currentWeek.required }}
        </div>
        <WeekStrip :days="data.currentWeek.days" tone="card" size="sm" />
      </div>
      <div v-else-if="data.trialWeek" class="block">
        <div class="block-title">
          Пробная неделя · {{ data.trialWeek.done }} из {{ data.trialWeek.required }}
        </div>
        <WeekStrip :days="data.trialWeek.days" tone="card" size="sm" />
      </div>

      <div v-if="data.weeks.length" class="block">
        <div class="block-title">Прошлые недели</div>
        <div
          v-for="w in data.weeks"
          :key="w.id"
          class="row week-row"
          :class="{ out: w.outOfGame }"
          :title="`${formatDateRu(w.start)} – ${formatDateRu(w.end)}`"
        >
          <div class="name">
            Неделя {{ w.weekNumber }}
            <div class="meta">{{ weekMeta(w) }}</div>
          </div>
          <WeekStrip v-if="w.days.length" :days="w.days" tone="card" size="sm" :mark-today="false" />
          <div class="week-mark">{{ weekMark(w) }}</div>
        </div>
      </div>

      <div class="block">
        <div class="block-title">Тренировки</div>
        <div v-if="!data.workouts.length" class="muted">Тренировок пока нет.</div>
        <div v-for="w in data.workouts" :key="w.id" class="workout">
          <div class="ico">{{ SPORT_EMOJI[w.sport] ?? '💪' }}</div>
          <div class="grow">
            <div class="w-name">
              {{ workoutTitle(w) }}
              <span v-if="w.verdict !== 'counted'" class="verdict">{{ VERDICT_LABEL[w.verdict] }}</span>
            </div>
            <div class="muted small">{{ workoutMeta(w) }}</div>
            <div v-if="w.note" class="muted small">📝 {{ w.note }}</div>
          </div>
        </div>
      </div>
    </template>

    <div v-else class="muted">У этого челленджа нет истории по дням.</div>
  </div>
</template>

<style scoped>
.history {
  padding: 4px 0 8px;
}
.totals {
  display: flex;
  gap: 14px;
  font-weight: 600;
  margin-bottom: 10px;
}
.month {
  margin-bottom: 12px;
}
.month-title {
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 6px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
}
.dow {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--hint);
  text-align: center;
}
.cell {
  height: 30px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  background: var(--track);
  color: var(--hint);
}
.cell.done {
  background: rgba(46, 204, 113, 0.22);
  color: var(--green);
}
.cell.late {
  background: rgba(245, 166, 35, 0.22);
  color: var(--amber);
}
.cell.missed,
.cell.fake,
.cell.rejected {
  background: rgba(231, 76, 60, 0.2);
  color: var(--red);
}
.cell.sick {
  background: rgba(47, 111, 235, 0.16);
  color: var(--link);
}
.cell.frozen {
  background: rgba(88, 166, 255, 0.2);
  color: #58a6ff;
}
.cell.pending {
  background: none;
  box-shadow: inset 0 0 0 1.5px var(--rule);
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  font-size: 12px;
  color: var(--hint);
}
.legend span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.cell.mini {
  width: 12px;
  height: 12px;
  border-radius: 4px;
  display: inline-block;
}
.block {
  margin-bottom: 14px;
}
.block-title {
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 8px;
}
.week-row {
  gap: 10px;
}
.week-row.out {
  opacity: 0.55;
}
.week-row .name {
  min-width: 78px;
}
.week-mark {
  width: 24px;
  text-align: right;
}
.workout {
  display: flex;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--rule);
}
.workout:last-child {
  border-bottom: none;
}
.ico {
  font-size: 20px;
}
.grow {
  flex: 1;
  min-width: 0;
}
.w-name {
  font-weight: 600;
}
.small {
  font-size: 13px;
}
.verdict {
  font-size: 11px;
  font-weight: 600;
  color: var(--hint);
  margin-left: 4px;
}
</style>
