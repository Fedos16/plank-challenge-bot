<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';
import type { WeightOverview, WeightPoint } from '../types';
import { confirmAction } from '../telegram';
import { formatDateRu, formatTimeRu } from '../helpers';

const props = defineProps<{ challengeId: number }>();
const emit = defineEmits<{ (e: 'back'): void; (e: 'left'): void }>();

const data = ref<WeightOverview | null>(null);
const loading = ref(true);
const busy = ref(false);

async function load() {
  loading.value = true;
  try {
    data.value = await api.getWeight();
  } finally {
    loading.value = false;
  }
}

function formatKg(n: number): string {
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Изменение веса со знаком: «−1,2» / «+0,4» / «±0». */
function formatDelta(n: number | null): string {
  if (n === null) return '—';
  if (n === 0) return '±0';
  return (n > 0 ? '+' : '−') + formatKg(Math.abs(n));
}

const W = 320;
const H = 110;
const PAD = 12;

/** Точки ломаной для SVG: история приходит от старых к новым. */
const chart = computed(() => {
  const points = data.value?.history ?? [];
  if (points.length < 2) return null;
  const values = points.map((p) => p.weightKg);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const coords = points.map((p, i) => {
    const x = PAD + (i / (points.length - 1)) * (W - PAD * 2);
    const y = PAD + ((max - p.weightKg) / span) * (H - PAD * 2);
    return { x, y, point: p };
  });
  return {
    min,
    max,
    line: coords.map((c) => c.x.toFixed(1) + ',' + c.y.toFixed(1)).join(' '),
    area:
      PAD + ',' + (H - PAD) + ' ' +
      coords.map((c) => c.x.toFixed(1) + ',' + c.y.toFixed(1)).join(' ') +
      ' ' + (W - PAD) + ',' + (H - PAD),
    last: coords[coords.length - 1]!,
    from: points[0]!.day,
    to: points[points.length - 1]!.day,
  };
});

/** История для списка — сверху свежее. */
const recent = computed<WeightPoint[]>(() => [...(data.value?.history ?? [])].reverse().slice(0, 30));

async function removeEntry(id: number) {
  const ok = await confirmAction('Удалить это взвешивание?');
  if (!ok || busy.value) return;
  busy.value = true;
  try {
    await api.deleteWeightEntry(id);
    await load();
  } finally {
    busy.value = false;
  }
}

async function leaveGroup() {
  const ok = await confirmAction('Выйти из группы взвешиваний? Ваша история веса останется на месте.');
  if (!ok || busy.value) return;
  busy.value = true;
  try {
    await api.leaveChallenge(props.challengeId);
    emit('left');
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <button class="back-link" @click="emit('back')">‹ К челленджам</button>

  <div v-if="loading" class="center">Загрузка…</div>

  <template v-else-if="data">
    <div class="profile-head">
      <div class="avatar">⚖️</div>
      <div>
        <div class="profile-name">Вес</div>
        <div class="muted">
          {{ data.stats.count ? data.stats.count + ' взвешиваний' : 'Данных пока нет' }}
        </div>
      </div>
    </div>

    <!-- Текущий вес -->
    <div v-if="data.latest" class="streak-hero">
      <div class="num">{{ formatKg(data.latest.weightKg) }} кг</div>
      <div class="lbl">
        {{ formatDateRu(data.latest.day) }} в {{ formatTimeRu(data.latest.measuredAt) }}
      </div>
    </div>

    <div v-if="data.latest" class="stats-grid">
      <div class="stat">
        <div class="v">{{ formatDelta(data.deltas.week) }}</div>
        <div class="k">За неделю</div>
      </div>
      <div class="stat">
        <div class="v">{{ formatDelta(data.deltas.month) }}</div>
        <div class="k">За месяц</div>
      </div>
      <div class="stat">
        <div class="v">{{ formatDelta(data.deltas.total) }}</div>
        <div class="k">От начала</div>
      </div>
      <div class="stat">
        <div class="v">
          {{ data.stats.min !== null ? formatKg(data.stats.min) : '—' }}
        </div>
        <div class="k">Минимум</div>
      </div>
    </div>

    <!-- График -->
    <div v-if="chart" class="card">
      <h3>Динамика</h3>
      <svg class="chart" :viewBox="'0 0 ' + W + ' ' + H" preserveAspectRatio="none">
        <polygon :points="chart.area" class="chart-area" />
        <polyline :points="chart.line" class="chart-line" />
        <circle :cx="chart.last.x" :cy="chart.last.y" r="3.5" class="chart-dot" />
      </svg>
      <div class="chart-legend">
        <span>{{ formatDateRu(chart.from) }}</span>
        <span class="muted">{{ formatKg(chart.min) }}–{{ formatKg(chart.max) }} кг</span>
        <span>{{ formatDateRu(chart.to) }}</span>
      </div>
    </div>

    <!-- Состав тела последнего взвешивания -->
    <div
      v-if="data.latest && (data.latest.bodyFat || data.latest.muscle || data.latest.water)"
      class="card"
    >
      <h3>Состав тела</h3>
      <div class="row" v-if="data.latest.bodyFat !== null">
        <div class="name">Жир</div>
        <div class="fire">{{ data.latest.bodyFat }}%</div>
      </div>
      <div class="row" v-if="data.latest.muscle !== null">
        <div class="name">Мышцы</div>
        <div class="fire">{{ data.latest.muscle }}%</div>
      </div>
      <div class="row" v-if="data.latest.water !== null">
        <div class="name">Вода</div>
        <div class="fire">{{ data.latest.water }}%</div>
      </div>
      <div class="muted" style="margin-top: 8px">
        Считает приложение по сопротивлению тела — цифры ориентировочные, следите за трендом.
      </div>
    </div>

    <!-- История -->
    <div v-if="recent.length" class="card">
      <h3>История</h3>
      <div v-for="e in recent" :key="e.id" class="row">
        <div class="name">{{ formatDateRu(e.day) }}</div>
        <div class="meta">{{ formatTimeRu(e.measuredAt) }}</div>
        <div class="fire">{{ formatKg(e.weightKg) }}</div>
        <button class="row-x" :disabled="busy" @click="removeEntry(e.id)">✕</button>
      </div>
    </div>

    <!-- Откуда берётся вес -->
    <div class="card">
      <h3>Откуда берётся вес</h3>
      <div class="muted">
        Умные весы пишут вес и состав тела в хранилище здоровья телефона, а приложение-хаб
        пересылает их сюда вместе с тренировками. Настраивается один раз в разделе
        «Подключения» фитнес-челленджа — отдельный адрес и токен для весов больше не нужны.
      </div>
      <div class="muted" style="margin-top: 8px">
        Если весы так не умеют, взвешивание можно внести вручную на вкладке «Тело».
      </div>
    </div>

    <div v-if="data.members.length" class="card">
      <h3>Кто в группе</h3>
      <div v-for="c in data.members" :key="c.userId" class="row">
        <div class="name">{{ c.name }}</div>
      </div>
      <div class="muted" style="margin-top: 8px">
        Вес у каждого свой: другие участники видят только имя, но не ваши цифры.
      </div>
      <button class="btn danger small" style="margin-top: 10px" :disabled="busy" @click="leaveGroup">
        Выйти из группы
      </button>
    </div>
  </template>
</template>

<style scoped>
.back-link {
  background: none;
  border: none;
  color: var(--link);
  font-size: 15px;
  padding: 4px 0 10px;
  cursor: pointer;
}
.chart {
  width: 100%;
  height: 110px;
  display: block;
  margin: 6px 0 2px;
  overflow: visible;
}
.chart-line {
  fill: none;
  stroke: var(--link);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}
.chart-area {
  fill: var(--link);
  opacity: 0.12;
}
.chart-dot {
  fill: var(--link);
}
.chart-legend {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--hint);
}
.row-x {
  border: none;
  background: none;
  color: var(--red);
  cursor: pointer;
  font-size: 13px;
  padding: 0 0 0 10px;
}
</style>
