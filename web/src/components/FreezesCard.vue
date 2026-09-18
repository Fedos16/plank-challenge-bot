<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ApiError, api } from '../api';
import type { FreezableDay, FreezeOverview } from '../types';
import { formatDateRu, formatDateTimeRu } from '../helpers';
import { confirmAction, haptic } from '../telegram';

const props = defineProps<{ challengeId: number }>();
const emit = defineEmits<{ (e: 'used'): void }>();

const data = ref<FreezeOverview | null>(null);
const loading = ref(true);
const busy = ref<string | null>(null);
const status = ref<string | null>(null);
const statusOk = ref(true);
let statusTimer: ReturnType<typeof setTimeout> | undefined;

const ERRORS: Record<string, string> = {
  freezes_disabled: 'Заморозки сейчас выключены админом.',
  no_freezes_available: 'Свободных заморозок нет.',
  too_early: 'Этот день раньше, чем заработана заморозка.',
  day_not_missed: 'Заморозить можно только пропущенный день.',
  already_frozen: 'Этот день уже заморожен.',
  bad_day: 'Такой день заморозить нельзя.',
};

function flash(msg: string, ok = true) {
  status.value = msg;
  statusOk.value = ok;
  haptic(ok ? 'success' : 'error');
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (status.value = null), 3200);
}

async function load() {
  loading.value = true;
  try {
    data.value = await api.getFreezes(props.challengeId);
  } catch {
    data.value = null;
  } finally {
    loading.value = false;
  }
}

async function freeze(d: FreezableDay) {
  if (busy.value) return;
  const ok = await confirmAction(
    `Потратить заморозку на ${formatDateRu(d.day)} (день ${d.dayNumber})? Серия за этот день не прервётся, но штраф за пропуск останется.`,
  );
  if (!ok) return;
  busy.value = d.day;
  try {
    const res = await api.useFreeze(props.challengeId, d.day);
    data.value = res.freezes;
    flash(`❄️ День ${formatDateRu(d.day)} заморожен — серия цела.`);
    emit('used');
  } catch (e) {
    const code = e instanceof ApiError ? e.code : null;
    flash(code ? (ERRORS[code] ?? code) : 'Не получилось заморозить день', false);
    await load();
  } finally {
    busy.value = null;
  }
}

/** Сколько дней подряд уже набрано в текущем прогрессе к следующей заморозке. */
const progress = computed(() => {
  if (!data.value || !data.value.everyDays) return 0;
  return data.value.runLength % data.value.everyDays;
});

onMounted(load);
watch(() => props.challengeId, load);
defineExpose({ reload: load });
</script>

<template>
  <div v-if="loading || (data && data.enabled)" class="card">
    <h3>❄️ Заморозка серии</h3>

    <div v-if="loading" class="muted">Загружаем…</div>

    <template v-else-if="data">
      <div class="freeze-counters">
        <div class="freeze-counter">
          <div class="v">{{ data.available }}</div>
          <div class="k">Доступно</div>
        </div>
        <div class="freeze-counter">
          <div class="v">{{ data.used }}</div>
          <div class="k">Использовано</div>
        </div>
        <div class="freeze-counter">
          <div class="v">{{ data.earned }}</div>
          <div class="k">Заработано</div>
        </div>
      </div>

      <div class="muted freeze-note">
        Заморозка даётся за каждые {{ data.everyDays }} дней подряд, на руках держим максимум
        {{ data.max }}.
        <template v-if="data.available < data.max && data.daysToNext !== null">
          До следующей — {{ data.daysToNext }}
          {{ data.daysToNext === 1 ? 'день' : 'дн.' }} подряд (сейчас набрано {{ progress }}).
        </template>
        <template v-else-if="data.available >= data.max"> Больше накопить нельзя — лимит. </template>
      </div>

      <template v-if="data.available > 0">
        <div v-if="data.freezableDays.length" class="freeze-days">
          <div class="muted freeze-note">
            Выбери пропущенный день — серия за него не прервётся. Штраф за пропуск остаётся.
          </div>
          <div v-for="d in data.freezableDays" :key="d.day" class="list-item">
            <div class="grow">
              <b>{{ formatDateRu(d.day) }}</b>
              <div class="muted">День {{ d.dayNumber }} челленджа · пропуск</div>
            </div>
            <button class="btn small" :disabled="busy !== null" @click="freeze(d)">
              {{ busy === d.day ? '…' : 'Заморозить' }}
            </button>
          </div>
        </div>
        <div v-else class="muted freeze-note">
          Пропущенных дней, которые можно заморозить, нет. Заморозка сработает на пропуск не раньше
          дня, когда она заработана
          <template v-if="data.earliestUsableDay">
            ({{ formatDateRu(data.earliestUsableDay) }})</template
          >.
        </div>
      </template>
      <div v-else class="muted freeze-note">
        Пока нечего тратить: заморозка появится, когда наберёшь {{ data.everyDays }} дней подряд.
      </div>

      <div v-if="data.usages.length" class="freeze-history">
        <div class="freeze-history-title">История заморозок</div>
        <div v-for="u in data.usages" :key="u.day" class="list-item">
          <div class="grow">
            <b>❄️ {{ formatDateRu(u.day) }}</b>
            <div class="muted">
              заморожено {{ formatDateTimeRu(u.createdAt) }} · заработана за серию к
              {{ formatDateRu(u.earnedDay) }}
            </div>
          </div>
        </div>
      </div>

      <div v-if="status" class="freeze-status" :class="{ bad: !statusOk }">{{ status }}</div>
    </template>
  </div>
</template>

<style scoped>
.freeze-counters {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin: 4px 0 10px;
}
.freeze-counter {
  background: rgba(88, 166, 255, 0.1);
  border-radius: 12px;
  padding: 10px 6px;
  text-align: center;
}
.freeze-counter .v {
  font-size: 20px;
  font-weight: 700;
}
.freeze-counter .k {
  font-size: 12px;
  opacity: 0.7;
  margin-top: 2px;
}
.freeze-note {
  display: block;
  font-size: 13px;
  margin-bottom: 8px;
}
.freeze-days .list-item {
  align-items: center;
}
.freeze-history {
  margin-top: 10px;
  border-top: 1px solid rgba(128, 128, 128, 0.12);
  padding-top: 8px;
}
.freeze-history-title {
  font-size: 13px;
  font-weight: 600;
  opacity: 0.7;
  margin-bottom: 4px;
}
.freeze-status {
  margin-top: 8px;
  font-size: 13px;
  color: var(--link);
}
.freeze-status.bad {
  color: var(--red);
}
</style>
