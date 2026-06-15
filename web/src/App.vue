<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from './api';
import type { ChallengePublic, Profile } from './types';
import ProfileView from './components/ProfileView.vue';
import LeaderboardView from './components/LeaderboardView.vue';
import RulesView from './components/RulesView.vue';
import AdminView from './components/AdminView.vue';

type Tab = 'profile' | 'board' | 'rules' | 'admin';

const tab = ref<Tab>('profile');
const profile = ref<Profile | null>(null);
const challenge = ref<ChallengePublic | null>(null);
const error = ref<string | null>(null);
const loading = ref(true);

async function load() {
  try {
    error.value = null;
    const [me, ch] = await Promise.all([api.getMe(), api.getChallenge()]);
    profile.value = me;
    challenge.value = ch;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Ошибка загрузки';
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div v-if="loading" class="center">Загрузка…</div>

  <div v-else-if="error || !profile || !challenge" class="center">
    <div class="error-text">Не удалось загрузить данные.</div>
    <div class="muted">{{ error }}</div>
    <button class="btn small" @click="load">Повторить</button>
  </div>

  <template v-else>
    <div class="app">
      <ProfileView v-if="tab === 'profile'" :profile="profile" :challenge="challenge" />
      <LeaderboardView v-else-if="tab === 'board'" :challenge="challenge" />
      <RulesView v-else-if="tab === 'rules'" :challenge="challenge" />
      <AdminView v-else-if="tab === 'admin' && profile.isAdmin" />
    </div>

    <nav class="tabbar">
      <button :class="{ active: tab === 'profile' }" @click="tab = 'profile'">
        <span class="ico">👤</span>Профиль
      </button>
      <button :class="{ active: tab === 'board' }" @click="tab = 'board'">
        <span class="ico">🏆</span>Рейтинг
      </button>
      <button :class="{ active: tab === 'rules' }" @click="tab = 'rules'">
        <span class="ico">📋</span>Правила
      </button>
      <button v-if="profile.isAdmin" :class="{ active: tab === 'admin' }" @click="tab = 'admin'">
        <span class="ico">⚙️</span>Админ
      </button>
    </nav>
  </template>
</template>
