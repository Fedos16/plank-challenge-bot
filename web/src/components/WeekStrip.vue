<script setup lang="ts">
import type { WeekDay } from '../types';
import { weekdayShortRu } from '../helpers';

/**
 * Полоска недели: день недели над кружком, галочка за тренировку, серый кружок с крестиком
 * за прошедший день без неё, обводка у сегодняшнего. Один язык для обзора и журнала.
 * tone=hero — на цветной подложке, tone=card — на белой карточке; size=sm — компактная.
 */
withDefaults(defineProps<{ days: WeekDay[]; tone?: 'hero' | 'card'; size?: 'md' | 'sm' }>(), {
  tone: 'hero',
  size: 'md',
});

/** Прошедший день зачётного окна без тренировки. */
function missed(d: WeekDay): boolean {
  return d.inWindow && !d.isToday && !d.isFuture && d.count === 0;
}
</script>

<template>
  <div class="days" :class="[tone, size]">
    <div
      v-for="d in days"
      :key="d.day"
      class="day-col"
      :class="{ today: d.isToday, off: !d.inWindow }"
      :title="d.day"
    >
      <span class="dow">{{ weekdayShortRu(d.day) }}</span>
      <span class="day" :class="{ done: d.count > 0, missed: missed(d), today: d.isToday }">
        {{ d.count > 0 ? '✓' : missed(d) ? '×' : '' }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.days {
  display: flex;
  justify-content: center;
  gap: 8px;
}
.day-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.dow {
  font-size: 11px;
  line-height: 1;
  opacity: 0.75;
}
.day-col.today .dow {
  opacity: 1;
  font-weight: 800;
}
.day {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 800;
  box-sizing: border-box;
}
/* тренировка была: зелёный кружок с галочкой */
.day.done {
  background: var(--green);
  border-color: var(--green);
  color: #fff;
}
/* прошедший день без тренировки: приглушённый серый, почти закрашенный, с бледным крестиком */
.day.missed {
  background: rgba(150, 150, 158, 0.85);
  border-color: rgba(150, 150, 158, 0.85);
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
}
/* сегодня: заметная обводка поверх любого состояния */
.day.today {
  border-color: #fff;
  box-shadow: 0 0 0 2.5px #fff;
}
/* день до вступления: за него участник не отвечает */
.day-col.off {
  opacity: 0.3;
}

/* на белой карточке */
.card .dow {
  color: var(--hint);
  opacity: 1;
}
.card .day-col.today .dow {
  color: var(--text);
}
.card .day {
  border-color: rgba(128, 128, 128, 0.35);
}
.card .day.missed {
  background: rgba(128, 128, 128, 0.28);
  border-color: rgba(128, 128, 128, 0.28);
  color: rgba(255, 255, 255, 0.9);
}
.card .day.today {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(255, 107, 53, 0.3);
}

/* компактная: в заголовках карточек */
.sm {
  gap: 5px;
}
.sm .day-col {
  gap: 3px;
}
.sm .dow {
  font-size: 10px;
}
.sm .day {
  width: 22px;
  height: 22px;
  font-size: 12px;
  border-width: 1.5px;
}
.sm .day.missed {
  font-size: 11px;
}
.sm .day.today {
  box-shadow: 0 0 0 2px rgba(255, 107, 53, 0.3);
}
</style>
