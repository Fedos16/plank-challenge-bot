<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';
import type { FeedItem, FitnessLeaderboardRow, FitnessOverview, FitnessParticipant } from '../types';
import { formatDayHumanRu, formatTimeRu, initials, todayInZone } from '../helpers';
import {
  GOAL_EMOJI,
  GOAL_LABEL,
  SOURCE_LABEL,
  SPORT_EMOJI,
  UNIT_LABEL,
  VERDICT_LABEL,
  errorText,
  formatNum,
  hearts,
  sessionTitle,
  sportTitle,
} from '../fitness';

/**
 * Часть «Обзора»: как дела у каждого участника и общая лента. Это не рейтинг — у всех свои
 * цели, поэтому мест нет: сначала вы, дальше по имени.
 */
const props = defineProps<{ challengeId: number; overview: FitnessOverview }>();

const rows = ref<FitnessLeaderboardRow[]>([]);
const feed = ref<FeedItem[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

async function load() {
  try {
    const res = await api.getFitnessLeaderboard(props.challengeId);
    rows.value = res.rows;
    feed.value = res.feed;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}

/** Участники без мест: вы первым, остальные по имени. Цифры тела — из сводки, если открыты. */
const people = computed(() => {
  const body = new Map(props.overview.participants.map((p) => [p.participationId, p]));
  return [...rows.value]
    .sort((a, b) => Number(b.isMe) - Number(a.isMe) || a.name.localeCompare(b.name, 'ru'))
    .map((r) => ({ row: r, participant: body.get(r.participationId) ?? null }));
});

function challengeDay(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: props.overview.challenge.timezone });
}

const today = computed(() => todayInZone(props.overview.challenge.timezone));

/** Неделя участника точками: закрашенные — сделано, пустые — осталось до нормы. */
function weekDots(r: FitnessLeaderboardRow): boolean[] {
  // до старта точки показывают пробную неделю — так же, как потом текущую
  const week = r.week ?? r.trial;
  if (!week || r.eliminated) return [];
  const total = Math.max(week.required, Math.min(week.done, 7));
  return Array.from({ length: total }, (_, i) => i < week.done);
}

function weekLine(r: FitnessLeaderboardRow): string {
  if (r.eliminated) return `вне зачёта с недели ${r.eliminatedAtWeekNumber}`;
  if (!r.week && r.trial) return `${r.trial.done} из ${r.trial.required} на пробной неделе`;
  const parts: string[] = [];
  if (r.week) parts.push(`${r.week.done} из ${r.week.required} на этой неделе`);
  parts.push(`всего ${r.totalCounted}`);
  return parts.join(' · ');
}

/** Цифры участника видны, только если он сам их открыл. */
function bodyLine(p: FitnessParticipant | null): string {
  if (!p?.body || p.body.current === null) return '';
  const target = p.body.target !== null ? ` → ${formatNum(p.body.target)}` : '';
  const unit = p.body.unit ? ` ${UNIT_LABEL[p.body.unit]}` : '';
  return `${formatNum(p.body.current)}${target}${unit}`;
}

function feedMeta(w: FeedItem): string {
  const parts = [`${w.durationMin} мин`];
  if (w.kcal) parts.push(`${w.kcal} ккал`);
  parts.push(SOURCE_LABEL[w.source] ?? w.source);
  return parts.join(' · ');
}

onMounted(load);
</script>

