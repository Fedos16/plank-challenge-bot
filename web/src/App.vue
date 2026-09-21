<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from './api';
import type { AvailableChallenge, MyChallenge, PersonalSummary } from './types';
import ChallengeListView from './components/ChallengeListView.vue';
import ChallengeView from './components/ChallengeView.vue';
import PersonalChallengeView from './components/PersonalChallengeView.vue';
import WeightView from './components/WeightView.vue';
import AdminView from './components/AdminView.vue';

type Tab = 'challenges' | 'admin';

const tab = ref<Tab>('challenges');
const group = ref<MyChallenge[]>([]);
const personal = ref<PersonalSummary[]>([]);
const available = ref<AvailableChallenge[]>([]);
const userName = ref('');
const isAdmin = ref(false);
type Screen = 'group' | 'personal' | 'weight';

const selected = ref<{ kind: Screen; id: number } | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

/** Экран группового челленджа по его типу. Неизвестный тип остаётся в списке, а не открывается как планка. */
function screenFor(kind: string): Screen | null {
  if (kind === 'plank') return 'group';
  if (kind === 'weight') return 'weight';
  return null;
}

function openGroup(id: number, kind: string) {
  const screen = screenFor(kind);
  selected.value = screen ? { kind: screen, id } : null;
}

async function load(autoOpen = false) {
  try {
    error.value = null;
    const [my, pers] = await Promise.all([api.getMyChallenges(), api.getPersonal()]);
    group.value = my.challenges;
    personal.value = pers.challenges;
    available.value = my.available;
    userName.value = my.user.name;
    isAdmin.value = my.user.isAdmin;
    if (autoOpen && group.value.length + personal.value.length === 1) {
      const only = group.value[0];
      if (only) openGroup(only.id, only.kind);
      else selected.value = { kind: 'personal', id: personal.value[0]!.id };
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
/** После вступления сразу открываем челлендж — на экране его типа. */
async function joinChallenge(id: number) {
  try {
    const kind = available.value.find((c) => c.id === id)?.kind;
    await api.joinChallenge(id);
    await load();
    if (kind) openGroup(id, kind);
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
        <WeightView
          v-else-if="selected?.kind === 'weight'"
          :challenge-id="selected.id"
          @back="backToList"
          @left="backToList"
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
          :available="available"
          :user-name="userName"
          @open-group="(id: number) => (selected = { kind: 'group', id })"
          @open-weight="(id: number) => (selected = { kind: 'weight', id })"
          @open-personal="(id: number) => (selected = { kind: 'personal', id })"
          @join="joinChallenge"
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
