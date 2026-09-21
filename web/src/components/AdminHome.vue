<script setup lang="ts">
import { ref } from 'vue';
import AdminView from './AdminView.vue';
import AdminFitnessView from './AdminFitnessView.vue';

/** Планка одна и настраивается своим экраном; фитнес-челленджей может быть несколько. */
const mode = ref<'plank' | 'fitness'>('plank');
</script>

<template>
  <div>
    <div class="mode-switch">
      <button :class="{ active: mode === 'plank' }" @click="mode = 'plank'">Планка</button>
      <button :class="{ active: mode === 'fitness' }" @click="mode = 'fitness'">🏋️ Фитнес</button>
    </div>
    <AdminView v-if="mode === 'plank'" />
    <AdminFitnessView v-else />
  </div>
</template>

<style scoped>
.mode-switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 4px;
  margin-bottom: 12px;
  border-radius: 12px;
  background: rgba(128, 128, 128, 0.12);
}
.mode-switch button {
  border: none;
  background: none;
  color: var(--text);
  padding: 8px;
  border-radius: 9px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.mode-switch button.active {
  background: var(--secondary-bg);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}
</style>
