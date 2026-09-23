<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../api';
import type { GoalType, MuscleUnit, WeekReport, WeekReportRow } from '../types';
import { initials } from '../helpers';
import { GOAL_EMOJI, GOAL_LABEL, errorText, formatNum, hearts } from '../fitness';
import WeekStrip from './WeekStrip.vue';

/**
 * Отчёт недели фитнес-челленджа. Сюда ведёт кнопка из сообщения бота в чате, поэтому экран
 * открывает и не участник: показываем только то, что и так видно группе.
 *
 * Главное здесь — личный путь к цели, а не борьба друг с другом: сверху общий итог, затем
 * записи участников (без мест), сравнение — в самом низу.
 */
const props = defineProps<{ challengeId: number; week?: number }>();
const emit = defineEmits<{ (e: 'back'): void }>();

const report = ref<WeekReport | null>(null);
const weekNumber = ref<number | undefined>(props.week);
const loading = ref(true);
const error = ref<string | null>(null);

/** Свои шрифты только у отчёта: остальное приложение живёт на системном. Нет сети — фолбэк. */
const FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700&family=Unbounded:wght@600;800&display=swap';
function loadFonts() {
  if (document.getElementById('report-fonts')) return;
  const link = document.createElement('link');
  link.id = 'report-fonts';
  link.rel = 'stylesheet';
  link.href = FONTS_URL;
  document.head.appendChild(link);
}

