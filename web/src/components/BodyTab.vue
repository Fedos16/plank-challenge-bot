<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../api';
import type { FitnessOverview, Measurement, MeasurementKind, WeightOverview, WeightPoint } from '../types';
import { confirmAction, haptic } from '../telegram';
import { formatDateRu, formatTimeRu } from '../helpers';
import { MEASUREMENT_KINDS, MEASUREMENT_LABEL, errorText, formatNum, numOrNull } from '../fitness';
import LineChart from './LineChart.vue';

const props = defineProps<{ overview: FitnessOverview }>();
/** Новый замер меняет прогресс к цели — родитель перечитывает сводку. */
const emit = defineEmits<{ (e: 'changed'): void }>();

const weight = ref<WeightOverview | null>(null);
const measurements = ref<Measurement[]>([]);
const loading = ref(true);
const busy = ref(false);
const error = ref<string | null>(null);

const weightForm = reactive({ weightKg: '', bodyFat: '', muscle: '' });
const measureForm = reactive({ kind: 'waist' as MeasurementKind, value: '' });

async function load() {
  loading.value = true;
  try {
    const [w, m] = await Promise.all([api.getWeight(), api.getMeasurements()]);
    weight.value = w;
    measurements.value = m.rows;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}

const goalMetric = computed(() => props.overview.progress?.metric ?? null);
const target = computed(() => props.overview.progress?.target ?? null);

function series(pick: (p: WeightPoint) => number | null) {
  return (weight.value?.history ?? [])
    .map((p) => ({ day: p.day, value: pick(p) }))
    .filter((p): p is { day: string; value: number } => p.value !== null);
}
const weightSeries = computed(() => series((p) => p.weightKg));
const fatSeries = computed(() => series((p) => p.bodyFat));
const muscleSeries = computed(() => series((p) => p.muscle));

/** История для списка — сверху свежее. */
const recent = computed<WeightPoint[]>(() => [...(weight.value?.history ?? [])].reverse().slice(0, 15));

interface MeasureRow {
  kind: MeasurementKind;
  last: Measurement;
  delta: number | null;
}

/** По каждому виду замера: последнее значение и сдвиг от самого первого. */
const measureSummary = computed<MeasureRow[]>(() => {
  const result: MeasureRow[] = [];
  for (const kind of MEASUREMENT_KINDS) {
    const rows = measurements.value.filter((m) => m.kind === kind); // от новых к старым
    const last = rows[0];
    const first = rows[rows.length - 1];
    if (!last || !first) continue;
    const delta = rows.length > 1 ? Math.round((last.value - first.value) * 10) / 10 : null;
    result.push({ kind, last, delta });
  }
  return result;
});

function formatDelta(n: number): string {
  if (n === 0) return '±0';
  return (n > 0 ? '+' : '−') + formatNum(Math.abs(n));
}

async function run(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    await action();
    haptic('success');
  } catch (e) {
    error.value = errorText(e);
    haptic('error');
  } finally {
    busy.value = false;
  }
}

function addWeight() {
  const weightKg = numOrNull(weightForm.weightKg);
  if (weightKg === null) {
    error.value = 'Введите вес';
    return;
  }
  void run(async () => {
    weight.value = await api.addManualWeight({
      weightKg,
      bodyFat: numOrNull(weightForm.bodyFat),
      muscle: numOrNull(weightForm.muscle),
    });
    weightForm.weightKg = weightForm.bodyFat = weightForm.muscle = '';
    emit('changed');
  });
}

async function removeWeight(id: number) {
  if (!(await confirmAction('Удалить это взвешивание?'))) return;
  void run(async () => {
    await api.deleteWeightEntry(id);
    weight.value = await api.getWeight();
    emit('changed');
  });
}

function addMeasurement() {
  const value = numOrNull(measureForm.value);
  if (value === null) {
    error.value = 'Введите значение в сантиметрах';
    return;
  }
  void run(async () => {
    measurements.value = (await api.saveMeasurement({ kind: measureForm.kind, value })).rows;
    measureForm.value = '';
  });
}

async function removeMeasurement(id: number) {
  if (!(await confirmAction('Удалить этот замер?'))) return;
  void run(async () => {
    measurements.value = (await api.deleteMeasurement(id)).rows;
  });
}

