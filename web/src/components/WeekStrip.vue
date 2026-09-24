<script setup lang="ts">
import type { WeekDay } from '../types';
import { weekdayShortRu } from '../helpers';

/**
 * Полоска недели: день недели над квадратом, галочка за тренировку, приглушённый квадрат с
 * крестиком за прошедший день без неё, обводка и метка в центре у сегодняшнего. Один язык для
 * обзора, журнала и отчёта. tone=hero — на цветном листе (цвет листа — в --hero-ink), tone=card —
 * на обычном; size=sm — компактная. markToday=false — сегодня не выделяется (в отчёте неделю
 * разбирают, а не проживают).
 */
const props = withDefaults(
  defineProps<{ days: WeekDay[]; tone?: 'hero' | 'card'; size?: 'md' | 'sm'; markToday?: boolean }>(),
  { tone: 'hero', size: 'md', markToday: true },
);

function isToday(d: WeekDay): boolean {
  return props.markToday && d.isToday;
}

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
      :class="{ today: isToday(d), off: !d.inWindow && d.count === 0 }"
      :title="d.day"
    >
      <span class="dow">{{ weekdayShortRu(d.day) }}</span>
      <span class="day" :class="{ done: d.count > 0, missed: missed(d), today: isToday(d) }">
        {{ d.count > 0 ? '✓' : missed(d) ? '×' : '' }}
        <!-- сегодня, пока тренировки нет: метка — чтобы день читался как «сейчас», а не как пустой -->
        <span v-if="isToday(d) && d.count === 0" class="now" />
      </span>
    </div>
  </div>
</template>

<style scoped>
.days {
  display: flex;
  justify-content: center;
  gap: 7px;
}
.day-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
}
/* «ПН», «ВТ»: мелкий капс, как подписи в отчёте */
.dow {
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.75;
}
.day-col.today .dow {
  opacity: 1;
}
.day {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  border: 1.5px solid rgba(255, 255, 255, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  font-weight: 800;
  line-height: 1;
  box-sizing: border-box;
}
/* на цветном листе тренировка — белый квадрат с галочкой в цвет листа */
.day.done {
  background: #fff;
  border-color: #fff;
  color: var(--hero-ink, var(--accent));
}
/* прошедший день без тренировки: полупрозрачный белый, с белым крестиком */
.day.missed {
  background: rgba(255, 255, 255, 0.24);
  border-color: transparent;
  color: #fff;
  font-size: 13px;
}
/* сегодня: сплошная белая рамка */
.day.today {
  border: 2px solid #fff;
}
.now {
  width: 6px;
  height: 6px;
  border-radius: 2px;
  background: #fff;
}
/*
 * пустой день до вступления: пропуском его не считаем. Тренировка в такой день не бледнеет —
 * и норма, и зачёт идут по всей неделе челленджа
 */
.day-col.off {
  opacity: 0.3;
}

/* на обычном листе */
.tone-card .dow {
  color: var(--hint);
  opacity: 1;
}
.tone-card .day-col.today .dow {
  color: var(--text);
}
.tone-card .day {
  border-color: var(--rule);
}
.tone-card .day.done {
  background: var(--green);
  border-color: var(--green);
  color: #fff;
}
.tone-card .day.missed {
  background: var(--track);
  border-color: transparent;
  color: var(--hint);
}
.tone-card .now {
  background: var(--accent);
}
.tone-card .day.today {
  border-color: var(--accent);
}

/* компактная: в карточках и отчёте */
.size-sm {
  gap: 5px;
}
.size-sm .day-col {
  gap: 4px;
}
.size-sm .dow {
  font-size: 9px;
}
.size-sm .day {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  font-size: 12px;
}
.size-sm .now {
  width: 5px;
  height: 5px;
}
.size-sm .day.missed {
  font-size: 11px;
}
</style>
