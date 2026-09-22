<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../api';
import type {
  FitnessOverview,
  Measurement,
  MeasurementKind,
  MuscleUnit,
  WeightOverview,
  WeightPoint,
} from '../types';
import { confirmAction, haptic } from '../telegram';
import { formatDayHumanRu, formatTimeRu, todayInZone } from '../helpers';
import {
  MEASUREMENT_KINDS,
  MEASUREMENT_LABEL,
  UNIT_LABEL,
  convertMuscle,
  errorText,
  formatNum,
  muscleUnitOf,
  numOrNull,
} from '../fitness';
import LineChart from './LineChart.vue';
import UnitToggle from './UnitToggle.vue';

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

/** В чём вводим и показываем мышцы. В базе всегда доля — килограммы сервер выводит из веса. */
const muscleUnit = ref<MuscleUnit>(muscleUnitOf(props.overview));
const muscleUnitLabel = computed(() => UNIT_LABEL[muscleUnit.value]);

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
/** Линию цели по мышцам рисуем, только когда график в той же единице, что и цель. */
const muscleTarget = computed(() =>
  goalMetric.value === 'muscle' && props.overview.progress?.unit === muscleUnit.value ? target.value : null,
);

function series(pick: (p: WeightPoint) => number | null) {
  return (weight.value?.history ?? [])
    .map((p) => ({ day: p.day, value: pick(p) }))
    .filter((p): p is { day: string; value: number } => p.value !== null);
}
const weightSeries = computed(() => series((p) => p.weightKg));
const fatSeries = computed(() => series((p) => p.bodyFat));
const muscleSeries = computed(() => series((p) => (muscleUnit.value === 'kg' ? p.muscleKg : p.muscle)));

/** История для списка — сверху свежее. */
const recent = computed<WeightPoint[]>(() => [...(weight.value?.history ?? [])].reverse().slice(0, 15));

const today = computed(() => todayInZone(props.overview.challenge.timezone));

/**
 * Куда должен идти вес по цели: −1 — вниз, +1 — вверх, 0 — цель не про вес. Нужно, чтобы
 * красить сдвиг между взвешиваниями: минус при похудении зелёный, при наборе — красный.
 */
const weightDirection = computed(() => {
  const p = props.overview.progress;
  if (!p || p.metric !== 'weightKg' || p.start === null || p.target === null) return 0;
  return Math.sign(p.target - p.start);
});

/** Сдвиг веса от предыдущего взвешивания в списке (список — от новых к старым). */
function weightDelta(i: number): number | null {
  const cur = recent.value[i];
  const prev = recent.value[i + 1];
  if (!cur || !prev) return null;
  return Math.round((cur.weightKg - prev.weightKg) * 10) / 10;
}

function deltaTone(delta: number | null): 'good' | 'bad' | '' {
  if (delta === null || delta === 0 || weightDirection.value === 0) return '';
  return Math.sign(delta) === weightDirection.value ? 'good' : 'bad';
}

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
  const muscle = numOrNull(weightForm.muscle);
  void run(async () => {
    weight.value = await api.addManualWeight({
      weightKg,
      bodyFat: numOrNull(weightForm.bodyFat),
      ...(muscleUnit.value === 'kg' ? { muscleKg: muscle } : { muscle }),
    });
    weightForm.weightKg = weightForm.bodyFat = weightForm.muscle = '';
    emit('changed');
  });
}

/** Выбор единицы запоминается в анкете; уже набранное число пересчитываем через набранный вес. */
function setMuscleUnit(unit: MuscleUnit) {
  if (unit === muscleUnit.value) return;
  const typed = numOrNull(weightForm.muscle);
  const weightKg = numOrNull(weightForm.weightKg);
  if (typed !== null) weightForm.muscle = weightKg ? String(convertMuscle(typed, weightKg, unit)) : '';
  muscleUnit.value = unit;
  void run(async () => {
    await api.saveBodyProfile({ muscleUnit: unit });
    emit('changed');
  });
}

function muscleText(e: WeightPoint): string | null {
  const value = muscleUnit.value === 'kg' ? e.muscleKg : e.muscle;
  return value === null ? null : `мышцы ${formatNum(value)} ${muscleUnitLabel.value}`;
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
          <span class="lbl">Мышцы, {{ muscleUnitLabel }}</span>
          <input v-model="weightForm.muscle" inputmode="decimal" placeholder="—" @keyup.enter="addWeight" />
        </label>
      </div>
      <UnitToggle :model-value="muscleUnit" label="Мышцы считать в" :disabled="busy" @update:model-value="setMuscleUnit" />
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
      <LineChart :points="muscleSeries" :unit="muscleUnitLabel" :target="muscleTarget" />
    </div>

    <!-- Обхваты -->
    <div class="card">
      <h3>📏 Обхваты</h3>
      <div v-for="m in measureSummary" :key="m.kind" class="row">
        <div class="name">{{ MEASUREMENT_LABEL[m.kind] }}</div>
        <div class="meta">{{ formatDayHumanRu(m.last.day, today) }}</div>
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
      <div v-for="(e, i) in recent" :key="e.id" class="row">
        <div class="name">
          {{ formatDayHumanRu(e.day, today) }}
          <div class="meta">{{ formatTimeRu(e.measuredAt) }}</div>
        </div>
        <!-- в строке место под один показатель состава: тот, за которым человек следит -->
        <div v-if="goalMetric === 'muscle' && muscleText(e)" class="meta">{{ muscleText(e) }}</div>
        <div v-else-if="e.bodyFat !== null" class="meta">жир {{ e.bodyFat }}%</div>
        <!-- сдвиг от предыдущего взвешивания: к цели зелёный, от цели красный -->
        <div v-if="weightDelta(i) !== null" class="delta" :class="deltaTone(weightDelta(i))">
          {{ formatDelta(weightDelta(i)!) }}
        </div>
        <div class="fire">{{ formatNum(e.weightKg) }}</div>
        <button class="row-x" :disabled="busy" @click="removeWeight(e.id)">✕</button>
      </div>
    </div>
  </template>
</template>

<style scoped>
.delta {
  font-size: 12px;
  font-weight: 600;
  color: var(--hint);
  min-width: 34px;
  text-align: right;
}
.delta.good {
  color: var(--green);
}
.delta.bad {
  color: var(--red);
}
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
