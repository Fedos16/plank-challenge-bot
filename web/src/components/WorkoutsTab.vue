<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../api';
import type { FitnessOverview, Workout } from '../types';
import { confirmAction, haptic } from '../telegram';
import { daysBetweenISO, formatDateRu, formatTimeRu } from '../helpers';
import {
  SOURCE_LABEL,
  SPORT_EMOJI,
  SPORT_LABEL,
  VERDICT_LABEL,
  errorText,
  newClientId,
  numOrNull,
  sportTitle,
} from '../fitness';

const props = defineProps<{ challengeId: number; overview: FitnessOverview }>();
/** Новая тренировка меняет прогресс недели — родитель перечитывает сводку. */
const emit = defineEmits<{ (e: 'changed'): void }>();

const workouts = ref<Workout[]>([]);
const sports = ref<string[]>(Object.keys(SPORT_LABEL));
const loading = ref(true);
const busy = ref(false);
const error = ref<string | null>(null);

const pad = (n: number) => String(n).padStart(2, '0');
function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function blankForm() {
  const now = new Date();
  return {
    // один id на одну форму: повторная отправка на плохой сети не создаст вторую запись
    clientId: newClientId(),
    sport: 'strength',
    date: localDate(now),
    time: `${pad(now.getHours())}:00`,
    durationMin: '',
    kcal: '',
    note: '',
  };
}
const form = reactive(blankForm());

async function load() {
  try {
    const res = await api.getFitnessWorkouts(props.challengeId);
    workouts.value = res.workouts;
    sports.value = res.sports;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}

/** День тренировки в поясе челленджа — по нему она попадает в неделю. */
function challengeDay(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: props.overview.challenge.timezone });
}

interface WeekGroup {
  weekNumber: number;
  summary: string;
  items: Workout[];
}

/** Журнал по неделям челленджа, от свежих к старым; у недели — её итог, если он уже есть. */
const groups = computed<WeekGroup[]>(() => {
  const start = props.overview.challenge.startDate;
  const game = props.overview.game;
  const byWeek = new Map<number, Workout[]>();
  for (const w of workouts.value) {
    const day = challengeDay(w.startedAt);
    const weekNumber = day < start ? 0 : Math.floor(daysBetweenISO(start, day) / 7) + 1;
    byWeek.set(weekNumber, [...(byWeek.get(weekNumber) ?? []), w]);
  }

  return [...byWeek.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([weekNumber, items]) => {
      const closed = game.history.find((h) => h.weekNumber === weekNumber);
      const current = game.currentWeek?.weekNumber === weekNumber ? game.currentWeek : null;
      let summary = '';
      if (closed) {
        const mark = closed.status === 'passed' ? '✅' : closed.status === 'forgiven' ? '🤝' : '💔';
        summary = `${mark} ${closed.done} из ${closed.required}`;
      } else if (current) {
        summary = `${current.done} из ${current.required}`;
      }
      return { weekNumber, summary, items };
    });
});

function meta(w: Workout): string {
  const parts = [`${w.durationMin} мин`];
  if (w.kcal) parts.push(`${w.kcal} ккал`);
  if (w.distanceM) parts.push(`${(w.distanceM / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} км`);
  parts.push(SOURCE_LABEL[w.source] ?? w.source);
  return parts.join(' · ');
}

async function add() {
  const durationMin = numOrNull(form.durationMin);
  if (durationMin === null) {
    error.value = 'Введите длительность в минутах';
    return;
  }
  if (busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    await api.addWorkout({
      clientId: form.clientId,
      sport: form.sport,
      startedAt: new Date(`${form.date}T${form.time || '12:00'}`).toISOString(),
      durationMin,
      kcal: numOrNull(form.kcal),
      note: form.note.trim() || null,
      tzOffsetMin: -new Date().getTimezoneOffset(),
    });
    Object.assign(form, blankForm(), { sport: form.sport });
    haptic('success');
    await load();
    emit('changed');
  } catch (e) {
    error.value = errorText(e);
    haptic('error');
  } finally {
    busy.value = false;
  }
}

