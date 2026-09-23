<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../api';
import type { FitnessOverview, GoalType, MuscleUnit, Sex } from '../types';
import { haptic } from '../telegram';
import {
  GOAL_EMOJI,
  GOAL_LABEL,
  GOAL_METRIC,
  UNIT_LABEL,
  convertMuscle,
  errorText,
  formatNum,
  muscleUnitOf,
  numOrNull,
} from '../fitness';
import UnitToggle from './UnitToggle.vue';

const props = defineProps<{ challengeId: number; overview: FitnessOverview }>();
const emit = defineEmits<{ (e: 'saved', overview: FitnessOverview): void; (e: 'cancel'): void }>();

const goal = props.overview.goal;
const body = props.overview.bodyProfile;
/** Первое заполнение — анкета обязательна к прохождению, отмены нет. */
const isFirst = goal === null;

const str = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

const form = reactive({
  heightCm: str(body.heightCm),
  birthYear: str(body.birthYear),
  sex: (body.sex ?? '') as Sex | '',
  goalType: (goal?.goalType ?? 'lose_weight') as GoalType,
  startWeightKg: str(goal?.startWeightKg),
  startBodyFat: str(goal?.startBodyFat),
  startMuscle: str(goal?.startMuscle),
  // у сохранённой цели числа лежат в её единице — с неё и начинаем, а не с привычки из анкеты
  muscleUnit: goal?.muscleUnit ?? muscleUnitOf(props.overview),
  targetValue: str(goal?.targetValue),
  dailyKcalTarget: str(goal?.dailyKcalTarget),
  note: goal?.note ?? '',
});

const busy = ref(false);
const error = ref<string | null>(null);
const prefilled = ref(false);

const goalTypes = Object.keys(GOAL_LABEL) as GoalType[];
const metric = computed(() => GOAL_METRIC[form.goalType]);
const muscleUnitLabel = computed(() => UNIT_LABEL[form.muscleUnit]);

const targetLabel = computed(() => {
  if (metric.value === 'weightKg') return 'Целевой вес, кг';
  if (metric.value === 'bodyFat') return 'Целевой % жира';
  return `Целевые мышцы, ${muscleUnitLabel.value}`;
});

const targetPlaceholder = computed(() => {
  if (metric.value === 'weightKg') return 'например, 80';
  if (metric.value === 'bodyFat') return 'например, 18';
  return form.muscleUnit === 'kg' ? 'например, 36' : 'например, 42';
});

/** Точка, от которой считается цель, — из замеров выше. Цель задают, глядя на неё. */
const startHint = computed(() => {
  if (!metric.value) return null;
  const [raw, unit] =
    metric.value === 'weightKg'
      ? [form.startWeightKg, 'кг']
      : metric.value === 'bodyFat'
        ? [form.startBodyFat, '%']
        : [form.startMuscle, muscleUnitLabel.value];
  const value = numOrNull(raw);
  if (value === null) return { missing: true, text: 'Сначала заполните этот показатель в стартовых замерах выше.' };
  const direction = form.goalType === 'gain_muscle' ? 'цель должна быть выше' : 'цель должна быть ниже';
  return { missing: false, text: `Сейчас ${formatNum(value)} ${unit} — ${direction}.` };
});

/** Смена единицы пересчитывает уже введённое через стартовый вес, чтобы не вбивать заново. */
function setMuscleUnit(unit: MuscleUnit) {
  if (unit === form.muscleUnit) return;
  const weightKg = numOrNull(form.startWeightKg);
  const convert = (raw: string) => {
    const value = numOrNull(raw);
    if (value === null) return raw;
    // без веса пересчитать нечем: чужую единицу в поле не оставляем
    return weightKg ? String(convertMuscle(value, weightKg, unit)) : '';
  };
  form.startMuscle = convert(form.startMuscle);
  if (metric.value === 'muscle') form.targetValue = convert(form.targetValue);
  form.muscleUnit = unit;
}

/** У кого уже есть взвешивания (умные весы), тому стартовые замеры подставляем сами. */
onMounted(async () => {
  if (!isFirst) return;
  try {
    const latest = (await api.getWeight()).latest;
    if (!latest) return;
    form.startWeightKg = str(latest.weightKg);
    form.startBodyFat = str(latest.bodyFat);
    form.startMuscle = str(form.muscleUnit === 'kg' ? latest.muscleKg : latest.muscle);
    prefilled.value = true;
  } catch {
    /* без подстановки — не страшно, человек введёт сам */
  }
});

