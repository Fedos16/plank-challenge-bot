<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../api';
import type { WeekReport, WeekReportRow } from '../types';
import { initials } from '../helpers';
import { GOAL_EMOJI, UNIT_LABEL, errorText, formatNum, hearts } from '../fitness';
import WeekStrip from './WeekStrip.vue';

/**
 * Отчёт недели фитнес-челленджа. Сюда ведёт кнопка из сообщения бота в чате, поэтому экран
 * открывает и не участник: показываем только то, что и так видно группе.
 */
const props = defineProps<{ challengeId: number; week?: number }>();
const emit = defineEmits<{ (e: 'back'): void }>();

const report = ref<WeekReport | null>(null);
const weekNumber = ref<number | undefined>(props.week);
const loading = ref(true);
const error = ref<string | null>(null);

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

/** «21–27 сен», а на стыке месяцев — «29 сен – 5 окт». */
function rangeRu(start: string, end: string): string {
  const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString('ru-RU', opts).replace('.', '');
  if (start.slice(0, 7) === end.slice(0, 7)) {
    return `${fmt(start, { day: 'numeric' })}–${fmt(end, { day: 'numeric', month: 'short' })}`;
  }
  return `${fmt(start, { day: 'numeric', month: 'short' })} – ${fmt(end, { day: 'numeric', month: 'short' })}`;
}

const stateText = computed(() => {
  const w = report.value?.week;
  if (!w) return '';
  if (w.state === 'current') return `идёт · осталось ${w.daysLeft} дн.`;
  return w.state === 'closed' ? 'итоги подведены' : 'итоги подводятся';
});

/** Короткая отметка справа: счёт и что с нормой. */
function statusChip(r: WeekReportRow): { text: string; tone: 'good' | 'bad' | 'wait' | 'off' } {
  const score = `${r.done}/${r.required}`;
  if (r.status === 'out') return { text: 'вне зачёта', tone: 'off' };
  if (r.status === 'passed') return { text: `${score} ✓`, tone: 'good' };
  if (r.status === 'in_progress') return { text: score, tone: 'wait' };
  if (r.status === 'forgiven') return { text: `${score} · прощена`, tone: 'wait' };
  return { text: score, tone: 'bad' };
}

/** Под полоской: что неделя значит для жизней. Пусто — ничего особенного. */
function livesNote(r: WeekReportRow): string {
  if (r.eliminatedHere) return '☠️ жизни закончились';
  if (r.lifeLost) return '💔 минус жизнь';
  if (r.status === 'in_progress') {
    const left = r.required - r.done;
    return `ещё ${left} ${left === 1 ? 'тренировка' : left < 5 ? 'тренировки' : 'тренировок'}`;
  }
  return '';
}

function metaLine(r: WeekReportRow): string {
  const parts: string[] = [];
  if (r.minutes) parts.push(`${r.minutes} мин`);
  if (r.kcal) parts.push(`${r.kcal} ккал`);
  return parts.join(' · ');
}

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

/**
 * Сдвиг к цели за неделю: «+6% за неделю · −1,2 кг». Процент — доля пути от старта до цели,
 * его видят все; килограммы — только если человек открыл свои цифры.
 */
function goalDelta(r: WeekReportRow): { text: string; tone: 'good' | 'bad' | 'flat' } | null {
  const g = r.goal;
  if (!g || g.deltaPercent === null) return null;
  if (g.deltaPercent === 0 && !g.delta) return { text: 'без изменений за неделю', tone: 'flat' };
  let text = `${signed(g.deltaPercent)}% за неделю`;
  if (g.delta && g.unit) {
    const v = formatNum(Math.abs(g.delta));
    text += ` · ${g.delta > 0 ? '+' : '−'}${v} ${UNIT_LABEL[g.unit]}`;
  }
  return { text, tone: g.deltaPercent > 0 ? 'good' : g.deltaPercent < 0 ? 'bad' : 'flat' };
}

