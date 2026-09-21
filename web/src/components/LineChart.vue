<script setup lang="ts">
import { computed } from 'vue';
import { formatDateRu } from '../helpers';

/** Точки идут от старых к новым; рисуются равномерно по порядку, а не по времени. */
const props = defineProps<{
  points: { day: string; value: number }[];
  unit: string;
  /** Горизонтальная пунктирная линия — например, целевой вес. */
  target?: number | null;
}>();

const W = 320;
const H = 110;
const PAD = 12;

function format(n: number): string {
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

const chart = computed(() => {
  const points = props.points;
  if (points.length < 2) return null;

  const values = points.map((p) => p.value);
  const hasTarget = props.target !== null && props.target !== undefined;
  // цель входит в шкалу, иначе её линия окажется за краем графика
  const scale = hasTarget ? [...values, props.target as number] : values;
  const min = Math.min(...scale);
  const max = Math.max(...scale);
  const span = max - min || 1;
  const yOf = (v: number) => PAD + ((max - v) / span) * (H - PAD * 2);

  const coords = points.map((p, i) => ({
    x: PAD + (i / (points.length - 1)) * (W - PAD * 2),
    y: yOf(p.value),
  }));
  const line = coords.map((c) => c.x.toFixed(1) + ',' + c.y.toFixed(1)).join(' ');

  return {
    line,
    area: `${PAD},${H - PAD} ${line} ${W - PAD},${H - PAD}`,
    last: coords[coords.length - 1]!,
    targetY: hasTarget ? yOf(props.target as number) : null,
    range: `${format(Math.min(...values))}–${format(Math.max(...values))} ${props.unit}`,
    from: points[0]!.day,
    to: points[points.length - 1]!.day,
  };
});
</script>

<template>
  <div v-if="chart">
    <svg class="chart" :viewBox="'0 0 ' + W + ' ' + H" preserveAspectRatio="none">
      <polygon :points="chart.area" class="chart-area" />
      <line
        v-if="chart.targetY !== null"
        :x1="PAD"
        :x2="W - PAD"
        :y1="chart.targetY"
        :y2="chart.targetY"
        class="chart-target"
      />
      <polyline :points="chart.line" class="chart-line" />
      <circle :cx="chart.last.x" :cy="chart.last.y" r="3.5" class="chart-dot" />
    </svg>
    <div class="chart-legend">
      <span>{{ formatDateRu(chart.from) }}</span>
      <span class="muted">{{ chart.range }}</span>
      <span>{{ formatDateRu(chart.to) }}</span>
    </div>
  </div>
  <div v-else class="muted">График появится после второго замера.</div>
</template>

<style scoped>
.chart {
  width: 100%;
  height: 110px;
  display: block;
  margin: 6px 0 2px;
  overflow: visible;
}
.chart-line {
  fill: none;
  stroke: var(--link);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}
.chart-area {
  fill: var(--link);
  opacity: 0.12;
}
.chart-dot {
  fill: var(--link);
}
.chart-target {
  stroke: var(--green);
  stroke-width: 1.5;
  stroke-dasharray: 5 4;
  vector-effect: non-scaling-stroke;
}
.chart-legend {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--hint);
}
</style>