async function remove(w: Workout) {
  if (!(await confirmAction(`Удалить тренировку «${sportTitle(w)}» от ${formatDateRu(challengeDay(w.startedAt))}?`))) return;
  if (busy.value) return;
  busy.value = true;
  try {
    await api.deleteWorkout(w.id);
    await load();
    emit('changed');
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div v-if="loading" class="center">Загрузка…</div>

  <template v-else>
    <div class="card">
      <h3>➕ Записать тренировку</h3>
      <label class="field">
        <span class="lbl">Вид</span>
        <select v-model="form.sport">
          <option v-for="s in sports" :key="s" :value="s">{{ SPORT_EMOJI[s] ?? '💪' }} {{ SPORT_LABEL[s] ?? s }}</option>
        </select>
      </label>
      <div class="two">
        <label class="field"><span class="lbl">Дата</span><input v-model="form.date" type="date" :max="localDate(new Date())" /></label>
        <label class="field"><span class="lbl">Начало</span><input v-model="form.time" type="time" /></label>
      </div>
      <div class="two">
        <label class="field">
          <span class="lbl">Длительность, мин</span>
          <input v-model="form.durationMin" inputmode="numeric" placeholder="45" @keyup.enter="add" />
        </label>
        <label class="field">
          <span class="lbl">Калории (необязательно)</span>
          <input v-model="form.kcal" inputmode="numeric" placeholder="—" @keyup.enter="add" />
        </label>
      </div>
      <label class="field">
        <span class="lbl">Заметка (видите только вы)</span>
        <input v-model="form.note" maxlength="300" placeholder="Ноги, присед 5×5" />
      </label>
      <div v-if="error" class="error-text" style="margin-bottom: 10px">{{ error }}</div>
      <button class="btn" :disabled="busy" @click="add">{{ busy ? 'Сохраняем…' : 'Записать' }}</button>
      <div class="muted" style="margin-top: 8px">
        В зачёт недели идёт тренировка от {{ overview.settings.minWorkoutMin }} мин, не больше
        {{ overview.settings.maxWorkoutsPerDay }} в день. Остальные остаются в журнале и дают калории.
      </div>
    </div>

    <div v-for="g in groups" :key="g.weekNumber" class="card">
      <div class="week-head">
        <h3>{{ g.weekNumber > 0 ? `Неделя ${g.weekNumber}` : 'До старта' }}</h3>
        <span class="muted">{{ g.summary }}</span>
      </div>
      <div v-for="w in g.items" :key="w.id" class="workout">
        <div class="ico">{{ SPORT_EMOJI[w.sport] ?? '💪' }}</div>
        <div class="grow">
          <div class="title">
            {{ sportTitle(w) }}
            <span class="verdict" :class="w.verdict">{{ VERDICT_LABEL[w.verdict] }}</span>
          </div>
          <div class="muted">
            {{ formatDateRu(challengeDay(w.startedAt)) }}, {{ formatTimeRu(w.startedAt) }} · {{ meta(w) }}
          </div>
          <div v-if="w.note" class="muted">{{ w.note }}</div>
          <div v-if="w.excludedNote" class="muted">Админ: {{ w.excludedNote }}</div>
        </div>
        <button class="row-x" :disabled="busy" @click="remove(w)">✕</button>
      </div>
    </div>

    <div v-if="!groups.length" class="card">
      <div class="muted">Тренировок пока нет. Запишите первую — она пойдёт в зачёт текущей недели.</div>
    </div>
  </template>
</template>

<style scoped>
.two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.week-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.workout {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid rgba(128, 128, 128, 0.12);
}
.workout:last-child {
  border-bottom: none;
  padding-bottom: 0;
}
.workout .ico {
  font-size: 22px;
  line-height: 1.2;
}
.workout .grow {
  flex: 1;
  min-width: 0;
}
.workout .title {
  font-weight: 600;
}
.verdict {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  vertical-align: middle;
  background: rgba(128, 128, 128, 0.15);
  color: var(--hint);
}
.verdict.counted {
  background: rgba(46, 204, 113, 0.15);
  color: var(--green);
}
.verdict.excluded {
  background: rgba(231, 76, 60, 0.15);
  color: var(--red);
}
.row-x {
  border: none;
  background: none;
  color: var(--red);
  cursor: pointer;
  font-size: 13px;
  padding: 2px 0 0 6px;
}
</style>
