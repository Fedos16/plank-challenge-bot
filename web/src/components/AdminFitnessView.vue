<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../api';
import type {
  AdminChallengeRow,
  AdminFitnessChallenge,
  AdminFitnessParticipant,
  AdminWeekRow,
  Workout,
} from '../types';
import { confirmAction, haptic } from '../telegram';
import { formatDateRu, formatDateTimeRu, todayISO } from '../helpers';
import {
  GOAL_EMOJI,
  GOAL_LABEL,
  SOURCE_LABEL,
  UNIT_LABEL,
  VERDICT_LABEL,
  errorText,
  formatNum,
  hearts,
  sportTitle,
} from '../fitness';

const challenges = ref<AdminChallengeRow[]>([]);
const selectedId = ref<number | null>(null);
const settings = ref<AdminFitnessChallenge | null>(null);
/** Длительность в форме — строка: пустое поле означает бессрочный челлендж. */
const duration = ref('');
const people = ref<AdminFitnessParticipant[]>([]);
const creating = ref(false);
const loading = ref(true);

const draft = reactive({
  title: '',
  startDate: todayISO(),
  durationDays: '100',
  weeklyWorkouts: 3,
  lives: 3,
  minWorkoutMin: 20,
});

const toast = ref<string | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function showToast(msg: string, ok = true) {
  // пустое сообщение — тихий успех: действие было загрузкой, хвалить за неё незачем
  if (!msg) return;
  toast.value = msg;
  haptic(ok ? 'success' : 'error');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = null), 2600);
}
async function run(fn: () => Promise<void>, okMsg = 'Сохранено') {
  try {
    await fn();
    showToast(okMsg);
  } catch (e) {
    showToast(errorText(e), false);
  }
}

const fitness = computed(() => challenges.value.filter((c) => c.kind === 'fitness'));

async function loadList() {
  challenges.value = (await api.adminListChallenges()).rows;
}

async function select(id: number) {
  selectedId.value = id;
  creating.value = false;
  section.value = 'settings';
  moderating.value = null;
  weeks.value = [];
  const [s, p] = await Promise.all([api.adminGetFitness(id), api.adminFitnessParticipants(id)]);
  settings.value = s;
  duration.value = s.durationDays === null ? '' : String(s.durationDays);
  people.value = p.rows;
}

function timelineText(c: AdminChallengeRow): string {
  if (c.phase === 'upcoming') return `старт ${formatDateRu(c.startDate)}`;
  if (c.phase === 'finished') return 'завершён';
  return c.daysTotal ? `день ${c.dayNumber} из ${c.daysTotal}` : `день ${c.dayNumber}`;
}

async function create() {
  await run(async () => {
    const created = await api.adminCreateFitness({
      title: draft.title,
      startDate: draft.startDate,
      durationDays: draft.durationDays === '' ? '' : Number(draft.durationDays),
      weeklyWorkouts: draft.weeklyWorkouts,
      lives: draft.lives,
      minWorkoutMin: draft.minWorkoutMin,
    });
    draft.title = '';
    await loadList();
    await select(created.id);
  }, 'Челлендж создан');
}

async function save() {
  const s = settings.value;
  if (!s) return;
  await run(async () => {
    settings.value = await api.adminUpdateFitness(s.id, {
      title: s.title,
      description: s.description,
      rulesText: s.rulesText,
      timezone: s.timezone,
      startDate: s.startDate,
      durationDays: duration.value === '' ? '' : Number(duration.value),
      weeklyWorkouts: s.weeklyWorkouts,
      lives: s.lives,
      minWorkoutMin: s.minWorkoutMin,
      maxWorkoutsPerDay: s.maxWorkoutsPerDay,
      weekCloseTime: s.weekCloseTime,
      chatId: s.chatId,
      joinOpen: s.joinOpen,
      isActive: s.isActive,
    });
    await loadList();
  });
}

async function setStatus(p: AdminFitnessParticipant, status: 'active' | 'left') {
  if (status === 'left' && !(await confirmAction(`Убрать ${p.name} из челленджа? Данные сохранятся.`))) return;
  await run(async () => {
    await api.adminUpdateParticipant(p.participationId, { status });
    if (selectedId.value) people.value = (await api.adminFitnessParticipants(selectedId.value)).rows;
    await loadList();
  }, status === 'left' ? 'Участник убран' : 'Участник возвращён');
}

// ---- Недели, жизни, модерация ----
type Section = 'settings' | 'people' | 'weeks';
const section = ref<Section>('settings');
const weeks = ref<{ weekNumber: number; rows: AdminWeekRow[] }[]>([]);
/** Чьи тренировки сейчас раскрыты для модерации. */
const moderating = ref<number | null>(null);
const moderated = ref<Workout[]>([]);

