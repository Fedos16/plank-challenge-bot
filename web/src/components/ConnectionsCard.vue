<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '../api';
import type { IntegrationsResponse } from '../types';
import { confirmAction, haptic, openExternal } from '../telegram';
import { formatDateTimeRu } from '../helpers';
import { errorText } from '../fitness';

/** После подключения приходит история тренировок — родителю стоит перечитать сводку. */
const emit = defineEmits<{ (e: 'changed'): void }>();

const data = ref<IntegrationsResponse | null>(null);
const busy = ref(false);
const error = ref<string | null>(null);
/** Ушли в браузер за согласием: по возвращении проверяем, подключилось ли. */
const awaitingReturn = ref(false);

const whoop = computed(() => data.value?.connected.find((c) => c.provider === 'whoop') ?? null);

async function load() {
  try {
    data.value = await api.getIntegrations();
  } catch (e) {
    error.value = errorText(e);
  }
}

async function connectWhoop() {
  if (busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    const { url } = await api.connectWhoop();
    awaitingReturn.value = true;
    openExternal(url);
  } catch (e) {
    error.value = errorText(e);
    haptic('error');
  } finally {
    busy.value = false;
  }
}

async function disconnectWhoop() {
  const ok = await confirmAction('Отключить WHOOP? Уже загруженные тренировки останутся, новые приходить перестанут.');
  if (!ok || busy.value) return;
  busy.value = true;
  try {
    await api.disconnectWhoop();
    await load();
    haptic('success');
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}

/**
 * Согласие даётся во внешнем браузере, и приложение об успехе узнать не может — только спросить
 * сервер, когда пользователь вернулся. История догружается в фоне, поэтому спрашиваем дважды.
 */
async function onVisible() {
  if (document.visibilityState !== 'visible' || !awaitingReturn.value) return;
  await load();
  if (whoop.value?.status !== 'active') return;
  awaitingReturn.value = false;
  haptic('success');
  emit('changed');
  setTimeout(() => emit('changed'), 5000);
}

onMounted(() => {
  void load();
  document.addEventListener('visibilitychange', onVisible);
});
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisible));
</script>

<template>
  <div v-if="data?.available.whoop" class="card">
    <h3>⌚ Подключения</h3>

    <div class="conn">
      <div class="grow">
        <div class="name">WHOOP</div>
        <div v-if="whoop?.status === 'active'" class="muted">
          Подключён · тренировки приходят сами
          <template v-if="whoop.lastSyncAt"><br />сверка: {{ formatDateTimeRu(whoop.lastSyncAt) }}</template>
        </div>
        <div v-else-if="whoop?.status === 'reauth_required'" class="error-text small">
          Доступ отозван или истёк — подключите заново
        </div>
        <div v-else class="muted">Тренировки, калории и пульс — автоматически</div>
      </div>
      <button v-if="whoop?.status === 'active'" class="btn small secondary" :disabled="busy" @click="disconnectWhoop">
        Отключить
      </button>
      <button v-else class="btn small" :disabled="busy" @click="connectWhoop">
        {{ whoop ? 'Подключить заново' : 'Подключить' }}
      </button>
    </div>

    <div v-if="awaitingReturn" class="muted" style="margin-top: 8px">
      Разрешите доступ в открывшемся браузере и вернитесь сюда — статус обновится сам.
    </div>
    <div v-if="error" class="error-text small" style="margin-top: 8px">{{ error }}</div>
    <div class="muted" style="margin-top: 10px">
      Если та же тренировка внесена и вручную, в зачёт пойдёт запись с браслета, а ручная пометится дублем.
    </div>
  </div>
</template>

<style scoped>
.conn {
  display: flex;
  align-items: center;
  gap: 12px;
}
.conn .grow {
  flex: 1;
  min-width: 0;
}
.conn .name {
  font-weight: 600;
}
.small {
  font-size: 13px;
}
</style>