/** Лучшие недели по показателю: только если кто-то вообще что-то сделал. */
const highlights = computed(() => {
  const rows = report.value?.rows ?? [];
  const best = (pick: (r: WeekReportRow) => number) => {
    const top = rows.reduce<WeekReportRow | null>((acc, r) => (pick(r) > (acc ? pick(acc) : 0) ? r : acc), null);
    return top ? { name: top.name, value: pick(top) } : null;
  };
  return [
    { icon: '📈', label: 'Ближе всех к цели', item: best((r) => r.goal?.deltaPercent ?? 0), format: (v: number) => `+${v}%` },
    { icon: '🏅', label: 'Больше всех тренировок', item: best((r) => r.done), format: (v: number) => `${v}` },
    { icon: '⏱', label: 'Дольше всех', item: best((r) => r.minutes), format: (v: number) => `${v} мин` },
    { icon: '🔥', label: 'Больше всех сжёг', item: best((r) => r.kcal), format: (v: number) => `${v} ккал` },
  ].filter((h) => h.item !== null);
});

onMounted(load);
watch(
  () => [props.challengeId, props.week],
  () => {
    weekNumber.value = props.week;
    void load();
  },
);
</script>

<template>
  <div>
    <button class="back-link" @click="emit('back')">‹ К челленджам</button>

    <div v-if="loading && !report" class="center">Загрузка…</div>
    <div v-else-if="error && !report" class="center">
      <div class="error-text">Не удалось открыть отчёт.</div>
      <div class="muted">{{ error }}</div>
      <button class="btn small" @click="load">Повторить</button>
    </div>

    <template v-else-if="report">
      <div class="profile-head">
        <div class="avatar">📊</div>
        <div>
          <div class="profile-name">{{ report.challenge.title }}</div>
          <div class="muted">{{ rangeRu(report.week.start, report.week.end) }} · {{ stateText }}</div>
        </div>
      </div>

      <div class="week-nav">
        <button class="nav-btn" :disabled="loading || report.week.number <= 1" @click="go(-1)">‹</button>
        <span class="nav-title">Неделя {{ report.week.number }}</span>
        <button class="nav-btn" :disabled="loading || report.week.number >= report.weeksAvailable" @click="go(1)">›</button>
      </div>

      <div class="streak-hero" :class="{ closed: report.totals.inGame > 0 && report.totals.passed === report.totals.inGame }">
        <div class="num">{{ report.totals.passed }} из {{ report.totals.inGame }}</div>
        <div class="lbl">{{ report.week.state === 'current' ? 'уже закрыли норму' : 'закрыли норму' }}</div>
      </div>

      <div class="stats-grid" style="margin-bottom: 12px">
        <div class="stat"><div class="v">{{ report.totals.workouts }}</div><div class="k">Тренировок</div></div>
        <div class="stat"><div class="v">{{ report.totals.minutes }}</div><div class="k">Минут</div></div>
        <div class="stat"><div class="v">{{ report.totals.kcal }}</div><div class="k">Ккал</div></div>
        <div class="stat"><div class="v">{{ report.rows.length }}</div><div class="k">Участников</div></div>
      </div>

      <div class="card">
        <h3>Рейтинг недели</h3>
        <div v-for="(r, i) in report.rows" :key="r.participationId" class="person" :class="{ out: r.status === 'out', me: r.isMe }">
          <div class="person-head">
            <div class="rank">{{ r.status === 'out' ? '☠️' : i + 1 }}</div>
            <img v-if="r.photoUrl" :src="r.photoUrl" class="pic" alt="" />
            <div v-else class="pic">{{ initials(r.name) }}</div>
            <div class="grow">
              <div class="name">{{ r.name }} <span v-if="r.isMe" class="me-tag">вы</span></div>
              <div class="lives">{{ hearts(r.livesLeft, r.livesTotal) }}</div>
            </div>
            <div class="chip" :class="statusChip(r).tone">{{ statusChip(r).text }}</div>
          </div>
          <WeekStrip :days="r.days" tone="card" size="sm" class="strip" />
          <div v-if="r.goal && r.goal.percent !== null" class="goal-line">
            <span>{{ r.goalType ? GOAL_EMOJI[r.goalType] : '🎯' }}</span>
            <div class="bar"><div class="bar-fill" :style="{ width: r.goal.percent + '%' }" /></div>
            <span class="goal-pct">{{ r.goal.percent }}%</span>
          </div>
          <div v-if="goalDelta(r)" class="goal-delta" :class="goalDelta(r)!.tone">{{ goalDelta(r)!.text }}</div>
          <div v-if="livesNote(r) || metaLine(r)" class="meta">
            <span v-if="livesNote(r)" class="note" :class="{ bad: r.lifeLost || r.eliminatedHere }">{{ livesNote(r) }}</span>
            <span v-if="livesNote(r) && metaLine(r)"> · </span>
            {{ metaLine(r) }}
          </div>
        </div>
        <div v-if="!report.rows.length" class="muted">На этой неделе участников ещё не было.</div>
      </div>

      <div v-if="highlights.length" class="card">
        <h3>Лучшие за неделю</h3>
        <div v-for="h in highlights" :key="h.label" class="row">
          <div class="name">{{ h.icon }} {{ h.label }}</div>
          <div class="meta">{{ h.item!.name }} · {{ h.format(h.item!.value) }}</div>
        </div>
      </div>

      <div v-if="error" class="error-text" style="margin: 0 4px 10px">{{ error }}</div>
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
.week-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.nav-title {
  font-weight: 700;
}
.nav-btn {
  width: 40px;
  height: 36px;
  border-radius: 10px;
  border: none;
  background: var(--bg);
  color: var(--text);
  font-size: 20px;
  cursor: pointer;
}
.nav-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
/* все в игре закрыли норму — зелёный, как закрытая неделя на обзоре */
.streak-hero.closed {
  background: linear-gradient(135deg, #1fa463, #34d27a);
}
.streak-hero .num {
  font-size: 40px;
}
.person {
  padding: 10px 0;
  border-bottom: 1px solid rgba(128, 128, 128, 0.12);
}
.person:last-of-type {
  border-bottom: none;
}
.person.out {
  opacity: 0.55;
}
.person.me {
  background: rgba(255, 107, 53, 0.09);
  border-radius: 12px;
  margin: 0 -8px;
  padding-left: 8px;
  padding-right: 8px;
  border-bottom-color: transparent;
}
.person-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.rank {
  width: 18px;
  text-align: center;
  font-weight: 700;
  color: var(--hint);
}
.pic {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--button);
  color: var(--button-text);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  flex: 0 0 auto;
}
.grow {
  flex: 1;
  min-width: 0;
}
.name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lives {
  font-size: 12px;
  margin-top: 2px;
}
.me-tag {
  display: inline-block;
  margin-left: 4px;
  padding: 0 7px;
  border-radius: 9px;
  font-size: 11px;
  font-weight: 700;
  line-height: 17px;
  vertical-align: middle;
  background: var(--accent);
  color: #fff;
}
.chip {
  flex: 0 0 auto;
  padding: 3px 9px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
}
.chip.good {
  background: rgba(31, 164, 99, 0.14);
  color: var(--green);
}
.chip.bad {
  background: rgba(231, 76, 60, 0.12);
  color: var(--red);
}
.chip.wait {
  background: rgba(128, 128, 128, 0.14);
}
.chip.off {
  color: var(--hint);
}
.strip {
  margin: 10px 0 0;
}
.meta {
  margin-top: 8px;
  font-size: 13px;
  color: var(--hint);
  text-align: center;
}
.note.bad {
  color: var(--red);
  font-weight: 600;
}
/* прогресс к цели: полоска на всю ширину, сдвиг за неделю — под ней */
.goal-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  font-size: 13px;
}
.bar {
  flex: 1;
  height: 8px;
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.18);
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  border-radius: 4px;
  background: var(--accent);
}
.goal-pct {
  font-weight: 700;
  min-width: 36px;
  text-align: right;
}
.goal-delta {
  margin-top: 4px;
  font-size: 13px;
  font-weight: 600;
  text-align: right;
  color: var(--hint);
}
.goal-delta.good {
  color: var(--green);
}
.goal-delta.bad {
  color: var(--red);
}
</style>
