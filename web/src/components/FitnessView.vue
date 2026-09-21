<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../api';
import type { FitnessOverview } from '../types';
import { confirmAction, haptic } from '../telegram';
import { formatDateRu } from '../helpers';
import { GOAL_EMOJI, GOAL_LABEL, METRIC_UNIT, errorText, formatNum, hearts } from '../fitness';
import GoalOnboarding from './GoalOnboarding.vue';
import BodyTab from './BodyTab.vue';
import WorkoutsTab from './WorkoutsTab.vue';
import FitnessLeaderboard from './FitnessLeaderboard.vue';
import ConnectionsCard from './ConnectionsCard.vue';

const props = defineProps<{ challengeId: number }>();
const emit = defineEmits<{ (e: 'back'): void; (e: 'left'): void }>();

type Sub = 'overview' | 'workouts' | 'board' | 'body' | 'more';
const sub = ref<Sub>('overview');
const data = ref<FitnessOverview | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const editingGoal = ref(false);
const busy = ref(false);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    data.value = await api.getFitness(props.challengeId);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}

/** Тихое обновление без спиннера — после нового замера меняется прогресс к цели. */
async function refresh() {
  try {
    data.value = await api.getFitness(props.challengeId);
  } catch {
    /* сводка устареет до следующего открытия — не критично */
  }
}

function onGoalSaved(overview: FitnessOverview) {
  data.value = overview;
  editingGoal.value = false;
  sub.value = 'overview';
}

const subtitle = computed(() => {
  const ch = data.value?.challenge;
  if (!ch) return '';
  if (ch.phase === 'upcoming') return `Старт ${formatDateRu(ch.startDate)}`;
  const day = ch.daysTotal ? `День ${ch.dayNumber} из ${ch.daysTotal}` : `День ${ch.dayNumber}`;
  if (ch.phase === 'finished') return `Завершён · ${ch.daysTotal} дней`;
  const week = ch.weeksTotal ? `неделя ${ch.weekNumber} из ${ch.weeksTotal}` : `неделя ${ch.weekNumber}`;
  return `${day} · ${week}`;
});

/** Сколько челленджа позади, в процентах — для полоски времени. */
const timePercent = computed(() => {
  const ch = data.value?.challenge;
  if (!ch?.daysTotal) return null;
  return Math.round((ch.dayNumber / ch.daysTotal) * 100);
});

const unit = computed(() => {
  const metric = data.value?.progress?.metric;
  return metric ? METRIC_UNIT[metric] : '';
});

function withUnit(n: number | null): string {
  if (n === null) return '—';
  return `${formatNum(n)} ${unit.value}`.trim();
}

/** Сколько осталось до цели по модулю: «−4,2 кг» читается хуже, чем «ещё 4,2 кг». */
const remaining = computed(() => {
  const p = data.value?.progress;
  if (!p || p.current === null || p.target === null || p.start === null) return null;
  const left = p.target > p.start ? p.target - p.current : p.current - p.target;
  return Math.max(0, Math.round(left * 10) / 10);
});

/** Подпись под счётом недели: сколько осталось и сколько на это дней. */
const weekLabel = computed(() => {
  const week = data.value?.game.currentWeek;
  if (!week) return '';
  const left = week.required - week.done;
  if (left <= 0) return `неделя ${week.weekNumber} закрыта 🎉`;
  const daysLeft = week.days.filter((d) => d.inWindow && (d.isToday || d.isFuture)).length;
  const word = left === 1 ? 'тренировка' : left < 5 ? 'тренировки' : 'тренировок';
  return `неделя ${week.weekNumber} · ещё ${left} ${word} за ${daysLeft} дн.`;
});