async function reloadGame() {
  const id = selectedId.value;
  if (!id) return;
  const [p, w] = await Promise.all([api.adminFitnessParticipants(id), api.adminFitnessWeeks(id)]);
  people.value = p.rows;
  weeks.value = w.weeks;
}

async function openSection(s: Section) {
  section.value = s;
  if (s !== 'settings') await run(reloadGame, '');
}

async function evaluateNow() {
  const id = selectedId.value;
  if (!id) return;
  try {
    const res = await api.adminEvaluate(id);
    await reloadGame();
    showToast(res.created ? `Подведено итогов: ${res.created}` : 'Новых закрытых недель нет');
  } catch (e) {
    showToast(errorText(e), false);
  }
}

async function weekAction(row: AdminWeekRow, action: 'forgive' | 'unforgive' | 'recalc') {
  const id = selectedId.value;
  if (!id) return;
  const question =
    action === 'forgive'
      ? `Простить ${row.name} неделю ${row.weekNumber}? Жизнь за неё не снимется.`
      : action === 'unforgive'
        ? `Отменить прощение недели ${row.weekNumber} для ${row.name}?`
        : `Пересчитать неделю ${row.weekNumber} для ${row.name} по текущим тренировкам?`;
  if (!(await confirmAction(question))) return;
  await run(async () => {
    await api.adminWeekAction(id, row.id, action);
    await reloadGame();
  }, action === 'recalc' ? 'Пересчитано' : 'Сохранено');
}

async function reinstate(p: AdminFitnessParticipant) {
  const id = selectedId.value;
  if (!id) return;
  if (!(await confirmAction(`Вернуть ${p.name} в игру? Неделя выбывания и провалы после неё будут прощены.`))) return;
  await run(async () => {
    await api.adminReinstate(id, p.participationId);
    await reloadGame();
  }, 'Участник снова в игре');
}

async function toggleModeration(p: AdminFitnessParticipant) {
  const id = selectedId.value;
  if (!id) return;
  if (moderating.value === p.participationId) {
    moderating.value = null;
    return;
  }
  await run(async () => {
    moderated.value = (await api.adminParticipantWorkouts(id, p.participationId)).workouts;
    moderating.value = p.participationId;
  }, '');
}

async function setExcluded(p: AdminFitnessParticipant, w: Workout, excluded: boolean) {
  const id = selectedId.value;
  if (!id) return;
  await run(async () => {
    await api.adminExcludeWorkout(id, w.id, excluded);
    moderated.value = (await api.adminParticipantWorkouts(id, p.participationId)).workouts;
    await reloadGame();
  }, excluded ? 'Снята с зачёта' : 'Возвращена в зачёт');
}

function progressText(p: AdminFitnessParticipant): string {
  const g = p.progress;
  if (!g?.unit) return '';
  const unit = UNIT_LABEL[g.unit];
  const v = (n: number | null) => (n === null ? '—' : formatNum(n));
  return `${v(g.start)} → ${v(g.current)} → ${v(g.target)} ${unit}`;
}

