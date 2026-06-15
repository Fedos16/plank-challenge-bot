<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { api } from '../api';
import type { ChallengePublic, Profile } from '../types';
import { haptic } from '../telegram';
import ProfileView from './ProfileView.vue';
import LeaderboardView from './LeaderboardView.vue';
import RulesView from './RulesView.vue';

const props = defineProps<{ challengeId: number; canGoBack: boolean }>();
defineEmits<{ (e: 'back'): void }>();

type Sub = 'profile' | 'board' | 'rules';
const sub = ref<Sub>('profile');
const info = ref<ChallengePublic | null>(null);
const profile = ref<Profile | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const sickBusy = ref(false);
const toast = ref<string | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function showToast(msg: string, ok = true) {
  toast.value = msg;
  haptic(ok ? 'success' : 'error');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = null), 2600);
}

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const [ch, me] = await Promise.all([
      api.getChallenge(props.challengeId),
      api.getMe(props.challengeId),
    ]);
    info.value = ch;
    profile.value = me;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Ошибка загрузки';
  } finally {
    loading.value = false;
  }
}

async function reloadProfile() {
  profile.value = await api.getMe(props.challengeId);
}

async function onReportSick() {
  if (sickBusy.value) return;
  sickBusy.value = true;
  try {
    const res = await api.reportSick(props.challengeId);
    if (res.valid) {
      showToast('🤒 Болезнь засчитана — штрафа не будет. Выздоравливай!');
    } else {
      showToast(`⚠️ Уже после ${res.sickDeadline} — освобождение от штрафа на усмотрение админа.`, false);
    }
    await reloadProfile();
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Ошибка', false);
  } finally {
    sickBusy.value = false;
  }
}

onMounted(load);
watch(() => props.challengeId, load);
</script>

<template>
  <div>
    <button v-if="canGoBack" class="back-link" @click="$emit('back')">‹ К челленджам</button>

    <div v-if="loading" class="center">Загрузка…</div>
    <div v-else-if="error || !info || !profile" class="center">
      <div class="error-text">Не удалось загрузить челлендж.</div>
      <div class="muted">{{ error }}</div>
      <button class="btn small" @click="load">Повторить</button>
    </div>

    <template v-else>
      <div class="subtabs">
        <button :class="{ active: sub === 'profile' }" @click="sub = 'profile'">Профиль</button>
        <button :class="{ active: sub === 'board' }" @click="sub = 'board'">Рейтинг</button>
        <button :class="{ active: sub === 'rules' }" @click="sub = 'rules'">Правила</button>
      </div>

      <ProfileView
        v-if="sub === 'profile'"
        :profile="profile"
        :challenge="info"
        :sick-busy="sickBusy"
        @report-sick="onReportSick"
      />
      <LeaderboardView v-else-if="sub === 'board'" :challenge-id="challengeId" :challenge="info" />
      <RulesView v-else :challenge="info" />
    </template>

    <div v-if="toast" class="toast">{{ toast }}</div>
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
</style>