async function toggleShare() {
  if (!data.value || busy.value) return;
  busy.value = true;
  try {
    data.value.bodyProfile = await api.saveBodyProfile({ shareBody: !data.value.bodyProfile.shareBody });
    haptic('success');
    await refresh();
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}

async function leave() {
  const ok = await confirmAction('Выйти из челленджа? Вес и замеры останутся, цель сохранится на случай возвращения.');
  if (!ok || busy.value) return;
  busy.value = true;
  try {
    await api.leaveChallenge(props.challengeId);
    emit('left');
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}

onMounted(load);
watch(() => props.challengeId, load);
</script>

<template>
  <div>
    <button class="back-link" @click="emit('back')">‹ К челленджам</button>

    <div v-if="loading" class="center">Загрузка…</div>
    <div v-else-if="!data" class="center">
      <div class="error-text">Не удалось загрузить челлендж.</div>
      <div class="muted">{{ error }}</div>
      <button class="btn small" @click="load">Повторить</button>
    </div>

    <template v-else>
      <div class="profile-head">
        <div class="avatar">🏋️</div>
        <div>
          <div class="profile-name">{{ data.challenge.title }}</div>
          <div class="muted">{{ subtitle }}</div>
        </div>
      </div>

      <!-- Без цели челлендж не начинается: сначала точка отсчёта -->
      <GoalOnboarding
        v-if="!data.goal || editingGoal"
        :challenge-id="challengeId"
        :overview="data"
        @saved="onGoalSaved"
        @cancel="editingGoal = false"
      />

      <template v-else>
        <div class="subtabs">
          <button :class="{ active: sub === 'overview' }" @click="sub = 'overview'">Обзор</button>
          <button :class="{ active: sub === 'workouts' }" @click="sub = 'workouts'">Тренировки</button>
          <button :class="{ active: sub === 'board' }" @click="sub = 'board'">Рейтинг</button>
          <button :class="{ active: sub === 'body' }" @click="sub = 'body'">Тело</button>
          <button :class="{ active: sub === 'more' }" @click="sub = 'more'">Ещё</button>
        </div>

        <!-- ОБЗОР -->
        <template v-if="sub === 'overview'">
          <div v-if="data.game.lives.eliminated" class="card out-banner">
            <b>☠️ Вы выбыли из зачёта</b> на неделе {{ data.game.lives.eliminatedAtWeekNumber }}.
            Тренировки, вес и замеры можно вести дальше — просто вне зачёта.
          </div>

          <!-- Игра: жизни и норма текущей недели -->
          <div class="streak-hero" :class="{ out: data.game.lives.eliminated }">
            <div class="hero-lives">{{ hearts(data.game.lives.left, data.game.lives.total) }}</div>
            <template v-if="data.game.currentWeek">
              <div class="num">{{ data.game.currentWeek.done }} из {{ data.game.currentWeek.required }}</div>
              <div class="lbl">{{ weekLabel }}</div>
              <div class="days">
                <span
                  v-for="d in data.game.currentWeek.days"
                  :key="d.day"
                  class="day"
                  :class="{ done: d.count > 0, today: d.isToday, off: !d.inWindow }"
                  :title="formatDateRu(d.day)"
                >{{ d.count > 0 ? '✓' : '' }}</span>
              </div>
            </template>
            <div v-else class="lbl">
              {{ data.challenge.phase === 'upcoming' ? 'Челлендж ещё не начался' : 'Челлендж завершён' }}
            </div>
          </div>

          <button
            v-if="data.game.currentWeek"
            class="btn"
            style="margin-bottom: 12px"
            @click="sub = 'workouts'"
          >
            ➕ Записать тренировку
          </button>

          <!-- Личная цель -->
          <div class="card">
            <div class="bar-head">
              <span class="person-name">{{ GOAL_EMOJI[data.goal.goalType] }} {{ GOAL_LABEL[data.goal.goalType] }}</span>
              <span v-if="typeof data.progress?.percent === 'number'" class="fire">{{ data.progress.percent }}%</span>
            </div>
            <div v-if="typeof data.progress?.percent === 'number'" class="bar">
              <div class="bar-fill" :style="{ width: data.progress.percent + '%' }" />
            </div>
            <div v-if="data.goal.note" class="muted" style="margin-top: 6px">{{ data.goal.note }}</div>
          </div>

          <div v-if="data.progress?.metric" class="stats-grid" style="margin-bottom: 12px">
            <div class="stat">
              <div class="v">{{ withUnit(data.progress.start) }}</div>
              <div class="k">Старт · {{ data.goal.startDay ? formatDateRu(data.goal.startDay) : '' }}</div>
            </div>
            <div class="stat">
              <div class="v">{{ withUnit(data.progress.current) }}</div>
              <div class="k">Сейчас</div>
            </div>
            <div class="stat">
              <div class="v">{{ withUnit(data.progress.target) }}</div>
              <div class="k">Цель</div>
            </div>
            <div class="stat">
              <div class="v">{{ withUnit(remaining) }}</div>
              <div class="k">Осталось</div>
            </div>
          </div>

          <div v-if="data.progress?.metric && data.progress.current === null" class="card">
            <div class="muted">
              Нет замеров по показателю цели. Запишите вес на вкладке «Тело» — появится прогресс.
            </div>
          </div>

          <div v-if="timePercent !== null" class="card">
            <div class="bar-head">
              <span>Время челленджа</span>
              <span class="muted">до {{ formatDateRu(data.challenge.endDate ?? '') }}</span>
            </div>
            <div class="bar"><div class="bar-fill time" :style="{ width: timePercent + '%' }" /></div>
          </div>

          <!-- История недель: от свежих к старым -->
          <div v-if="data.game.history.length" class="card">
            <h3>Недели</h3>
            <div v-for="w in data.game.history" :key="w.id" class="row">
              <div class="name">
                Неделя {{ w.weekNumber }}
                <div class="meta">{{ formatDateRu(w.start) }} – {{ formatDateRu(w.end) }}</div>
              </div>
              <div class="meta">{{ w.done }} из {{ w.required }}</div>
              <div class="week-mark">
                <template v-if="w.outOfGame">вне зачёта</template>
                <template v-else-if="w.status === 'passed'">✅</template>
                <template v-else-if="w.status === 'forgiven'">🤝 прощена</template>
                <template v-else>💔 −1</template>
              </div>
            </div>
          </div>
        </template>

        <!-- ТРЕНИРОВКИ -->
        <WorkoutsTab v-else-if="sub === 'workouts'" :challenge-id="challengeId" :overview="data" @changed="refresh" />

        <!-- РЕЙТИНГ -->
        <FitnessLeaderboard v-else-if="sub === 'board'" :challenge-id="challengeId" :overview="data" />

        <!-- ТЕЛО -->
        <BodyTab v-else-if="sub === 'body'" :overview="data" @changed="refresh" />

        <!-- ЕЩЁ -->
        <template v-else>
          <div class="card">
            <h3>Условия</h3>
            <div class="row">
              <div class="name">Тренировок в неделю</div>
              <div class="fire">{{ data.settings.weeklyWorkouts }}</div>
            </div>
            <div class="row">
              <div class="name">Жизней</div>
              <div class="fire">{{ '❤️'.repeat(data.settings.lives) }}</div>
            </div>
            <div class="row">
              <div class="name">Тренировка в зачёт</div>
              <div class="meta">от {{ data.settings.minWorkoutMin }} мин</div>
            </div>
            <div class="muted" style="margin-top: 8px">
              Неделя — 7 дней от даты старта. Не набрал норму — минус жизнь, жизни кончились — выбыл.
            </div>
          </div>

          <ConnectionsCard @changed="refresh" />

          <div v-if="data.challenge.rulesText" class="card">
            <h3>Правила</h3>
            <div class="rules">{{ data.challenge.rulesText }}</div>
          </div>

          <div class="card">
            <h3>Моя цель</h3>
            <div class="row">
              <div class="name">{{ GOAL_EMOJI[data.goal.goalType] }} {{ GOAL_LABEL[data.goal.goalType] }}</div>
              <div v-if="data.progress?.metric" class="meta">до {{ withUnit(data.progress.target) }}</div>
            </div>
            <div v-if="data.goal.note" class="muted" style="margin: 8px 0">{{ data.goal.note }}</div>
            <button class="btn secondary" style="margin-top: 10px" @click="editingGoal = true">
              Изменить цель и анкету
            </button>
          </div>

          <div class="card">
            <h3>Приватность</h3>
            <label class="switch">
              <input type="checkbox" :checked="data.bodyProfile.shareBody" :disabled="busy" @change="toggleShare" />
              <span>Показывать участникам мои цифры</span>
            </label>
            <div class="muted" style="margin-top: 8px">
              По умолчанию другим виден только процент к цели. С галочкой — ещё и текущее значение с целью.
              Еда и обхваты остаются личными всегда.
            </div>
          </div>

          <div v-if="error" class="error-text" style="margin: 0 4px 10px">{{ error }}</div>
          <button class="btn secondary" :disabled="busy" @click="leave">Выйти из челленджа</button>
        </template>
      </template>
    </template>
  </div>
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
.bar-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
}
.bar {
  height: 8px;
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.18);
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  border-radius: 4px;
  background: var(--accent);
  transition: width 0.3s ease;
}
.bar-fill.time {
  background: var(--link);
}
.person-name {
  font-weight: 600;
}
.out-banner {
  border: 1.5px solid rgba(231, 76, 60, 0.4);
  font-size: 14px;
}
.streak-hero.out {
  background: linear-gradient(135deg, #6b6b73, #8e8e96);
}
.hero-lives {
  font-size: 22px;
  letter-spacing: 3px;
  margin-bottom: 8px;
}
.streak-hero .num {
  font-size: 44px;
}
.days {
  display: flex;
  justify-content: center;
  gap: 6px;
  margin-top: 12px;
}
.day {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 800;
}
.day.done {
  background: #fff;
  border-color: #fff;
  color: var(--accent);
}
.day.today {
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.35);
}
/* день до вступления: за него участник не отвечает */
.day.off {
  opacity: 0.3;
}
.week-mark {
  min-width: 78px;
  text-align: right;
  font-size: 13px;
  font-weight: 600;
}
.switch {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}
.switch input {
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
}
</style>