onMounted(load);
</script>

<template>
  <div v-if="loading" class="center">Загрузка…</div>

  <template v-else>
    <!-- Взвеситься -->
    <div class="card">
      <h3>⚖️ Записать вес</h3>
      <div class="three">
        <label class="field">
          <span class="lbl">Вес, кг</span>
          <input v-model="weightForm.weightKg" inputmode="decimal" placeholder="85,4" @keyup.enter="addWeight" />
        </label>
        <label class="field">
          <span class="lbl">Жир, %</span>
          <input v-model="weightForm.bodyFat" inputmode="decimal" placeholder="—" @keyup.enter="addWeight" />
        </label>
        <label class="field">
          <span class="lbl">Мышцы, %</span>
          <input v-model="weightForm.muscle" inputmode="decimal" placeholder="—" @keyup.enter="addWeight" />
        </label>
      </div>
      <button class="btn" :disabled="busy" @click="addWeight">Записать</button>
      <div class="muted" style="margin-top: 8px">
        С умных весов вес приходит сам — подключение в группе «Взвешивание».
      </div>
    </div>

    <div v-if="error" class="error-text" style="margin: 0 4px 10px">{{ error }}</div>

    <!-- Динамика -->
    <div v-if="weightSeries.length" class="card">
      <h3>Вес</h3>
      <LineChart :points="weightSeries" unit="кг" :target="goalMetric === 'weightKg' ? target : null" />
    </div>
    <div v-if="fatSeries.length > 1" class="card">
      <h3>Жир</h3>
      <LineChart :points="fatSeries" unit="%" :target="goalMetric === 'bodyFat' ? target : null" />
    </div>
    <div v-if="muscleSeries.length > 1" class="card">
      <h3>Мышцы</h3>
      <LineChart :points="muscleSeries" unit="%" :target="goalMetric === 'muscle' ? target : null" />
    </div>

    <!-- Обхваты -->
    <div class="card">
      <h3>📏 Обхваты</h3>
      <div v-for="m in measureSummary" :key="m.kind" class="row">
        <div class="name">{{ MEASUREMENT_LABEL[m.kind] }}</div>
        <div class="meta">{{ formatDateRu(m.last.day) }}</div>
        <div v-if="m.delta !== null" class="meta">{{ formatDelta(m.delta) }}</div>
        <div class="fire">{{ formatNum(m.last.value) }} см</div>
        <button class="row-x" :disabled="busy" @click="removeMeasurement(m.last.id)">✕</button>
      </div>
      <div v-if="!measureSummary.length" class="muted" style="margin-bottom: 10px">
        Сантиметровая лента честнее весов: мышцы тяжелее жира, и вес может стоять, пока талия уходит.
      </div>

      <div class="measure-form">
        <select v-model="measureForm.kind">
          <option v-for="k in MEASUREMENT_KINDS" :key="k" :value="k">{{ MEASUREMENT_LABEL[k] }}</option>
        </select>
        <input v-model="measureForm.value" inputmode="decimal" placeholder="см" @keyup.enter="addMeasurement" />
        <button class="btn small" :disabled="busy" @click="addMeasurement">Записать</button>
      </div>
      <div class="muted" style="margin-top: 8px">Один замер вида в день: повторный ввод исправляет значение.</div>
    </div>

    <!-- История взвешиваний -->
    <div v-if="recent.length" class="card">
      <h3>История веса</h3>
      <div v-for="e in recent" :key="e.id" class="row">
        <div class="name">{{ formatDateRu(e.day) }}</div>
        <div class="meta">{{ formatTimeRu(e.measuredAt) }}</div>
        <div v-if="e.bodyFat !== null" class="meta">жир {{ e.bodyFat }}%</div>
        <div class="fire">{{ formatNum(e.weightKg) }}</div>
        <button class="row-x" :disabled="busy" @click="removeWeight(e.id)">✕</button>
      </div>
    </div>
  </template>
</template>

<style scoped>
.three {
  display: grid;
  grid-template-columns: 1.3fr 1fr 1fr;
  gap: 8px;
}
.measure-form {
  display: grid;
  grid-template-columns: 1.4fr 1fr auto;
  gap: 8px;
  margin-top: 12px;
  align-items: center;
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
