<script setup lang="ts">
import type { MuscleUnit } from '../types';
import { UNIT_LABEL } from '../fitness';

/** Переключатель «кг / %» строкой под полями: в подпись узкой колонки он не помещается. */
defineProps<{ modelValue: MuscleUnit; label: string; disabled?: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', unit: MuscleUnit): void }>();

const units: MuscleUnit[] = ['kg', 'percent'];
</script>

<template>
  <div class="unit-row">
    <span class="muted">{{ label }}</span>
    <span class="unit-toggle">
      <button
        v-for="u in units"
        :key="u"
        type="button"
        :class="{ active: modelValue === u }"
        :disabled="disabled"
        @click="emit('update:modelValue', u)"
      >
        {{ UNIT_LABEL[u] }}
      </button>
    </span>
  </div>
</template>

<style scoped>
.unit-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}
.unit-toggle {
  display: inline-flex;
  padding: 2px;
  border-radius: 10px;
  background: rgba(128, 128, 128, 0.14);
}
.unit-toggle button {
  border: none;
  background: none;
  color: var(--hint);
  font-size: 13px;
  font-weight: 600;
  min-width: 44px;
  padding: 6px 12px;
  border-radius: 8px;
  cursor: pointer;
}
.unit-toggle button.active {
  background: var(--button);
  color: var(--button-text);
}
</style>
