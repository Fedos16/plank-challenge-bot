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

function challengeDay(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: props.overview.challenge.timezone });
}

const today = computed(() => todayInZone(props.overview.challenge.timezone));

/** Неделя участника точками: закрашенные — сделано, пустые — осталось до нормы. */
function weekDots(r: FitnessLeaderboardRow): boolean[] {
  if (!r.week || r.eliminated) return [];
  const total = Math.max(r.week.required, Math.min(r.week.done, 7));
  return Array.from({ length: total }, (_, i) => i < r.week!.done);
}

function statusLine(r: FitnessLeaderboardRow): string {
  if (r.eliminated) return `выбыл на неделе ${r.eliminatedAtWeekNumber}`;
  const parts: string[] = [];
  if (r.week) parts.push(`${r.week.done} из ${r.week.required}`);
  parts.push(`всего ${r.totalCounted}`);
  if (r.normPercent !== null) parts.push(`норма ${r.normPercent}%`);
  return parts.join(' · ');
}

/** Цифры участника видны, только если он сам их открыл. */
function bodyLine(p: FitnessParticipant): string {
  if (!p.body || p.body.current === null) return '';
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

<!--
  Часть «Обзора»: рейтинг, прогресс всех к цели и лента. Ждут ответа сервера только рейтинг и лента,
  прогресс рисуется сразу.
-->
<template>
  <div class="card">
    <h3>Рейтинг</h3>
    <div v-if="loading" class="muted">Загрузка…</div>
    <div v-else-if="error" class="error-text">{{ error }}</div>
    <template v-else>
      <div
        v-for="(r, i) in rows"
        :key="r.participationId"
        class="row"
        :class="{ out: r.eliminated, me: r.isMe }"
      >
        <div class="rank">{{ r.eliminated ? '☠️' : i + 1 }}</div>
        <img v-if="r.photoUrl" :src="r.photoUrl" class="pic" alt="" />
        <div v-else class="pic">{{ initials(r.name) }}</div>
        <div class="grow">
          <div class="name">{{ r.name }} <span v-if="r.isMe" class="me-tag">вы</span></div>
          <div class="meta">
            <span v-if="weekDots(r).length" class="dots" :title="`${r.week?.done} из ${r.week?.required} на неделе`">
              <span v-for="(filled, k) in weekDots(r)" :key="k" class="dot" :class="{ filled }" />
            </span>
            {{ statusLine(r) }}
          </div>
        </div>
        <div class="lives">{{ hearts(r.livesLeft, r.livesTotal) }}</div>
      </div>
      <div class="muted" style="margin-top: 10px">
        Цели у всех разные, поэтому места — по дисциплине: кто в игре, у кого больше жизней, кто ровнее
        закрывает норму.
      </div>
    </template>
  </div>

  <div class="card">
    <h3>Прогресс к цели</h3>
    <div v-for="p in overview.participants" :key="p.participationId" class="person">
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
.row.out {
  opacity: 0.55;
}
/* своя строка: лёгкая подложка цветом акцента */
.row.me {
  background: rgba(255, 107, 53, 0.09);
  border-radius: 12px;
  margin: 0 -8px;
  padding-left: 8px;
  padding-right: 8px;
  border-bottom-color: transparent;
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
.meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.dots {
  display: inline-flex;
  gap: 3px;
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1.5px solid rgba(128, 128, 128, 0.45);
  box-sizing: border-box;
}
.dot.filled {
  background: var(--green);
  border-color: var(--green);
}
.row .grow {
  flex: 1;
  min-width: 0;
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
.lives {
  font-size: 13px;
  white-space: nowrap;
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
}
.feed-item {
  display: flex;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px solid rgba(128, 128, 128, 0.12);
}
.feed-item:last-child {
  border-bottom: none;
  padding-bottom: 0;
}
.feed-item .ico {
  font-size: 20px;
}
.feed-item .name {
  font-weight: 600;
}
</style>