onMounted(async () => {
  try {
    await loadList();
    const first = fitness.value[0];
    if (first) await select(first.id);
    else creating.value = true;
  } catch (e) {
    showToast(errorText(e), false);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div v-if="loading" class="center">Загрузка…</div>

  <div v-else>
    <!-- Список фитнес-челленджей: их может быть несколько, в отличие от планки -->
    <div class="card">
      <h3>Фитнес-челленджи</h3>
      <div
        v-for="c in fitness"
        :key="c.id"
        class="row pick"
        :class="{ current: c.id === selectedId && !creating }"
        @click="select(c.id)"
      >
        <div class="name">{{ c.isActive ? '🏋️' : '💤' }} {{ c.title }}</div>
        <div class="meta">{{ timelineText(c) }} · {{ c.participants }} уч.</div>
      </div>
      <div v-if="!fitness.length" class="muted" style="margin-bottom: 10px">Пока ни одного — создайте первый.</div>
      <button class="btn secondary" style="margin-top: 10px" @click="creating = !creating">
        {{ creating ? 'Отмена' : '➕ Новый челлендж' }}
      </button>
    </div>

    <!-- Создание -->
    <div v-if="creating" class="card">
      <h3>Новый челлендж</h3>
      <label class="field"><span class="lbl">Название</span><input v-model="draft.title" placeholder="100 дней формы" /></label>
      <label class="field"><span class="lbl">Дата старта</span><input type="date" v-model="draft.startDate" /></label>
      <label class="field">
        <span class="lbl">Длительность, дней (пусто — бессрочный)</span>
        <input v-model="draft.durationDays" inputmode="numeric" />
      </label>
      <label class="field">
        <span class="lbl">Обязательных тренировок в неделю</span>
        <input type="number" min="1" max="7" v-model.number="draft.weeklyWorkouts" />
      </label>
      <label class="field">
        <span class="lbl">Жизней</span>
        <input type="number" min="1" max="9" v-model.number="draft.lives" />
      </label>
      <label class="field">
        <span class="lbl">Тренировка идёт в зачёт от, минут</span>
        <input type="number" min="1" v-model.number="draft.minWorkoutMin" />
      </label>
      <button class="btn" @click="create">Создать</button>
    </div>

    <!-- Настройки выбранного -->
    <template v-else-if="settings">
      <div class="subtabs">
        <button :class="{ active: section === 'settings' }" @click="openSection('settings')">Настройки</button>
        <button :class="{ active: section === 'people' }" @click="openSection('people')">Участники</button>
        <button :class="{ active: section === 'weeks' }" @click="openSection('weeks')">Недели</button>
      </div>

      <div v-if="section === 'settings'" class="card">
        <h3>Настройки</h3>
        <label class="field"><span class="lbl">Название</span><input v-model="settings.title" /></label>
        <label class="field"><span class="lbl">Описание</span><textarea v-model="settings.description" /></label>
        <label class="field"><span class="lbl">Текст правил</span><textarea v-model="settings.rulesText" style="min-height: 120px" /></label>
        <label class="field"><span class="lbl">Дата старта</span><input type="date" v-model="settings.startDate" /></label>
        <label class="field">
          <span class="lbl">Длительность, дней (пусто — бессрочный)</span>
          <input v-model="duration" inputmode="numeric" />
        </label>
        <div v-if="settings.endDate" class="muted" style="margin: -4px 0 12px">
          Последний день — {{ formatDateRu(settings.endDate) }}. Недели считаются 7-дневками от даты старта;
          на неполную последнюю неделю норма пропорционально меньше.
        </div>
        <label class="field">
          <span class="lbl">Обязательных тренировок в неделю</span>
          <input type="number" min="1" max="7" v-model.number="settings.weeklyWorkouts" />
        </label>
        <label class="field">
          <span class="lbl">❤️ Жизней (проваленная неделя снимает одну)</span>
          <input type="number" min="1" max="9" v-model.number="settings.lives" />
        </label>
        <label class="field">
          <span class="lbl">Тренировка идёт в зачёт от, минут</span>
          <input type="number" min="1" v-model.number="settings.minWorkoutMin" />
        </label>
        <label class="field">
          <span class="lbl">Сколько тренировок одного дня идёт в зачёт</span>
          <input type="number" min="1" max="3" v-model.number="settings.maxWorkoutsPerDay" />
        </label>
        <label class="field">
          <span class="lbl">Итог недели — на следующий день в (HH:mm)</span>
          <input v-model="settings.weekCloseTime" />
        </label>
        <div class="muted" style="margin: -4px 0 12px">
          Зазор после конца недели нужен, чтобы вечерняя тренировка успела досинхронизироваться с часов.
        </div>
        <label class="field"><span class="lbl">Часовой пояс</span><input v-model="settings.timezone" /></label>
        <label class="field"><span class="lbl">ID чата для сообщений</span><input v-model="settings.chatId" placeholder="напр. -1001234567890" /></label>
        <label class="field check">
          <input type="checkbox" v-model="settings.joinOpen" />
          <span class="lbl">Набор открыт — челлендж виден в «Ещё доступно»</span>
        </label>
        <label class="field check">
          <input type="checkbox" v-model="settings.isActive" />
          <span class="lbl">Челлендж активен</span>
        </label>
        <button class="btn" @click="save">Сохранить</button>
      </div>

      <div v-else-if="section === 'people'" class="card">
        <h3>Участники · {{ people.filter((p) => p.status === 'active').length }}</h3>
        <div v-for="p in people" :key="p.participationId" class="person">
          <div class="list-item">
            <div class="grow">
              <div style="font-weight: 600">
                {{ p.goalType ? GOAL_EMOJI[p.goalType] : '⏳' }} {{ p.name }}
                <span v-if="p.status !== 'active'" class="muted">· вышел</span>
              </div>
              <div class="muted">
                {{ hearts(p.lives.left, p.lives.total) }}
                <template v-if="p.lives.eliminated"> · выбыл на неделе {{ p.lives.eliminatedAtWeekNumber }}</template>
                <template v-else-if="p.week"> · {{ p.week.done }} из {{ p.week.required }} на неделе</template>
                · всего {{ p.totalCounted }}
              </div>
              <div class="muted">
                {{ p.goalType ? GOAL_LABEL[p.goalType] : 'цель не выбрана' }}
                <template v-if="typeof p.progress?.percent === 'number'"> · {{ p.progress.percent }}%</template>
                <template v-if="progressText(p)"> · {{ progressText(p) }}</template>
              </div>
            </div>
          </div>
          <div class="inline-actions">
            <button class="btn small secondary" @click="toggleModeration(p)">
              {{ moderating === p.participationId ? 'Скрыть тренировки' : 'Тренировки' }}
            </button>
            <button v-if="p.lives.eliminated" class="btn small" @click="reinstate(p)">Вернуть в игру</button>
            <button v-if="p.status === 'active'" class="btn small secondary" @click="setStatus(p, 'left')">Убрать</button>
            <button v-else class="btn small secondary" @click="setStatus(p, 'active')">Вернуть в челлендж</button>
          </div>

          <!-- Модерация: снять тренировку с зачёта — как «фейк» в планке -->
          <div v-if="moderating === p.participationId" class="moderation">
            <div v-for="w in moderated" :key="w.id" class="list-item">
              <div class="grow">
                <div>{{ sportTitle(w) }} · {{ w.durationMin }} мин <span class="muted">· {{ VERDICT_LABEL[w.verdict] }}</span></div>
                <div class="muted">{{ formatDateTimeRu(w.startedAt) }} · {{ SOURCE_LABEL[w.source] ?? w.source }}</div>
              </div>
              <button v-if="w.verdict !== 'excluded'" class="btn small secondary" @click="setExcluded(p, w, true)">Снять</button>
              <button v-else class="btn small" @click="setExcluded(p, w, false)">Вернуть</button>
            </div>
            <div v-if="!moderated.length" class="muted">Тренировок нет.</div>
            <div class="muted" style="margin-top: 6px">
              Уже закрытую неделю снятие само не меняет — после него нажмите «Пересчитать» в разделе «Недели».
            </div>
          </div>
        </div>
        <div v-if="!people.length" class="muted">Пока никто не вступил.</div>
      </div>

      <template v-else>
        <div class="card">
          <h3>Итоги недель</h3>
          <div class="muted" style="margin-bottom: 10px">
            Итог подводится сам — на следующий день после конца недели в {{ settings.weekCloseTime }}.
            Кнопка нужна, если не хочется ждать ближайшего прохода планировщика.
          </div>
          <button class="btn secondary" @click="evaluateNow">Подвести итоги сейчас</button>
        </div>

        <div v-for="week in weeks" :key="week.weekNumber" class="card">
          <h3>Неделя {{ week.weekNumber }}</h3>
          <div v-for="r in week.rows" :key="r.id" class="person">
            <div class="list-item">
              <div class="grow">
                <div style="font-weight: 600">{{ r.name }}</div>
                <div class="muted">
                  {{ r.done }} из {{ r.required }} ·
                  <template v-if="r.outOfGame">вне зачёта</template>
                  <template v-else-if="r.status === 'passed'">✅ закрыта</template>
                  <template v-else-if="r.status === 'forgiven'">🤝 прощена{{ r.forgivenNote ? ` — ${r.forgivenNote}` : '' }}</template>
                  <template v-else>💔 минус жизнь</template>
                  <template v-if="r.upgraded"> · исправлена синхронизацией</template>
                </div>
              </div>
            </div>
            <div class="inline-actions">
              <button v-if="r.status === 'failed'" class="btn small" @click="weekAction(r, 'forgive')">Простить</button>
              <button v-if="r.status === 'forgiven'" class="btn small secondary" @click="weekAction(r, 'unforgive')">Отменить прощение</button>
              <button class="btn small secondary" @click="weekAction(r, 'recalc')">Пересчитать</button>
            </div>
          </div>
        </div>
        <div v-if="!weeks.length" class="card"><div class="muted">Закрытых недель пока нет.</div></div>
      </template>
    </template>

    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>

<style scoped>
.pick {
  cursor: pointer;
}
.pick.current .name {
  color: var(--link);
}
.person {
  padding-bottom: 10px;
  margin-bottom: 4px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.12);
}
.person:last-child {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}
.person .list-item {
  border-bottom: none;
  padding-bottom: 6px;
}
.moderation {
  margin-top: 8px;
  padding: 4px 10px 8px;
  border-radius: 10px;
  background: var(--bg);
}
label.field.check {
  display: flex;
  align-items: center;
  gap: 10px;
}
label.field.check input {
  width: auto;
}
label.field.check .lbl {
  margin: 0;
}
</style>
