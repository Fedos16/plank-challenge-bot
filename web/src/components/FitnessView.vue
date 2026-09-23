<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../api';
import type { FitnessOverview, WeekHistory } from '../types';
import { confirmAction, haptic } from '../telegram';
import { daysBetweenISO, formatDateRu, todayInZone } from '../helpers';
import { GOAL_EMOJI, GOAL_LABEL, UNIT_LABEL, errorText, formatNum, hearts } from '../fitness';
import GoalOnboarding from './GoalOnboarding.vue';
import BodyTab from './BodyTab.vue';
import WorkoutsTab from './WorkoutsTab.vue';
import FitnessLeaderboard from './FitnessLeaderboard.vue';
import ConnectionsCard from './ConnectionsCard.vue';
import FoodTab from './FoodTab.vue';
import WeekStrip from './WeekStrip.vue';

const props = defineProps<{ challengeId: number }>();
const emit = defineEmits<{ (e: 'back'): void; (e: 'left'): void }>();

type Sub = 'overview' | 'workouts' | 'food' | 'body' | 'more';
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
  const u = data.value?.progress?.unit;
  return u ? UNIT_LABEL[u] : '';
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

/**
 * Сдвиг показателя цели от старта: «−2,6 кг за 26 дн.». Зелёный — идёт к цели, красный —
 * от неё. Нет старта, текущего замера или цели — нет и строки.
 */
const goalDelta = computed<{ text: string; tone: 'good' | 'bad' | 'flat' } | null>(() => {
  const d = data.value;
  const p = d?.progress;
  if (!d || !p || p.start === null || p.current === null || p.target === null) return null;
  const delta = Math.round((p.current - p.start) * 10) / 10;
  const toward = Math.sign(p.target - p.start);
  const tone = delta === 0 || toward === 0 ? 'flat' : Math.sign(delta) === toward ? 'good' : 'bad';
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±';
  const days = d.goal?.startDay ? daysBetweenISO(d.goal.startDay, todayInZone(d.challenge.timezone)) : 0;
  const period = days > 0 ? `за ${days} дн.` : 'со старта';
  return { text: `${sign}${formatNum(Math.abs(delta))} ${unit.value} ${period}`.replace(/\s+/g, ' '), tone };
});

/** Значок итога недели. */
function weekMark(w: WeekHistory): string {
  if (w.outOfGame) return '☠️';
  if (w.status === 'passed') return '✅';
  if (w.status === 'forgiven') return '🤝';
  return '💔';
}

/** Подпись под номером недели: счёт и что с жизнью. */
function weekMeta(w: WeekHistory): string {
  const score = `${w.done} из ${w.required}`;
  if (w.outOfGame) return `${score} · вне зачёта`;
  if (w.status === 'forgiven') return `${score} · прощена`;
  if (w.lifeLost) return `${score} · −1 жизнь`;
  return score;
}

/**
 * Состояние текущей недели для цвета блока: closed — норма набрана, risk — дней осталось
 * не больше, чем недостающих тренировок (пропускать уже нельзя), lost — норма не набирается
 * даже при максимуме тренировок в день, normal — запас ещё есть.
 */
const weekState = computed<'closed' | 'risk' | 'lost' | 'normal'>(() => {
  const week = data.value?.game.currentWeek;
  if (!week) return 'normal';
  const left = week.required - week.done;
  if (left <= 0) return 'closed';
  const daysLeft = week.days.filter((d) => d.inWindow && (d.isToday || d.isFuture)).length;
  const perDay = Math.max(1, data.value?.settings.maxWorkoutsPerDay ?? 1);
  if (left > daysLeft * perDay) return 'lost';
  return left >= daysLeft ? 'risk' : 'normal';
});

