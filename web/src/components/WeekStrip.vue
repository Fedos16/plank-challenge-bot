<script setup lang="ts">
import type { WeekDay } from '../types';
import { weekdayShortRu } from '../helpers';

/**
 * Полоска недели: день недели над кружком, галочка за тренировку, приглушённый кружок с крестиком
 * за прошедший день без неё, обводка и точка в центре у сегодняшнего. Один язык для обзора и журнала.
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
  <div class="days" :class="[`tone-${tone}`, `size-${size}`]">
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
        <!-- сегодня, пока тренировки нет: точка — чтобы день читался как «сейчас», а не как пустой -->
        <span v-if="d.isToday && d.count === 0" class="now" />
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
/* прошедший день без тренировки: полупрозрачный белый на цветной подложке, с белым крестиком */
.day.missed {
  background: rgba(255, 255, 255, 0.28);
  border-color: rgba(255, 255, 255, 0.28);
  color: #fff;
  font-size: 13px;
}
/* сегодня: сплошная белая граница вместо полупрозрачной — поверх любого состояния */
.day.today {
  border-color: #fff;
}
.now {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #fff;
}
/* день до вступления: за него участник не отвечает */
.day-col.off {
  opacity: 0.3;
}

/* на белой карточке */
.tone-card .dow {
  color: var(--hint);
  opacity: 1;
}
.tone-card .day-col.today .dow {
  color: var(--text);
}
.tone-card .day {
  border-color: rgba(128, 128, 128, 0.35);
}
/* на белой карточке белый не виден — там пропуск серый */
.tone-card .day.missed {
  background: rgba(128, 128, 128, 0.28);
  border-color: rgba(128, 128, 128, 0.28);
  color: rgba(255, 255, 255, 0.9);
}
.tone-card .now {
  background: var(--accent);
}
.tone-card .day.today {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(255, 107, 53, 0.3);
}

/* компактная: в заголовках карточек */
.size-sm {
  gap: 5px;
}
.size-sm .day-col {
  gap: 3px;
}
.size-sm .dow {
  font-size: 10px;
}
.size-sm .day {
  width: 22px;
  height: 22px;
  font-size: 12px;
  border-width: 1.5px;
}
.size-sm .now {
  width: 5px;
  height: 5px;
}
.size-sm .day.missed {
  font-size: 11px;
}
.size-sm .day.today {
  box-shadow: 0 0 0 2px rgba(255, 107, 53, 0.3);
}
</style>
