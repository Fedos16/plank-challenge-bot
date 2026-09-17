<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';
import type { NotificationSetting, NotificationSettings } from '../types';
import { haptic } from '../telegram';

const props = defineProps<{ challengeId: number }>();

const data = ref<NotificationSettings | null>(null);
const loading = ref(true);
const busy = ref<string | null>(null);
const status = ref<string | null>(null);
let statusTimer: ReturnType<typeof setTimeout> | undefined;

function flash(msg: string, ok = true) {
  status.value = msg;
  haptic(ok ? 'success' : 'error');
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (status.value = null), 2000);
}

async function load() {
  try {
    data.value = await api.getNotifications(props.challengeId);
  } catch {
    data.value = null;
  } finally {
    loading.value = false;
  }
}

async function save(s: NotificationSetting, patch: { enabled?: boolean; time?: string | null }) {
  if (busy.value) return;
  busy.value = s.type;
  try {
    data.value = await api.updateNotification(props.challengeId, { type: s.type, ...patch });
    flash('Сохранено');
  } catch (e) {
    flash(e instanceof Error ? e.message : 'Не сохранилось', false);
  } finally {
    busy.value = null;
  }
}

function toggle(s: NotificationSetting) {
  void save(s, { enabled: !s.effectiveEnabled });
}

function pickTime(s: NotificationSetting, value: string) {
  void save(s, { time: value === '' ? null : value });
}

onMounted(load);
</script>

<template>
  <div class="card">
    <h3>Уведомления</h3>
    <div v-if="loading" class="muted">Загружаем…</div>
    <div v-else-if="!data" class="muted">Не удалось загрузить настройки.</div>

    <template v-else>
      <div v-for="s in data.settings" :key="s.type" class="notif-row">
        <label class="notif-toggle">
          <input
            type="checkbox"
            :checked="s.effectiveEnabled"
            :disabled="busy === s.type"
            @change="toggle(s)"
          />
          <span class="grow">
            <b>{{ s.title }}</b>
            <span class="muted notif-desc">{{ s.description }}</span>
          </span>
        </label>

        <label v-if="s.effectiveEnabled" class="field notif-time">
          <span class="lbl">Во сколько</span>
          <select
            :value="s.time ?? ''"
            :disabled="busy === s.type"
            @change="pickTime(s, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">Как у челленджа ({{ s.defaultTime }})</option>
            <option v-for="slot in data.slots" :key="slot" :value="slot">{{ slot }}</option>
          </select>
        </label>
        <div v-else class="muted notif-desc">Выключено — бот не будет писать в личку.</div>
      </div>

      <div class="muted notif-desc">
        Если бот не пишет в личку — открой его в Telegram и нажми «Старт».
      </div>
      <div v-if="status" class="notif-status">{{ status }}</div>
    </template>
  </div>
</template>

<style scoped>
.notif-row {
  padding: 4px 0 10px;
}
.notif-toggle {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
}
.notif-toggle input {
  width: auto;
  margin-top: 3px;
}
.notif-toggle .grow {
  flex: 1;
}
.notif-desc {
  display: block;
  font-size: 13px;
  margin-top: 2px;
}
.notif-time {
  margin: 10px 0 0;
}
.notif-status {
  font-size: 13px;
  color: var(--link);
}
</style>
