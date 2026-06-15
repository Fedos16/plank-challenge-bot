<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from './api';
import type { MyChallenge } from './types';
import ChallengeListView from './components/ChallengeListView.vue';
import ChallengeView from './components/ChallengeView.vue';
import AdminView from './components/AdminView.vue';

type Tab = 'challenges' | 'admin';

const tab = ref<Tab>('challenges');
const challenges = ref<MyChallenge[]>([]);
const userName = ref('');
const isAdmin = ref(false);
const selectedId = ref<number | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

const multiple = computed(() => challenges.value.length > 1);

async function load() {
  try {
    error.value = null;
    const res = await api.getMyChallenges();
    challenges.value = res.challenges;
    userName.value = res.user.name;
    isAdmin.value = res.user.isAdmin;
    // один челлендж — открываем сразу
    selectedId.value = res.challenges.length === 1 ? res.challenges[0]!.id : null;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Ошибка загрузки';
  } finally {
    loading.value = false;
  }
}

function openChallenge(id: number) {
  selectedId.value = id;
}
function backToList() {
  if (multiple.value) selectedId.value = null;
}
function goChallenges() {
  tab.value = 'challenges';
  if (multiple.value) selectedId.value = null;
}

onMounted(load);
</script>

<template>
  <div v-if="loading" class="center">Загрузка…</div>

  <div v-else-if="error" class="center">
    <div class="error-text">Не удалось загрузить данные.</div>
    <div class="muted">{{ error }}</div>
    <button class="btn small" @click="load">Повторить</button>
  </div>

  <template v-else>
    <div class="app">
      <!-- Админ -->
      <AdminView v-if="tab === 'admin' && isAdmin" />

      <!-- Челленджи -->
      <template v-else>
        <div v-if="challenges.length === 0" class="center">
          <div>🏁</div>
          <div>Вы пока не участвуете ни в одном челлендже.</div>
          <div class="muted">Откройте бота и нажмите /start, либо попросите администратора добавить вас.</div>
        </div>

        <ChallengeListView
          v-else-if="selectedId === null"
          :challenges="challenges"
          :user-name="userName"
          @select="openChallenge"
        />

        <ChallengeView
          v-else
          :challenge-id="selectedId"
          :can-go-back="multiple"
          @back="backToList"
        />
      </template>
    </div>

    <nav class="tabbar">
      <button :class="{ active: tab === 'challenges' }" @click="goChallenges">
        <span class="ico">🏆</span>{{ multiple ? 'Челленджи' : 'Челлендж' }}
      </button>
      <button v-if="isAdmin" :class="{ active: tab === 'admin' }" @click="tab = 'admin'">
        <span class="ico">⚙️</span>Админ
      </button>
    </nav>
  </template>
</template>
