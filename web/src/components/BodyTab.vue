<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../api';
import type { FitnessOverview, GoalMetric, MuscleUnit, WeightOverview, WeightPoint } from '../types';
import { confirmAction, haptic } from '../telegram';
import { daysBetweenISO, formatDateRu, formatDayHumanRu, formatTimeRu, todayInZone } from '../helpers';
import { UNIT_LABEL, convertMuscle, errorText, formatNum, muscleUnitOf, numOrNull } from '../fitness';
import LineChart from './LineChart.vue';
import UnitToggle from './UnitToggle.vue';

const props = defineProps<{ overview: FitnessOverview }>();
/** Новый замер меняет прогресс к цели — родитель перечитывает сводку. */
const emit = defineEmits<{ (e: 'changed'): void }>();

const weight = ref<WeightOverview | null>(null);
const loading = ref(true);
const busy = ref(false);
const error = ref<string | null>(null);

/** Сегодня по часам телефона: день взвешивания выбирают по нему, будущее недоступно. */
const localToday = () => new Date().toLocaleDateString('sv-SE');
const weightForm = reactive({ weightKg: '', bodyFat: '', muscle: '', day: localToday() });

/** В чём вводим и показываем мышцы. В базе всегда доля — килограммы сервер выводит из веса. */
const muscleUnit = ref<MuscleUnit>(muscleUnitOf(props.overview));
const muscleUnitLabel = computed(() => UNIT_LABEL[muscleUnit.value]);

