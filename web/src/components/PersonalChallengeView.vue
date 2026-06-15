<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { api } from '../api';
import type { PersonalDetail } from '../types';
import { confirmAction, haptic } from '../telegram';
import { formatDateRu } from '../helpers';

const props = defineProps<{ challengeId: number }>();
const emit = defineEmits<{ (e: 'back'): void; (e: 'deleted'): void }>();

const detail = ref<PersonalDetail | null>(null);
const loading = ref(true);
const reps = ref<number | null>(null);
const busy = ref(false);

async function load() {
  loading.value = true;
  try {
    detail.value = await api.getPersonalDetail(props.challengeId);
  } finally {
    loading.value = false;
  }
}

async function addSet() {
  const n = Math.trunc(Number(reps.value));
  if (!Number.isInteger(n) || n <= 0 || busy.value) return;
  busy.value = true;
  try {
    await api.addSet(props.challengeId, n);
    reps.value = null;
    haptic('success');
    await load();
  } catch {
    haptic('error');
  } finally {
    busy.value = false;
  }
}

async function removeSet(setId: number) {
  if (busy.value) return;
  busy.value = true;
  try {
    await api.deleteSet(props.challengeId, setId);
    await load();
  } finally {
    busy.value = false;
  }
}

async function del() {
  const ok = await confirmAction('Удалить этот личный челлендж со всей историей?');
  if (!ok) return;
  await api.deletePersonal(props.challengeId);
  emit('deleted');
}

onMounted(load);
watch(() => props.challengeId, load);
</script>

<template>
  <div>
    <button class="back-link" @click="$emit('back')">‹ К челленджам</button>

    <div v-if="loading" class="center">Загрузка…</div>
    <div v-else-if="!detail" class="center">
      <div class="error-text">Челлендж не найден.</div>
      <button class="btn small" @click="$emit('back')">Назад</button>
    </div>

    <template v-else>
      <div class="profile-head">
        <div class="avatar">💪</div>
        <div>
          <div class="profile-name">{{ detail.title }}</div>
          <div class="muted">Личный челлендж · {{ detail.unit }}</div>
        </div>
      </div>

      <div class="streak-hero">
        <div class="num">🔥 {{ detail.streak }}</div>
        <div class="lbl">дней подряд (рекорд дня: {{ detail.totals.bestDayReps }})</div>
      </div>

      <!-- Сегодня -->
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: baseline">
          <h3 style="margin: 0">Сегодня</h3>
          <div style="font-weight: 700">{{ detail.today.totalReps }} {{ detail.unit }}</div>
        </div>

        <div v-if="detail.today.sets.length" class="sets">
          <span v-for="(s, i) in detail.today.sets" :key="s.id" class="set-chip">
            #{{ i + 1 }}: {{ s.reps }}
            <button class="set-x" :disabled="busy" @click="removeSet(s.id)">✕</button>
          </span>
        </div>
        <div v-else class="muted" style="margin: 8px 0">Подходов пока нет — добавь первый.</div>

        <div class="add-set">
          <input
            type="number"
            inputmode="numeric"
            min="1"
            v-model.number="reps"
            placeholder="Повторений в подходе"
            @keyup.enter="addSet"
          />
          <button class="btn" :disabled="busy" @click="addSet">＋ Подход</button>
        </div>
      </div>

      <!-- Статистика -->
      <div class="stats-grid">
        <div class="stat">
          <div class="v">{{ detail.totals.totalReps }}</div>
          <div class="k">Всего {{ detail.unit }}</div>
        </div>
        <div class="stat">
          <div class="v">{{ detail.totals.totalSets }}</div>
          <div class="k">Всего подходов</div>
        </div>
        <div class="stat">
          <div class="v">{{ detail.totals.daysActive }}</div>
          <div class="k">Дней с тренировкой</div>
        </div>
        <div class="stat">
          <div class="v">{{ detail.totals.bestDayReps }}</div>
          <div class="k">Лучший день</div>
        </div>
      </div>

      <!-- История -->
      <div class="card" v-if="detail.history.length">
        <h3>История</h3>
        <div v-for="h in detail.history" :key="h.day" class="row">
          <div class="name">{{ formatDateRu(h.day) }}</div>
          <div class="meta">{{ h.setCount }} подх.</div>
          <div class="fire">{{ h.totalReps }}</div>
        </div>
      </div>

      <button class="btn danger" @click="del">Удалить челлендж</button>
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
.sets {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 10px 0;
}
.set-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(128, 128, 128, 0.15);
  border-radius: 20px;
  padding: 6px 10px;
  font-weight: 600;
  font-size: 14px;
}
.set-x {
  border: none;
  background: none;
  color: var(--red);
  cursor: pointer;
  font-size: 13px;
  padding: 0;
}
.add-set {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.add-set input {
  flex: 1;
}
.add-set .btn {
  width: auto;
  white-space: nowrap;
}
</style>
