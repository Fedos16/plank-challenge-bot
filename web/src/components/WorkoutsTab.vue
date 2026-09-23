<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../api';
import type { FitnessOverview, WeekDay, Workout } from '../types';
import { confirmAction, haptic } from '../telegram';
import { formatDateRu, formatDayHumanRu, formatTimeRu, todayInZone } from '../helpers';
import WeekStrip from './WeekStrip.vue';
import {
  SPORT_EMOJI,
  SPORT_LABEL,
  VERDICT_LABEL,
  challengeDay as dayInTz,
  errorText,
  groupWorkoutsByWeek,
  newClientId,
  numOrNull,
  partsLabel,
  sportTitle,
  toWorkoutRows,
  weekSummary,
  workoutMeta,
  type WorkoutRow,
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
  return dayInTz(iso, props.overview.challenge.timezone);
}

const today = computed(() => todayInZone(props.overview.challenge.timezone));

/** Журнал по неделям челленджа, от свежих к старым; у недели — её итог, если он уже есть. */
const groups = computed(() => {
  const { startDate, timezone } = props.overview.challenge;
  const game = props.overview.game;
  // занятие — одна строка, как в ленте: часы режут тренировку по видам, а засчитывается она целиком
  return groupWorkoutsByWeek(toWorkoutRows(workouts.value), startDate, timezone).map((g) => {
    const closed = game.history.find((h) => h.weekNumber === g.weekNumber);
    const current = game.currentWeek?.weekNumber === g.weekNumber ? game.currentWeek : null;
    // полоска недели; null — до старта или неделя без итога
    const days: WeekDay[] | null = closed ? (closed.days.length ? closed.days : null) : (current?.days ?? null);
    return { ...g, summary: weekSummary(closed, current), days };
  });
});

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

/** Какое занятие раскрыто на части: удалить можно и одну часть — например, ходьбу до зала. */
const openKey = ref<number | null>(null);

async function remove(r: WorkoutRow) {
  const n = r.items.length;
  const what = n > 1 ? `занятие «${r.title}» (${n} ${n < 5 ? 'записи' : 'записей'})` : `тренировку «${r.title}»`;
  if (!(await confirmAction(`Удалить ${what} от ${formatDateRu(challengeDay(r.startedAt))}?`))) return;
  await deleteItems(r.items);
}

async function removePart(w: Workout) {
  const what = `«${sportTitle(w)}» ${formatTimeRu(w.startedAt)}, ${w.durationMin} мин`;
  if (!(await confirmAction(`Удалить из занятия только ${what}? Остальные части останутся.`))) return;
  await deleteItems([w]);
}

async function deleteItems(items: Workout[]) {
  if (busy.value) return;
  busy.value = true;
  try {
    for (const w of items) await api.deleteWorkout(w.id);
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
        <span class="lbl req">Вид</span>
        <select v-model="form.sport">
          <option v-for="s in sports" :key="s" :value="s">{{ SPORT_EMOJI[s] ?? '💪' }} {{ SPORT_LABEL[s] ?? s }}</option>
        </select>
      </label>
      <div class="two">
        <label class="field"><span class="lbl req">Дата</span><input v-model="form.date" type="date" :max="localDate(new Date())" /></label>
        <label class="field"><span class="lbl">Начало</span><input v-model="form.time" type="time" /></label>
      </div>
      <div class="two">
        <label class="field">
          <span class="lbl req">Длительность, мин</span>
          <input v-model="form.durationMin" inputmode="numeric" placeholder="45" @keyup.enter="add" />
        </label>
        <label class="field">
          <span class="lbl">Калории</span>
          <input v-model="form.kcal" inputmode="numeric" placeholder="необязательно" @keyup.enter="add" />
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
        <div>
          <h3>{{ g.weekNumber > 0 ? `Неделя ${g.weekNumber}` : 'До старта' }}</h3>
          <div v-if="g.summary" class="muted">{{ g.summary }}</div>
        </div>
        <WeekStrip v-if="g.days" :days="g.days" tone="card" size="sm" />
      </div>
      <div v-for="w in g.items" :key="w.key" class="workout">
        <div class="ico">{{ SPORT_EMOJI[w.sport] ?? '💪' }}</div>
        <div class="grow">
          <div class="title">
            {{ w.title }}
            <span class="verdict" :class="w.verdict">{{ VERDICT_LABEL[w.verdict] }}</span>
          </div>
          <div class="muted">
            {{ formatDayHumanRu(challengeDay(w.startedAt), today) }}, {{ formatTimeRu(w.startedAt) }} · {{ workoutMeta(w) }}
          </div>
          <button v-if="w.items.length > 1" class="parts-toggle" @click="openKey = openKey === w.key ? null : w.key">
            {{ partsLabel(w.items.length) }} {{ openKey === w.key ? '▴' : '▾' }}
          </button>
          <div v-if="openKey === w.key" class="parts">
            <div v-for="p in w.items" :key="p.id" class="part">
              <span class="grow">{{ SPORT_EMOJI[p.sport] ?? '💪' }} {{ sportTitle(p) }} · {{ p.durationMin }} мин</span>
              <span class="muted">{{ formatTimeRu(p.startedAt) }}</span>
              <button class="row-x" :disabled="busy" @click="removePart(p)">✕</button>
            </div>
          </div>
          <div v-if="w.note" class="muted">{{ w.note }}</div>
          <div v-if="w.forceCounted" class="muted">
            Засчитана админом<template v-if="w.forceNote">: {{ w.forceNote }}</template>
          </div>
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
  /* поля в ряд по нижнему краю: длинная подпись на узком экране переносится и не должна их сдвигать */
  align-items: end;
}
.week-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}
.week-head h3 {
  margin: 0;
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
.row-x {
  border: none;
  background: none;
  color: var(--red);
  cursor: pointer;
  font-size: 13px;
  padding: 2px 0 0 6px;
}
</style>
