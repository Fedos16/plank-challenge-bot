<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';
import type { FeedItem, FitnessLeaderboardRow, FitnessOverview, FitnessParticipant } from '../types';
import { formatDateRu, formatTimeRu, initials } from '../helpers';
import {
  GOAL_EMOJI,
  GOAL_LABEL,
  SOURCE_LABEL,
  SPORT_EMOJI,
  VERDICT_LABEL,
  errorText,
  formatNum,
  hearts,
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

function statusLine(r: FitnessLeaderboardRow): string {
  if (r.eliminated) return `выбыл на неделе ${r.eliminatedAtWeekNumber}`;
  const parts: string[] = [];
  if (r.week) parts.push(`${r.week.done} из ${r.week.required} на неделе`);
  parts.push(`всего ${r.totalCounted}`);
  if (r.normPercent !== null) parts.push(`норма ${r.normPercent}%`);
  return parts.join(' · ');
}

/** Цифры участника видны, только если он сам их открыл. */
function bodyLine(p: FitnessParticipant): string {
  if (!p.body || p.body.current === null) return '';
  const target = p.body.target !== null ? ` → ${formatNum(p.body.target)}` : '';
  return `${formatNum(p.body.current)}${target}`;
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
  <div v-if="loading" class="center">Загрузка…</div>
  <div v-else-if="error" class="card"><div class="error-text">{{ error }}</div></div>

  <template v-else>
    <div class="card">
      <h3>Рейтинг</h3>
      <div v-for="(r, i) in rows" :key="r.participationId" class="row" :class="{ out: r.eliminated }">
        <div class="rank">{{ r.eliminated ? '☠️' : i + 1 }}</div>
        <img v-if="r.photoUrl" :src="r.photoUrl" class="pic" alt="" />
        <div v-else class="pic">{{ initials(r.name) }}</div>
        <div class="grow">
          <div class="name">{{ r.name }} <span v-if="r.isMe" class="muted">· вы</span></div>
          <div class="meta">{{ statusLine(r) }}</div>
        </div>
        <div class="lives">{{ hearts(r.livesLeft, r.livesTotal) }}</div>
      </div>
      <div class="muted" style="margin-top: 10px">
        Цели у всех разные, поэтому места — по дисциплине: кто в игре, у кого больше жизней, кто ровнее
        закрывает норму.
      </div>
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

    <div class="card">
      <h3>Лента тренировок</h3>
      <div v-for="w in feed" :key="w.id" class="feed-item">
        <div class="ico">{{ SPORT_EMOJI[w.sport] ?? '💪' }}</div>
        <div class="grow">
          <div class="name">
            {{ w.name }} · {{ sportTitle(w) }}
            <span v-if="w.verdict !== 'counted'" class="muted">· {{ VERDICT_LABEL[w.verdict] }}</span>
          </div>
          <div class="muted">
            {{ formatDateRu(challengeDay(w.startedAt)) }}, {{ formatTimeRu(w.startedAt) }} · {{ feedMeta(w) }}
          </div>
        </div>
      </div>
      <div v-if="!feed.length" class="muted">За последние две недели тренировок не было.</div>
    </div>
  </template>
</template>

<style scoped>
.row.out {
  opacity: 0.55;
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
