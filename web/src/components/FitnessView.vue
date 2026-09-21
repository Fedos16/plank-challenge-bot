<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../api';
import type { FitnessOverview, FitnessParticipant } from '../types';
import { confirmAction, haptic } from '../telegram';
import { formatDateRu } from '../helpers';
import { GOAL_EMOJI, GOAL_LABEL, METRIC_UNIT, errorText, formatNum } from '../fitness';
import GoalOnboarding from './GoalOnboarding.vue';
import BodyTab from './BodyTab.vue';

const props = defineProps<{ challengeId: number }>();
const emit = defineEmits<{ (e: 'back'): void; (e: 'left'): void }>();

type Sub = 'overview' | 'body' | 'more';
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

function bodyLine(p: FitnessParticipant): string {
  if (!p.body || p.body.current === null) return '';
  const target = p.body.target !== null ? ` → ${formatNum(p.body.target)}` : '';
  return `${formatNum(p.body.current)}${target}`;
}

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
          <button :class="{ active: sub === 'body' }" @click="sub = 'body'">Тело</button>
          <button :class="{ active: sub === 'more' }" @click="sub = 'more'">Ещё</button>
        </div>

        <!-- ОБЗОР -->
        <template v-if="sub === 'overview'">
          <div class="streak-hero">
            <template v-if="data.progress?.percent !== null && data.progress?.percent !== undefined">
              <div class="num">{{ data.progress.percent }}%</div>
              <div class="lbl">к цели · {{ GOAL_LABEL[data.goal.goalType].toLowerCase() }}</div>
            </template>
            <template v-else>
              <div class="num">{{ GOAL_EMOJI[data.goal.goalType] }}</div>
              <div class="lbl">{{ data.goal.note || GOAL_LABEL[data.goal.goalType] }}</div>
            </template>
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

          <div class="card">
            <h3>Участники</h3>
            <div v-for="p in data.participants" :key="p.participationId" class="person">
              <div class="bar-head">
                <span class="person-name">
                  {{ p.goalType ? GOAL_EMOJI[p.goalType] : '⏳' }} {{ p.name }}
                  <span v-if="p.isMe" class="muted">· вы</span>
                </span>
                <span v-if="p.progressPercent !== null" class="fire">{{ p.progressPercent }}%</span>
                <span v-else class="muted">{{ p.goalType ? GOAL_LABEL[p.goalType] : 'цель не выбрана' }}</span>
              </div>
              <div v-if="p.progressPercent !== null" class="bar">
                <div class="bar-fill" :style="{ width: p.progressPercent + '%' }" />
              </div>
              <div v-if="bodyLine(p)" class="muted">{{ bodyLine(p) }}</div>
            </div>
          </div>
        </template>

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
.person {
  padding: 10px 0;
  border-bottom: 1px solid rgba(128, 128, 128, 0.12);
}
.person:last-child {
  border-bottom: none;
  padding-bottom: 0;
}
.person-name {
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