async function load() {
  loading.value = true;
  try {
    weight.value = await api.getWeight();
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

type Tone = 'good' | 'bad' | '';

interface Point {
  day: string;
  value: number;
}

function series(pick: (p: WeightPoint) => number | null): Point[] {
  return (weight.value?.history ?? [])
    .map((p) => ({ day: p.day, value: pick(p) }))
    .filter((p): p is Point => p.value !== null);
}

/** История для списка — сверху свежее. */
const recent = computed<WeightPoint[]>(() => [...(weight.value?.history ?? [])].reverse().slice(0, 15));

const today = computed(() => todayInZone(props.overview.challenge.timezone));

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Куда показателю хорошо двигаться: −1 — вниз, +1 — вверх, 0 — не красим. У показателя цели —
 * к цели: минус при похудении зелёный, при наборе — красный. Без цели жиру хорошо вниз, мышцам —
 * вверх, а вес не красим: смотря что человек делает.
 */
function directionOf(metric: GoalMetric): number {
  const p = props.overview.progress;
  if (p?.metric === metric && p.start !== null && p.target !== null) return Math.sign(p.target - p.start);
  return metric === 'bodyFat' ? -1 : metric === 'muscle' ? 1 : 0;
}

function toneOf(delta: number | null, direction: number): Tone {
  if (delta === null || delta === 0 || direction === 0) return '';
  return Math.sign(delta) === direction ? 'good' : 'bad';
}

/** Сдвиг веса от предыдущего взвешивания в списке (список — от новых к старым). */
function weightDelta(i: number): number | null {
  const cur = recent.value[i];
  const prev = recent.value[i + 1];
  if (!cur || !prev) return null;
  return round1(cur.weightKg - prev.weightKg);
}

function deltaTone(delta: number | null): Tone {
  return toneOf(delta, directionOf('weightKg'));
}

function formatDelta(n: number): string {
  if (n === 0) return '±0';
  return (n > 0 ? '+' : '−') + formatNum(Math.abs(n));
}

/** Последняя точка не позже чем за `days` дней до `day` — как дельты веса на сервере. */
function pointBefore(points: Point[], day: string, days: number): Point | null {
  for (let i = points.length - 1; i >= 0; i--) {
    if (daysBetweenISO(points[i]!.day, day) >= days) return points[i]!;
  }
  return null;
}

interface Cell {
  value: string;
  label: string;
  tone: Tone;
}

/**
 * Цифры к графику: сдвиг последнего замера за неделю, за месяц и за весь график, у показателя
 * цели — ещё сколько до неё. Взвешиваются не каждый день, поэтому период подписан по факту
 * («за 9 дн.»), а совпавшая точка отсчёта второй раз не показывается.
 */
function cellsOf(points: Point[], direction: number, target: number | null): Cell[] {
  const last = points[points.length - 1];
  const first = points[0];
  if (!last || !first) return [];
  const refs: { ref: Point; label: string }[] = [];
  for (const days of [7, 30]) {
    const ref = pointBefore(points, last.day, days);
    if (ref && !refs.some((r) => r.ref === ref)) {
      refs.push({ ref, label: `за ${daysBetweenISO(ref.day, last.day)} дн.` });
    }
  }
  if (first !== last && !refs.some((r) => r.ref === first)) {
    refs.push({ ref: first, label: `с ${formatDateRu(first.day).slice(0, 5)}` });
  }
  const cells = refs.map(({ ref, label }): Cell => {
    const delta = round1(last.value - ref.value);
    return { value: formatDelta(delta), label, tone: toneOf(delta, direction) };
  });
  if (target !== null && direction !== 0) {
    const left = Math.max(0, round1((target - last.value) * direction));
    cells.push(left === 0 ? { value: '✓', label: 'цель взята', tone: 'good' } : { value: formatNum(left), label: 'до цели', tone: '' });
  }
  return cells;
}

interface MetricCard {
  metric: GoalMetric;
  title: string;
  unit: string;
  points: Point[];
  target: number | null;
  current: number;
  cells: Cell[];
}

/** Вес, жир и мышцы: последнее значение, сдвиги и график. Жир и мышцы — со второго замера. */
const metricCards = computed<MetricCard[]>(() => {
  const defs: { metric: GoalMetric; title: string; unit: string; points: Point[]; target: number | null }[] = [
    {
      metric: 'weightKg',
      title: 'Вес',
      unit: 'кг',
      points: series((p) => p.weightKg),
      target: goalMetric.value === 'weightKg' ? target.value : null,
    },
    {
      metric: 'bodyFat',
      title: 'Жир',
      unit: '%',
      points: series((p) => p.bodyFat),
      target: goalMetric.value === 'bodyFat' ? target.value : null,
    },
    {
      metric: 'muscle',
      title: 'Мышцы',
      unit: muscleUnitLabel.value,
      points: series((p) => (muscleUnit.value === 'kg' ? p.muscleKg : p.muscle)),
      target: muscleTarget.value,
    },
  ];
  return defs
    .filter((d) => d.points.length > (d.metric === 'weightKg' ? 0 : 1))
    .map((d) => ({
      ...d,
      current: d.points[d.points.length - 1]!.value,
      cells: cellsOf(d.points, directionOf(d.metric), d.target),
    }));
});

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
  // Сегодня — момент ввода. Прошлый день — его утро: в дне хранится одно взвешивание, утреннее,
  // а 9 часов по часам телефона попадают в тот же день по Москве почти из любого пояса
  const measuredAt =
    weightForm.day && weightForm.day !== localToday() ? new Date(`${weightForm.day}T09:00:00`).toISOString() : undefined;
  void run(async () => {
    weight.value = await api.addManualWeight({
      weightKg,
      bodyFat: numOrNull(weightForm.bodyFat),
      ...(muscleUnit.value === 'kg' ? { muscleKg: muscle } : { muscle }),
      ...(measuredAt ? { measuredAt } : {}),
    });
    weightForm.weightKg = weightForm.bodyFat = weightForm.muscle = '';
    weightForm.day = localToday();
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

/** Какое взвешивание сейчас дополняем составом: весы вроде Mi Scale 2 присылают один вес. */
const editingId = ref<number | null>(null);
const compForm = reactive({ bodyFat: '', muscle: '' });

function openComposition(e: WeightPoint) {
  if (editingId.value === e.id) {
    editingId.value = null;
    return;
  }
  const muscle = muscleUnit.value === 'kg' ? e.muscleKg : e.muscle;
  compForm.bodyFat = e.bodyFat === null ? '' : formatNum(e.bodyFat);
  compForm.muscle = muscle === null ? '' : formatNum(muscle);
  editingId.value = e.id;
}

function saveComposition(id: number) {
  const muscle = numOrNull(compForm.muscle);
  void run(async () => {
    weight.value = await api.setWeightComposition(id, {
      bodyFat: numOrNull(compForm.bodyFat),
      ...(muscleUnit.value === 'kg' ? { muscleKg: muscle } : { muscle }),
    });
    editingId.value = null;
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
          <span class="lbl req">Вес, кг</span>
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
      <label class="field">
        <span class="lbl">Дата</span>
        <input v-model="weightForm.day" type="date" :max="localToday()" />
      </label>
      <UnitToggle :model-value="muscleUnit" label="Мышцы считать в" :disabled="busy" @update:model-value="setMuscleUnit" />
      <button class="btn" :disabled="busy" @click="addWeight">Записать</button>
      <div class="muted" style="margin-top: 8px">
        С умных весов вес приходит сам — подключение в группе «Взвешивание». В день хранится одно
        взвешивание — первое, утреннее: повторный ввод за тот же день исправляет его. Забыли
        записать — выберите дату, и взвешивание встанет в тот день.
      </div>
    </div>

    <div v-if="error" class="error-text" style="margin: 0 4px 10px">{{ error }}</div>

    <!-- Динамика: последнее значение, сдвиги цифрами и график -->
    <div v-for="m in metricCards" :key="m.metric" class="card">
      <div class="metric-head">
        <h3>{{ m.title }}</h3>
        <div class="metric-now">{{ formatNum(m.current) }}<span class="metric-unit">{{ m.unit }}</span></div>
      </div>
      <div v-if="m.cells.length" class="shifts">
        <div v-for="c in m.cells" :key="c.label" class="shift">
          <div class="v" :class="c.tone">{{ c.value }}</div>
          <div class="k">{{ c.label }}</div>
        </div>
      </div>
      <LineChart :points="m.points" :unit="m.unit" :target="m.target" />
    </div>

    <!-- История взвешиваний -->
    <div v-if="recent.length" class="card">
      <h3>История веса</h3>
      <template v-for="(e, i) in recent" :key="e.id">
        <div class="row">
          <div class="name">
            {{ formatDayHumanRu(e.day, today) }}
            <div class="meta">{{ formatTimeRu(e.measuredAt) }}</div>
          </div>
          <!-- в строке место под один показатель состава: тот, за которым человек следит.
               Нажатие открывает правку — жир и мышцы с весов без выгрузки состава вводятся тут -->
          <button v-if="e.bodyFat === null && e.muscle === null" class="comp add" :disabled="busy" @click="openComposition(e)">
            ＋ жир, мышцы
          </button>
          <button v-else class="comp meta" :disabled="busy" @click="openComposition(e)">
            {{ goalMetric === 'muscle' && muscleText(e) ? muscleText(e) : e.bodyFat !== null ? `жир ${formatNum(e.bodyFat)}%` : muscleText(e) }}
          </button>
          <!-- сдвиг от предыдущего взвешивания: к цели зелёный, от цели красный -->
          <div v-if="weightDelta(i) !== null" class="delta" :class="deltaTone(weightDelta(i))">
            {{ formatDelta(weightDelta(i)!) }}
          </div>
          <div class="fire">{{ formatNum(e.weightKg) }}</div>
          <button class="row-x" :disabled="busy" @click="removeWeight(e.id)">✕</button>
        </div>
        <div v-if="editingId === e.id" class="comp-form">
          <label class="field">
            <span class="lbl">Жир, %</span>
            <input v-model="compForm.bodyFat" inputmode="decimal" placeholder="24,4" @keyup.enter="saveComposition(e.id)" />
          </label>
          <label class="field">
            <span class="lbl">Мышцы, {{ muscleUnitLabel }}</span>
            <input v-model="compForm.muscle" inputmode="decimal" placeholder="—" @keyup.enter="saveComposition(e.id)" />
          </label>
          <button class="btn small" :disabled="busy" @click="saveComposition(e.id)">Сохранить</button>
        </div>
      </template>
      <div class="muted" style="margin-top: 8px">
        Весы прислали только вес? Жир и мышцы с экрана приложения весов допишите здесь или ответом боту на
        сообщение о взвешивании.
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
.metric-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 12px;
}
.metric-head h3 {
  margin: 0;
}
.metric-now {
  font-family: var(--display);
  font-size: 20px;
  font-weight: 600;
  line-height: 1.15;
}
.metric-unit {
  margin-left: 4px;
  font-size: 13px;
  color: var(--hint);
}
/* сдвиги в ряд через тонкие линейки: число сверху, период подписью */
.shifts {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  margin-bottom: 8px;
}
.shift {
  padding: 0 8px;
  border-left: 1px solid var(--rule);
}
.shift:first-child {
  padding-left: 0;
  border-left: none;
}
.shift .v {
  font-family: var(--display);
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
}
.shift .v.good {
  color: var(--green);
}
.shift .v.bad {
  color: var(--red);
}
.shift .k {
  margin-top: 2px;
  font-size: 11px;
  color: var(--hint);
}
.comp {
  border: none;
  background: none;
  padding: 4px 0;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.comp.add {
  color: var(--link);
  font-weight: 600;
}
.comp-form {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 8px;
  align-items: end;
  padding: 4px 0 12px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.12);
}
.comp-form .field {
  margin-bottom: 0;
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
