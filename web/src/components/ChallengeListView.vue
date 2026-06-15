<script setup lang="ts">
import type { MyChallenge } from '../types';
import { STATE_LABEL, formatMoney } from '../helpers';

defineProps<{ challenges: MyChallenge[]; userName: string }>();
defineEmits<{ (e: 'select', id: number): void }>();
</script>

<template>
  <div>
    <h2 style="margin: 4px 0 14px">Мои челленджи</h2>
    <div
      v-for="c in challenges"
      :key="c.id"
      class="card challenge-card"
      @click="$emit('select', c.id)"
    >
      <div class="challenge-card-head">
        <div class="challenge-title">{{ c.title }}</div>
        <span :class="`badge ${c.todayState}`">{{ STATE_LABEL[c.todayState] }}</span>
      </div>
      <div class="muted">{{ c.description }}</div>
      <div class="challenge-card-meta">
        <span>День {{ c.dayNumber }}</span>
        <span class="fire">🔥 {{ c.currentStreak }}</span>
        <span>💰 {{ formatMoney(c.bank) }}</span>
        <span class="chev">›</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.challenge-card {
  cursor: pointer;
  transition: transform 0.05s ease;
}
.challenge-card:active {
  transform: scale(0.99);
}
.challenge-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}
.challenge-title {
  font-size: 17px;
  font-weight: 700;
}
.challenge-card-meta {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 10px;
  font-size: 13px;
  color: var(--hint);
}
.challenge-card-meta .chev {
  margin-left: auto;
  font-size: 22px;
  color: var(--hint);
}
</style>