async function load() {
  loading.value = true;
  error.value = null;
  try {
    report.value = await api.getWeekReport(props.challengeId, weekNumber.value);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}

function go(delta: number) {
  if (!report.value) return;
  weekNumber.value = report.value.week.number + delta;
  void load();
}

const fmtDay = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('ru-RU', opts);

/** «21–27 сентября», а на стыке месяцев — «29 сентября – 5 октября». */
function rangeRu(start: string, end: string): string {
  const long = { day: 'numeric', month: 'long' } as const;
  if (start.slice(0, 7) === end.slice(0, 7)) return `${fmtDay(start, { day: 'numeric' })}–${fmtDay(end, long)}`;
  return `${fmtDay(start, long)} – ${fmtDay(end, long)}`;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

const stateText = computed(() => {
  const w = report.value?.week;
  if (!w) return '';
  if (w.state === 'current') return `идёт, ${plural(w.daysLeft ?? 0, 'остался', 'осталось', 'осталось')} ${w.daysLeft} ${plural(w.daysLeft ?? 0, 'день', 'дня', 'дней')}`;
  return w.state === 'closed' ? 'итоги подведены' : 'итоги подводятся';
});

const isCurrent = computed(() => report.value?.week.state === 'current');

/** Средний сдвиг группы словами: «в среднем — на 6% пути ближе». */
const avgText = computed(() => {
  const avg = report.value?.totals.avgDeltaPercent;
  if (avg === null || avg === undefined || !report.value?.totals.withGoal) return '';
  if (avg > 0) return `В среднем каждый прошёл ещё ${avg}% своего пути`;
  if (avg < 0) return `В среднем группа откатилась на ${Math.abs(avg)}% пути`;
  return 'В среднем — без изменений';
});

/** Личные записи: без мест. Сначала вы, дальше по имени. */
const personal = computed(() =>
  [...(report.value?.rows ?? [])].sort(
    (a, b) => Number(b.isMe) - Number(a.isMe) || a.name.localeCompare(b.name, 'ru'),
  ),
);

/**
 * Полоска пути к цели: пройдено до этой недели — спокойным цветом, пройденное за неделю —
 * зелёным, откат — красной штриховкой. Проценты — доля пути от стартового замера до цели.
 */
function pathOf(r: WeekReportRow) {
  const g = r.goal;
  if (!g || g.percent === null) return null;
  const now = g.percent;
  // оба значения обрезаны 0..100: откат ниже старта полоска не покажет, его скажет подпись
  const before = g.percentBefore ?? now;
  if (now >= before) return { base: before, from: before, to: now, tone: 'gain' as const };
  return { base: now, from: now, to: before, tone: 'loss' as const };
}

/** Сдвиг за неделю словами — без плюсов, которые читаются как «прибавил 5% веса». */
function deltaText(r: WeekReportRow): { text: string; tone: 'good' | 'bad' | 'flat' } | null {
  const d = r.goal?.deltaPercent;
  if (d === null || d === undefined) return null;
  if (d > 0) return { text: `на ${d}% ближе к цели`, tone: 'good' };
  if (d < 0) return { text: `на ${Math.abs(d)}% дальше от цели`, tone: 'bad' };
  return { text: 'без изменений', tone: 'flat' };
}

/** В чём измерен показатель цели: «кг», «% жира», «% мышц». */
function metricUnit(goalType: GoalType | null, unit: MuscleUnit | null): string {
  if (unit === 'kg') return goalType === 'gain_muscle' ? 'кг мышц' : 'кг';
  return goalType === 'gain_muscle' ? '% мышц' : '% жира';
}

/** Изменение самого показателя — только у тех, кто открыл свои цифры. */
function absoluteText(r: WeekReportRow): string {
  const g = r.goal;
  if (!g || g.delta === null || g.delta === 0) return '';
  const unit = metricUnit(r.goalType, g.unit);
  // «−1,4% жира», но «−2,6 кг»: знак процента пишется слитно
  const gap = unit.startsWith('%') ? '' : ' ';
  return `${g.delta > 0 ? '+' : '−'}${formatNum(Math.abs(g.delta))}${gap}${unit} за неделю`;
}

/** Строка про тренировки недели. */
function trainingText(r: WeekReportRow): string {
  const parts = [`тренировок ${r.done} из ${r.required}`];
  if (r.minutes) parts.push(`${r.minutes} мин`);
  if (r.kcal) parts.push(`${r.kcal.toLocaleString('ru-RU')} ккал`);
  return parts.join(' · ');
}

/** Что неделя значит для игры: пусто — ничего особенного. */
function gameNote(r: WeekReportRow): { text: string; bad: boolean } | null {
  if (r.status === 'out') return { text: 'вне зачёта', bad: false };
  if (r.eliminatedHere) return { text: 'жизни закончились', bad: true };
  if (r.lifeLost) return { text: 'минус жизнь', bad: true };
  if (r.status === 'forgiven') return { text: 'неделя прощена', bad: false };
  if (r.status === 'passed') return { text: 'норма закрыта', bad: false };
  if (r.status === 'in_progress') {
    const left = r.required - r.done;
    return { text: `до нормы ${left} ${plural(left, 'тренировка', 'тренировки', 'тренировок')}`, bad: false };
  }
  return null;
}

/** Любопытные цифры недели — внизу, для тех, кому интересно сравнить. */
const highlights = computed(() => {
  const rows = report.value?.rows ?? [];
  const best = (pick: (r: WeekReportRow) => number) => {
    const top = rows.reduce<WeekReportRow | null>((acc, r) => (pick(r) > (acc ? pick(acc) : 0) ? r : acc), null);
    return top ? { name: top.name, value: pick(top) } : null;
  };
  return [
    { label: 'Дальше всех продвинулся к цели', item: best((r) => r.goal?.deltaPercent ?? 0), format: (v: number) => `на ${v}%` },
    { label: 'Больше всех тренировок', item: best((r) => r.done), format: (v: number) => `${v}` },
    { label: 'Дольше всех тренировался', item: best((r) => r.minutes), format: (v: number) => `${v} мин` },
    { label: 'Больше всех сжёг', item: best((r) => r.kcal), format: (v: number) => `${v.toLocaleString('ru-RU')} ккал` },
  ].filter((h) => h.item !== null);
});

onMounted(() => {
  loadFonts();
  void load();
});
watch(
  () => [props.challengeId, props.week],
  () => {
    weekNumber.value = props.week;
    void load();
  },
);
</script>

<template>
  <div class="report-page">
    <button class="back" @click="emit('back')">‹ К челленджам</button>

    <div v-if="loading && !report" class="center">Загрузка…</div>
    <div v-else-if="error && !report" class="center">
      <div class="error-text">Не удалось открыть отчёт.</div>
      <div class="muted">{{ error }}</div>
      <button class="btn small" @click="load">Повторить</button>
    </div>

    <article v-else-if="report" :key="report.week.number" class="sheet">
      <!-- Шапка: номер недели крупно, водяным знаком -->
      <header class="mast rise" style="--i: 0">
        <span class="watermark" aria-hidden="true">{{ String(report.week.number).padStart(2, '0') }}</span>
        <div class="kicker">{{ report.challenge.title }}</div>
        <h1 class="title">Неделя {{ report.week.number }}</h1>
        <div class="dates">{{ rangeRu(report.week.start, report.week.end) }} · {{ stateText }}</div>
        <nav class="weeks">
          <button :disabled="loading || report.week.number <= 1" @click="go(-1)">‹ неделя {{ report.week.number - 1 }}</button>
          <button :disabled="loading || report.week.number >= report.weeksAvailable" @click="go(1)">
            неделя {{ report.week.number + 1 }} ›
          </button>
        </nav>
      </header>

      <!-- Общий итог: сначала про цели, потом про тренировки -->
      <section class="summary rise" style="--i: 1">
        <template v-if="report.totals.withGoal">
          <div class="lead">
            <span class="lead-num" :class="{ good: report.totals.closer > 0 }">{{ report.totals.closer }}</span>
            <span class="lead-of">из {{ report.totals.withGoal }}</span>
          </div>
          <p class="lead-text">{{ isCurrent ? 'уже стали ближе к своей цели' : 'стали ближе к своей цели' }}</p>
          <p v-if="avgText" class="lead-sub">{{ avgText }}</p>
        </template>
        <template v-else>
          <div class="lead">
            <span class="lead-num">{{ report.totals.passed }}</span>
            <span class="lead-of">из {{ report.totals.inGame }}</span>
          </div>
          <p class="lead-text">закрыли норму тренировок</p>
        </template>

        <dl class="figures">
          <div>
            <dd>{{ report.totals.workouts }}</dd>
            <dt>{{ plural(report.totals.workouts, 'тренировка', 'тренировки', 'тренировок') }}</dt>
          </div>
          <div>
            <dd>{{ report.totals.minutes.toLocaleString('ru-RU') }}</dd>
            <dt>{{ plural(report.totals.minutes, 'минута', 'минуты', 'минут') }}</dt>
          </div>
          <div>
            <dd>{{ report.totals.kcal.toLocaleString('ru-RU') }}</dd>
            <dt>ккал</dt>
          </div>
        </dl>
        <p v-if="report.totals.withGoal" class="norm">
          Норму тренировок {{ isCurrent ? 'уже ' : '' }}закрыли {{ report.totals.passed }} из {{ report.totals.inGame }}
        </p>
      </section>

      <!-- Личные результаты: у каждого свой путь, мест нет -->
      <section class="people">
        <h2 class="section-title rise" style="--i: 2">Личные результаты</h2>
        <div
          v-for="(r, i) in personal"
          :key="r.participationId"
          class="entry rise"
          :class="{ me: r.isMe, out: r.status === 'out' }"
          :style="{ '--i': i + 3 }"
        >
          <div class="entry-head">
            <img v-if="r.photoUrl" :src="r.photoUrl" class="pic" alt="" />
            <span v-else class="pic">{{ initials(r.name) }}</span>
            <span class="name">{{ r.name }}</span>
            <span v-if="r.isMe" class="me-tag">вы</span>
            <span class="lives" :title="`жизней: ${r.livesLeft} из ${r.livesTotal}`">{{ hearts(r.livesLeft, r.livesTotal) }}</span>
          </div>

          <template v-if="pathOf(r)">
            <div class="goal-label">
              {{ r.goalType ? GOAL_EMOJI[r.goalType] : '🎯' }} {{ r.goalType ? GOAL_LABEL[r.goalType] : 'Цель' }}
            </div>
            <div class="path" role="img" :aria-label="`${r.goal!.percent}% пути к цели`">
              <div class="path-fill">
                <span class="seg base" :style="{ width: pathOf(r)!.base + '%' }" />
                <span
                  class="seg week"
                  :class="pathOf(r)!.tone"
                  :style="{ left: pathOf(r)!.from + '%', width: pathOf(r)!.to - pathOf(r)!.from + '%' }"
                />
              </div>
            </div>
            <div class="path-legend">
              <span class="pct"><b>{{ r.goal!.percent }}%</b> пути к цели</span>
              <span v-if="deltaText(r)" class="delta" :class="deltaText(r)!.tone">{{ deltaText(r)!.text }}</span>
            </div>
            <div v-if="absoluteText(r)" class="absolute">{{ absoluteText(r) }}</div>
          </template>
          <div v-else class="goal-none">
            {{ r.goalType === 'custom' ? '🎯 Своя цель — без замеров' : 'Цель ещё не выбрана' }}
          </div>

          <div class="training">
            <WeekStrip :days="r.days" tone="card" size="sm" />
            <div class="training-text">
              {{ trainingText(r) }}
              <template v-if="gameNote(r)">
                · <span :class="{ bad: gameNote(r)!.bad }">{{ gameNote(r)!.text }}</span>
              </template>
            </div>
          </div>
        </div>
        <p v-if="!personal.length" class="empty">На этой неделе участников ещё не было.</p>
      </section>

      <!-- Сравнение — для любопытных, в самом конце -->
      <section v-if="report.rows.length > 1" class="compare rise" :style="{ '--i': personal.length + 3 }">
        <h2 class="section-title">Для любопытных</h2>
        <p class="compare-hint">Цели у всех свои, так что это просто цифры недели, а не таблица победителей.</p>
        <dl v-if="highlights.length" class="bests">
          <div v-for="h in highlights" :key="h.label">
            <dt>{{ h.label }}</dt>
            <dd>{{ h.item!.name }} — {{ h.format(h.item!.value) }}</dd>
          </div>
        </dl>
      </section>

      <p v-if="error" class="error-text">{{ error }}</p>
    </article>
  </div>
</template>

<style scoped>
.report-page {
  --display: 'Unbounded', 'Arial Black', system-ui, sans-serif;
  --body: 'Onest', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --rule: rgba(128, 128, 128, 0.22);
  --path-track: rgba(128, 128, 128, 0.16);
  --path-base: rgba(128, 128, 128, 0.42);
  font-family: var(--body);
}
.back {
  background: none;
  border: none;
  color: var(--link);
  font: inherit;
  font-size: 15px;
  padding: 4px 0 10px;
  cursor: pointer;
}

/* Лист отчёта: один сплошной «бумажный» лист, разделы — тонкими линейками */
.sheet {
  position: relative;
  overflow: hidden;
  background: var(--secondary-bg);
  border-radius: 22px;
  padding: 22px 18px 26px;
}

/* ---------- шапка ---------- */
.mast {
  position: relative;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--rule);
}
.watermark {
  position: absolute;
  top: -26px;
  right: -14px;
  font-family: var(--display);
  font-weight: 800;
  font-size: 132px;
  line-height: 1;
  letter-spacing: -6px;
  color: var(--text);
  opacity: 0.06;
  pointer-events: none;
  user-select: none;
}
.kicker {
  position: relative;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--hint);
}
.title {
  position: relative;
  margin: 6px 0 4px;
  font-family: var(--display);
  font-weight: 800;
  font-size: 32px;
  line-height: 1.05;
  letter-spacing: -0.02em;
}
.dates {
  position: relative;
  font-size: 14px;
  color: var(--hint);
}
.weeks {
  position: relative;
  display: flex;
  justify-content: space-between;
  margin-top: 14px;
}
.weeks button {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: var(--link);
  cursor: pointer;
}
.weeks button:disabled {
  visibility: hidden;
}

