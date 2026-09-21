<script setup lang="ts">
import { ref } from 'vue';
import type { AvailableChallenge, DayState, MyChallenge, PersonalSummary } from '../types';
import { STATE_LABEL, formatMoney } from '../helpers';

defineProps<{
  group: MyChallenge[];
  personal: PersonalSummary[];
  available: AvailableChallenge[];
  userName: string;
}>();
const emit = defineEmits<{
  (e: 'open-group', id: number): void;
  (e: 'open-weight', id: number): void;
  (e: 'open-personal', id: number): void;
  (e: 'create', title: string): void;
  (e: 'join', id: number): void;
}>();

const newTitle = ref('');
function create() {
  const t = newTitle.value.trim();
  if (!t) return;
  emit('create', t);
  newTitle.value = '';
}

/** В группе взвешиваний состояния дня нет — карточка рисуется по-другому. */
function dayState(c: MyChallenge): DayState {
  return c.todayState ?? 'pending';
}

function formatKg(n: number): string {
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function weekDelta(c: MyChallenge): string {
  const d = c.weight?.weekDelta;
  if (d === null || d === undefined) return '';
  if (d === 0) return '±0 за неделю';
  return (d > 0 ? '+' : '−') + formatKg(Math.abs(d)) + ' кг за неделю';
}
</script>

<template>
  <div>
    <h2 style="margin: 4px 0 14px">Мои челленджи</h2>

    <template v-for="c in group" :key="'g' + c.id">
      <!-- Группа взвешиваний: ни серий, ни банка — вес и динамика -->
      <div v-if="c.kind === 'weight'" class="card challenge-card" @click="$emit('open-weight', c.id)">
        <div class="challenge-card-head">
          <div class="challenge-title">⚖️ {{ c.title }}</div>
          <span v-if="c.weight?.latestKg" class="fire">{{ formatKg(c.weight.latestKg) }} кг</span>
        </div>
        <div class="muted">{{ c.description }}</div>
        <div class="challenge-card-meta">
          <span v-if="c.weight?.count">{{ c.weight.count }} взвешиваний</span>
          <span v-else>Весы ещё не подключены</span>
          <span v-if="weekDelta(c)">{{ weekDelta(c) }}</span>
          <span class="chev">›</span>
        </div>
      </div>

      <!-- Планка: состояние дня, серия, банк -->
      <div v-else class="card challenge-card" @click="$emit('open-group', c.id)">
        <div class="challenge-card-head">
          <div class="challenge-title">{{ c.title }}</div>
          <span :class="'badge ' + dayState(c)">{{ STATE_LABEL[dayState(c)] }}</span>
        </div>
        <div class="muted">{{ c.description }}</div>
        <div class="challenge-card-meta">
          <span>День {{ c.dayNumber }}</span>
          <span class="fire">🔥 {{ c.currentStreak ?? 0 }}</span>
          <span>💰 {{ formatMoney(c.bank ?? 0) }}</span>
          <span class="chev">›</span>
        </div>
      </div>
    </template>

    <!-- Личные -->
    <h3 v-if="personal.length" style="margin: 18px 0 8px">Личные</h3>
    <div
      v-for="c in personal"
      :key="'p' + c.id"
      class="card challenge-card"
      @click="$emit('open-personal', c.id)"
    >
      <div class="challenge-card-head">
        <div class="challenge-title">💪 {{ c.title }}</div>
        <span class="fire">🔥 {{ c.currentStreak }}</span>
      </div>
      <div class="challenge-card-meta">
        <span>сегодня: {{ c.todayReps }} ({{ c.todaySets }} подх.)</span>
        <span>всего: {{ c.totalReps }} {{ c.unit }}</span>
        <span class="chev">›</span>
      </div>
    </div>

    <!-- Куда можно вступить -->
    <template v-if="available.length">
      <h3 style="margin: 18px 0 8px">Ещё доступно</h3>
      <div v-for="c in available" :key="'a' + c.id" class="card">
        <div class="challenge-card-head">
          <div class="challenge-title">{{ c.kind === 'weight' ? '⚖️ ' : '' }}{{ c.title }}</div>
        </div>
        <div class="muted">{{ c.description }}</div>
        <button class="btn" style="margin-top: 10px" @click="$emit('join', c.id)">Участвовать</button>
      </div>
    </template>

    <!-- Создать личный -->
    <div class="card">
      <h3>➕ Новый личный челлендж</h3>
      <div class="muted">
        Например: Подтягивания, Отжимания. Логируешь подходы и повторения — только для себя.
      </div>
      <input
        v-model="newTitle"
        placeholder="Название упражнения"
        style="margin-top: 10px"
        @keyup.enter="create"
      />
      <button class="btn" style="margin-top: 8px" @click="create">Создать</button>
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
