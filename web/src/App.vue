<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from './api';
import type { MyChallenge, PersonalSummary } from './types';
import ChallengeListView from './components/ChallengeListView.vue';
import ChallengeView from './components/ChallengeView.vue';
import PersonalChallengeView from './components/PersonalChallengeView.vue';
import AdminView from './components/AdminView.vue';

type Tab = 'challenges' | 'admin';

const tab = ref<Tab>('challenges');
const group = ref<MyChallenge[]>([]);
const personal = ref<PersonalSummary[]>([]);
const userName = ref('');
const isAdmin = ref(false);
const selected = ref<{ kind: 'group' | 'personal'; id: number } | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

async function load(autoOpen = false) {
  try {
    error.value = null;
    const [my, pers] = await Promise.all([api.getMyChallenges(), api.getPersonal()]);
    group.value = my.challenges;
    personal.value = pers.challenges;
    userName.value = my.user.name;
    isAdmin.value = my.user.isAdmin;
    if (autoOpen && group.value.length + personal.value.length === 1) {
      selected.value = group.value.length === 1
        ? { kind: 'group', id: group.value[0]!.id }
        : { kind: 'personal', id: personal.value[0]!.id };
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Ошибка загрузки';
  } finally {
    loading.value = false;
  }
}

function backToList() {
  selected.value = null;
  void load();
}
async function createPersonal(title: string) {
  try {
    const r = await api.createPersonal(title);
    await load();
    selected.value = { kind: 'personal', id: r.id };
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Ошибка';
  }
}
function goChallenges() {
  tab.value = 'challenges';
  selected.value = null;
  void load();
}

onMounted(() => load(true));
</script>

<template>
  <div v-if="loading" class="center">Загрузка…</div>

  <div v-else-if="error" class="center">
    <div class="error-text">Не удалось загрузить данные.</div>
    <div class="muted">{{ error }}</div>
    <button class="btn small" @click="() => load()">Повторить</button>
  </div>

  <template v-else>
    <div class="app">
      <AdminView v-if="tab === 'admin' && isAdmin" />
      <template v-else>
        <PersonalChallengeView
          v-if="selected?.kind === 'personal'"
          :challenge-id="selected.id"
          @back="backToList"
          @deleted="backToList"
        />
        <ChallengeView
          v-else-if="selected?.kind === 'group'"
          :challenge-id="selected.id"
          :can-go-back="true"
          @back="backToList"
        />
        <ChallengeListView
          v-else
          :group="group"
          :personal="personal"
          :user-name="userName"
          @open-group="(id: number) => (selected = { kind: 'group', id })"
          @open-personal="(id: number) => (selected = { kind: 'personal', id })"
          @create="createPersonal"
        />
      </template>
    </div>

    <nav class="tabbar">
      <button :class="{ active: tab === 'challenges' }" @click="goChallenges">
        <span class="ico">🏆</span>Челленджи
      </button>
      <button v-if="isAdmin" :class="{ active: tab === 'admin' }" @click="tab = 'admin'">
        <span class="ico">⚙️</span>Админ
      </button>
    </nav>
  </template>
</template>