/** Подпись под счётом недели: сколько осталось и сколько на это дней. Номер недели — в шапке блока. */
const weekLabel = computed(() => {
  const week = data.value?.game.currentWeek;
  if (!week) return '';
  const left = week.required - week.done;
  if (left <= 0) return 'норма закрыта 🎉';
  const daysLeft = week.days.filter((d) => d.inWindow && (d.isToday || d.isFuture)).length;
  const word = left === 1 ? 'тренировка' : left < 5 ? 'тренировки' : 'тренировок';
  const rest = `ещё ${left} ${word} за ${daysLeft} дн.`;
  if (weekState.value === 'lost') return `норма уже не набирается: ${rest}`;
  if (weekState.value === 'risk') {
    if (daysLeft <= 1) return 'сегодня обязательно!';
    return `${rest} — без пропусков`;
  }
  return rest;
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
          <button :class="{ active: sub === 'food' }" @click="sub = 'food'">Еда</button>
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
          <div
            class="streak-hero week-hero"
            :class="{
              out: data.game.lives.eliminated,
              closed: weekState === 'closed',
              risk: weekState === 'risk' || weekState === 'lost',
            }"
          >
            <span v-if="data.game.currentWeek" class="hero-mark" aria-hidden="true">
              {{ String(data.game.currentWeek.weekNumber).padStart(2, '0') }}
            </span>
            <div class="hero-top">
              <span class="hero-kicker">{{ data.game.currentWeek ? `Неделя ${data.game.currentWeek.weekNumber}` : 'Жизни' }}</span>
              <span class="hero-lives">{{ hearts(data.game.lives.left, data.game.lives.total) }}</span>
            </div>
            <template v-if="data.game.currentWeek">
              <div class="num">
                {{ data.game.currentWeek.done }}<span class="of">из {{ data.game.currentWeek.required }}</span>
              </div>
              <div class="lbl">{{ weekLabel }}</div>
              <WeekStrip :days="data.game.currentWeek.days" tone="hero" class="week-strip" />
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
            <div v-if="goalDelta" class="delta-line" :class="goalDelta.tone">
              {{ goalDelta.tone === 'good' ? '↘' : goalDelta.tone === 'bad' ? '↗' : '→' }} {{ goalDelta.text }}
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

          <!-- Участники (без мест) и лента тренировок -->
          <FitnessLeaderboard :challenge-id="challengeId" :overview="data" />

          <!-- История недель: от свежих к старым, каждая — полоской дней -->
          <div v-if="data.game.history.length" class="card">
            <h3>Недели</h3>
            <div
              v-for="w in data.game.history"
              :key="w.id"
              class="row week-row"
              :class="{ out: w.outOfGame }"
              :title="`${formatDateRu(w.start)} – ${formatDateRu(w.end)}`"
            >
              <div class="name">
                Неделя {{ w.weekNumber }}
                <div class="meta">{{ weekMeta(w) }}</div>
              </div>
              <WeekStrip v-if="w.days.length" :days="w.days" tone="card" size="sm" />
              <div class="week-mark">{{ weekMark(w) }}</div>
            </div>
          </div>
        </template>

        <!-- ТРЕНИРОВКИ -->
        <WorkoutsTab v-else-if="sub === 'workouts'" :challenge-id="challengeId" :overview="data" @changed="refresh" />

        <!-- ЕДА: дневник личный, другим участникам не виден -->
        <FoodTab v-else-if="sub === 'food'" />

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
  background: var(--track);
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  border-radius: 4px;
  background: var(--green);
  transition: width 0.3s ease;
}
/* время челленджа — нейтральными «чернилами», как шкала в шапке отчёта */
.bar-fill.time {
  background: var(--text);
  opacity: 0.75;
}
.person-name {
  font-weight: 600;
}
.out-banner {
  border: 1.5px solid rgba(231, 76, 60, 0.4);
  font-size: 14px;
}
/*
 * Неделя — сплошной цветной лист с типографикой отчёта: оранжевый — идёт, зелёный — норма
 * закрыта, красный — пропускать уже нельзя, серый — вне зачёта. Цвет листа — в --hero-ink:
 * им же рисуются галочки на белых квадратах дней.
 */
.week-hero {
  --hero-ink: var(--accent);
  position: relative;
  overflow: hidden;
  background: var(--hero-ink);
  color: #fff;
}
.week-hero.closed {
  --hero-ink: #1fa463;
}
.week-hero.risk {
  --hero-ink: #de4336;
}
.week-hero.out {
  --hero-ink: #7a7a82;
}
/* номер недели крупно, водяным знаком — как в шапке отчёта */
.hero-mark {
  position: absolute;
  top: -22px;
  right: -12px;
  font-family: var(--display);
  font-weight: 800;
  font-size: 128px;
  line-height: 1;
  letter-spacing: -6px;
  color: #fff;
  opacity: 0.14;
  pointer-events: none;
  user-select: none;
}
.hero-top {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.hero-kicker {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.82);
}
/* сердечки на белой плашке: на красном листе красные сердца иначе не видны */
.hero-lives {
  padding: 3px 8px 2px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.92);
  font-size: 13px;
  line-height: 1.2;
  letter-spacing: 2px;
}
.week-hero .num,
.week-hero .lbl {
  position: relative;
}
.week-hero .num {
  font-size: 56px;
}
.week-hero .of {
  margin-left: 10px;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: 0;
  color: rgba(255, 255, 255, 0.75);
}
.week-strip {
  position: relative;
  margin-top: 16px;
}
.week-hero :deep(.days) {
  justify-content: flex-start;
}
/* пропускать уже нельзя — подпись жирнее */
.week-hero.risk .lbl {
  font-weight: 800;
}
.week-row {
  gap: 10px;
}
.week-row.out {
  opacity: 0.55;
}
.week-row .name {
  min-width: 78px;
}
.week-mark {
  width: 24px;
  text-align: right;
  font-size: 15px;
}
/* сдвиг к цели: стрелка вниз-вправо к цели зелёная, от цели — красная */
.delta-line {
  margin-top: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--hint);
}
.delta-line.good {
  color: var(--green);
}
.delta-line.bad {
  color: var(--red);
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
