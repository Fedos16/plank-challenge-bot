<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';
import type { ChallengePublic, LeaderboardRow } from '../types';
import { formatMoney } from '../helpers';

defineProps<{ challenge: ChallengePublic }>();

const rows = ref<LeaderboardRow[]>([]);
const loading = ref(true);
const medals = ['🥇', '🥈', '🥉'];

onMounted(async () => {
  try {
    const res = await api.getLeaderboard();
    rows.value = res.rows;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div>
    <div class="bank-chip">
      <span>💰 Общий банк</span>
      <span class="v">{{ formatMoney(challenge.bank) }}</span>
    </div>

    <div class="card" style="display: flex; justify-content: space-between">
      <div>
        <div class="muted">Челлендж идёт</div>
        <div style="font-weight: 700; font-size: 17px">День {{ challenge.dayNumber }}</div>
      </div>
      <div style="text-align: right">
        <div class="muted">Старт</div>
        <div style="font-weight: 600">{{ challenge.startDate }}</div>
      </div>
    </div>

    <div class="card">
      <h3>🏆 Рейтинг по серии</h3>
      <div v-if="loading" class="muted">Загрузка…</div>
      <div v-else-if="rows.length === 0" class="muted">Пока нет участников.</div>
      <div v-else>
        <div v-for="(r, i) in rows" :key="r.participationId" class="row">
          <div class="rank">{{ medals[i] ?? i + 1 }}</div>
          <div class="name">
            {{ r.name }}
            <div class="meta">сделано: {{ r.doneCount }} · рекорд: {{ r.maxStreak }}</div>
          </div>
          <div class="fire">🔥 {{ r.currentStreak }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