/* ---------- общий итог ---------- */
.summary {
  padding: 22px 0 20px;
  border-bottom: 1px solid var(--rule);
}
.lead {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.lead-num {
  font-family: var(--display);
  font-weight: 800;
  font-size: 64px;
  line-height: 0.95;
  letter-spacing: -0.04em;
}
.lead-num.good {
  color: var(--green);
}
.lead-of {
  font-family: var(--display);
  font-weight: 600;
  font-size: 22px;
  color: var(--hint);
}
.lead-text {
  margin: 6px 0 0;
  font-size: 19px;
  font-weight: 600;
  line-height: 1.25;
}
.lead-sub {
  margin: 6px 0 0;
  font-size: 14px;
  color: var(--hint);
}
.figures {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  margin: 20px 0 0;
  border-top: 1px solid var(--rule);
}
.figures > div {
  padding: 12px 0 0;
}
.figures > div + div {
  padding-left: 12px;
  border-left: 1px solid var(--rule);
}
.figures dd {
  margin: 0;
  font-family: var(--display);
  font-weight: 600;
  font-size: 20px;
  line-height: 1.1;
}
.figures dt {
  margin-top: 3px;
  font-size: 12px;
  color: var(--hint);
}
.norm {
  margin: 14px 0 0;
  font-size: 14px;
}

/* ---------- личные результаты ---------- */
.people {
  padding-top: 22px;
}
.section-title {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--hint);
}
.entry {
  padding: 16px 0 18px;
  border-bottom: 1px solid var(--rule);
}
.entry:last-of-type {
  border-bottom: none;
}
.entry.out {
  opacity: 0.6;
}
/* своя запись — тонкая полоса акцента слева, без заливки: не соревнование, просто «это вы» */
.entry.me {
  margin: 0 -18px;
  padding-left: 15px;
  padding-right: 18px;
  border-left: 3px solid var(--accent);
}
.entry-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.pic {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--button);
  color: var(--button-text);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex: 0 0 auto;
}
.name {
  font-weight: 700;
  font-size: 16px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.me-tag {
  flex: 0 0 auto;
  padding: 0 7px;
  border-radius: 9px;
  font-size: 11px;
  font-weight: 700;
  line-height: 17px;
  background: var(--accent);
  color: #fff;
}
.lives {
  margin-left: auto;
  flex: 0 0 auto;
  font-size: 12px;
  letter-spacing: 1px;
}
.goal-label {
  margin: 14px 0 8px;
  font-size: 14px;
  font-weight: 600;
}
.path {
  height: 12px;
  border-radius: 6px;
  background: var(--path-track);
  overflow: hidden;
}
.path-fill {
  position: relative;
  height: 100%;
  transform-origin: left center;
  animation: grow 0.9s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  animation-delay: calc(var(--i, 0) * 70ms + 200ms);
}
.seg {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
}
.seg.base {
  background: var(--path-base);
}
.seg.week.gain {
  background: var(--green);
}
/* откат — штриховкой: это не пройденный путь, а потерянный */
.seg.week.loss {
  background: repeating-linear-gradient(-45deg, var(--red) 0 4px, transparent 4px 7px);
}
.path-legend {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  margin-top: 8px;
  font-size: 14px;
}
.pct b {
  font-family: var(--display);
  font-weight: 600;
  font-size: 17px;
}
.delta {
  font-weight: 700;
  text-align: right;
  color: var(--hint);
}
.delta.good {
  color: var(--green);
}
.delta.bad {
  color: var(--red);
}
.absolute {
  margin-top: 2px;
  font-size: 13px;
  text-align: right;
  color: var(--hint);
}
.goal-none {
  margin-top: 12px;
  font-size: 14px;
  color: var(--hint);
}
.training {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  margin-top: 14px;
}
.training :deep(.days) {
  justify-content: flex-start;
}
.training-text {
  font-size: 13px;
  color: var(--hint);
}
.training-text .bad {
  color: var(--red);
  font-weight: 600;
}
.empty {
  color: var(--hint);
}

/* ---------- для любопытных ---------- */
.compare {
  margin-top: 8px;
  padding-top: 20px;
  border-top: 1px solid var(--rule);
}
.compare-hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--hint);
}
.bests {
  margin: 0;
}
.bests > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-top: 1px dashed var(--rule);
  font-size: 14px;
}
.bests dt {
  color: var(--hint);
}
.bests dd {
  margin: 0;
  font-weight: 600;
  text-align: right;
}

/* ---------- появление ---------- */
.rise {
  animation: rise 0.55s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  animation-delay: calc(var(--i, 0) * 70ms);
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
}
@keyframes grow {
  from {
    transform: scaleX(0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .rise,
  .path-fill {
    animation: none;
  }
}
</style>