async function save() {
  if (busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    await api.saveBodyProfile({
      heightCm: numOrNull(form.heightCm),
      birthYear: numOrNull(form.birthYear),
      sex: form.sex || null,
      muscleUnit: form.muscleUnit,
    });
    const overview = await api.saveGoal(props.challengeId, {
      goalType: form.goalType,
      startWeightKg: numOrNull(form.startWeightKg),
      startBodyFat: numOrNull(form.startBodyFat),
      startMuscle: numOrNull(form.startMuscle),
      muscleUnit: form.muscleUnit,
      targetValue: metric.value ? numOrNull(form.targetValue) : null,
      dailyKcalTarget: numOrNull(form.dailyKcalTarget),
      note: form.note.trim() || null,
    });
    haptic('success');
    emit('saved', overview);
  } catch (e) {
    error.value = errorText(e);
    haptic('error');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <div v-if="isFirst" class="card">
      <h3>👋 Сначала — точка отсчёта</h3>
      <div class="muted">
        Запишите, с чем стартуете, и от этого выберите цель. Вес, состав тела и обхваты видите только
        вы — остальным участникам показывается лишь прогресс к цели в процентах.
      </div>
    </div>

    <div class="card">
      <h3>1. Стартовые замеры</h3>
      <div v-if="prefilled" class="muted" style="margin-bottom: 10px">
        Подставили ваше последнее взвешивание — поправьте, если нужно.
      </div>
      <label class="field">
        <span class="lbl" :class="{ req: metric === 'weightKg' }">Вес, кг</span>
        <input v-model="form.startWeightKg" inputmode="decimal" placeholder="85,4" />
      </label>
      <div class="two">
        <label class="field">
          <span class="lbl" :class="{ req: metric === 'bodyFat' }">Жир, %</span>
          <input v-model="form.startBodyFat" inputmode="decimal" placeholder="—" />
        </label>
        <label class="field">
          <span class="lbl" :class="{ req: metric === 'muscle' }">Мышцы, {{ muscleUnitLabel }}</span>
          <input v-model="form.startMuscle" inputmode="decimal" placeholder="—" />
        </label>
      </div>
      <UnitToggle :model-value="form.muscleUnit" label="Мышцы считать в" @update:model-value="setMuscleUnit" />
      <div class="muted">Жир и мышцы показывают умные весы. Нет весов — оставьте пустыми.</div>
    </div>

    <div class="card">
      <h3>2. Цель</h3>
      <div class="goal-types">
        <button
          v-for="t in goalTypes"
          :key="t"
          type="button"
          :class="{ active: form.goalType === t }"
          @click="form.goalType = t"
        >
          <span class="ico">{{ GOAL_EMOJI[t] }}</span>{{ GOAL_LABEL[t] }}
        </button>
      </div>

      <template v-if="metric">
        <label class="field" style="margin-bottom: 6px">
          <span class="lbl req">{{ targetLabel }}</span>
          <input v-model="form.targetValue" inputmode="decimal" :placeholder="targetPlaceholder" />
        </label>
        <div v-if="startHint" class="start-hint" :class="{ missing: startHint.missing }">{{ startHint.text }}</div>
      </template>
      <label class="field">
        <span class="lbl">{{ metric ? 'Комментарий (необязательно)' : 'Опишите свою цель' }}</span>
        <textarea v-model="form.note" maxlength="500" placeholder="Пробежать 10 км, влезть в костюм…" />
      </label>
    </div>

    <div class="card">
      <h3>3. О себе</h3>
      <div class="muted" style="margin-bottom: 10px">
        Нужно для расчёта базового обмена и баланса калорий. Можно заполнить позже.
      </div>
      <div class="two">
        <label class="field">
          <span class="lbl">Рост, см</span>
          <input v-model="form.heightCm" inputmode="decimal" placeholder="180" />
        </label>
        <label class="field">
          <span class="lbl">Год рождения</span>
          <input v-model="form.birthYear" inputmode="numeric" placeholder="1990" />
        </label>
      </div>
      <label class="field">
        <span class="lbl">Пол</span>
        <select v-model="form.sex">
          <option value="">Не указан</option>
          <option value="male">Мужской</option>
          <option value="female">Женский</option>
        </select>
      </label>
      <label class="field">
        <span class="lbl">Дневная цель по калориям (необязательно)</span>
        <input v-model="form.dailyKcalTarget" inputmode="numeric" placeholder="2200" />
      </label>
    </div>

    <div v-if="error" class="error-text" style="margin: 0 4px 10px">{{ error }}</div>
    <button class="btn" :disabled="busy" @click="save">
      {{ busy ? 'Сохраняем…' : isFirst ? 'Зафиксировать старт' : 'Сохранить' }}
    </button>
    <button v-if="!isFirst" class="btn secondary" style="margin-top: 8px" :disabled="busy" @click="emit('cancel')">
      Отмена
    </button>
  </div>
</template>

<style scoped>
.goal-types {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-bottom: 14px;
}
.goal-types button {
  border: 1.5px solid rgba(128, 128, 128, 0.25);
  background: var(--bg);
  color: var(--text);
  border-radius: 12px;
  padding: 12px 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.goal-types button.active {
  border-color: var(--button);
  background: rgba(47, 111, 235, 0.1);
}
.goal-types .ico {
  font-size: 22px;
}
.two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.start-hint {
  font-size: 13px;
  color: var(--hint);
  margin-bottom: 12px;
}
.start-hint.missing {
  color: var(--red);
}
</style>