<template>
  <div class="card">
    <h3>Участники</h3>
    <div v-if="loading" class="muted">Загрузка…</div>
    <div v-else-if="error" class="error-text">{{ error }}</div>
    <template v-else>
      <div v-for="{ row: r, participant: p } in people" :key="r.participationId" class="person" :class="{ out: r.eliminated, me: r.isMe }">
        <div class="person-head">
          <img v-if="r.photoUrl" :src="r.photoUrl" class="pic" alt="" />
          <div v-else class="pic">{{ initials(r.name) }}</div>
          <span class="name">{{ r.name }}</span>
          <span v-if="r.isMe" class="me-tag">вы</span>
          <span class="lives">{{ hearts(r.livesLeft, r.livesTotal) }}</span>
        </div>

        <div v-if="r.goalType" class="goal">
          <div class="goal-head">
            <span>{{ GOAL_EMOJI[r.goalType] }} {{ GOAL_LABEL[r.goalType] }}</span>
            <span v-if="r.progressPercent !== null" class="goal-pct">{{ r.progressPercent }}%</span>
          </div>
          <div v-if="r.progressPercent !== null" class="bar">
            <div class="bar-fill" :style="{ width: r.progressPercent + '%' }" />
          </div>
          <div v-if="bodyLine(p)" class="muted">{{ bodyLine(p) }}</div>
        </div>
        <div v-else class="muted goal">⏳ цель не выбрана</div>

        <div class="week">
          <span v-if="weekDots(r).length" class="dots">
            <span v-for="(filled, k) in weekDots(r)" :key="k" class="dot" :class="{ filled }" />
          </span>
          {{ weekLine(r) }}
        </div>
      </div>
      <div class="muted" style="margin-top: 12px">
        У каждого своя цель, поэтому здесь нет мест — просто видно, как у кого идут дела.
      </div>
    </template>
  </div>

  <div v-if="!error" class="card">
    <h3>Лента тренировок</h3>
    <div v-if="loading" class="muted">Загрузка…</div>
    <template v-else>
      <div v-for="w in feed" :key="w.id" class="feed-item">
        <div class="ico">{{ SPORT_EMOJI[w.sport] ?? '💪' }}</div>
        <div class="grow">
          <div class="name">
            {{ w.name }} · {{ w.session ? sessionTitle(w.session.parts) : sportTitle(w) }}
            <span v-if="w.verdict !== 'counted'" class="verdict" :class="w.verdict">{{ VERDICT_LABEL[w.verdict] }}</span>
            <!-- до старта недели не считаются: такая тренировка видна, но в зачёт не пошла -->
            <span v-else-if="challengeDay(w.startedAt) < overview.challenge.startDate" class="verdict">пробная неделя</span>
          </div>
          <div class="muted">
            {{ formatDayHumanRu(challengeDay(w.startedAt), today) }}, {{ formatTimeRu(w.startedAt) }} · {{ feedMeta(w) }}
          </div>
        </div>
      </div>
      <div v-if="!feed.length" class="muted">За последние две недели тренировок не было.</div>
    </template>
  </div>
</template>

<style scoped>
.person {
  padding: 14px 0;
  border-bottom: 1px solid var(--rule);
}
.person:first-of-type {
  padding-top: 4px;
}
.person:last-of-type {
  border-bottom: none;
}
.person.out {
  opacity: 0.55;
}
/* своя запись — тонкая полоса акцента слева, как в отчёте недели */
.person.me {
  margin: 0 -18px;
  padding-left: 15px;
  padding-right: 18px;
  border-left: 3px solid var(--accent);
}
.person-head {
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
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex: 0 0 auto;
}
.name {
  font-weight: 700;
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
.goal {
  margin-top: 10px;
}
.goal-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 14px;
  font-weight: 600;
}
.goal-pct {
  font-family: var(--display);
  font-weight: 600;
}
.bar {
  height: 8px;
  border-radius: 4px;
  background: var(--track);
  overflow: hidden;
  margin-bottom: 4px;
}
.bar-fill {
  height: 100%;
  border-radius: 4px;
  background: var(--green);
}
.week {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 8px;
  font-size: 13px;
  color: var(--hint);
}
.dots {
  display: inline-flex;
  gap: 3px;
}
/* квадратики — тот же язык, что у полоски дней */
.dot {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  border: 1.5px solid rgba(128, 128, 128, 0.45);
  box-sizing: border-box;
}
.dot.filled {
  background: var(--green);
  border-color: var(--green);
}
.feed-item {
  display: flex;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--rule);
}
.feed-item:last-child {
  border-bottom: none;
  padding-bottom: 0;
}
.feed-item .ico {
  font-size: 20px;
}
.feed-item .grow {
  flex: 1;
  min-width: 0;
}
.feed-item .name {
  white-space: normal;
}
</style>
