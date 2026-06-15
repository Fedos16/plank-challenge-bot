<script setup lang="ts">
import type { ChallengePublic, Profile } from '../types';
import { STATE_LABEL, formatMoney, initials } from '../helpers';

defineProps<{ profile: Profile; challenge: ChallengePublic }>();
</script>

<template>
  <div>
    <div class="profile-head">
      <img v-if="profile.user.photoUrl" class="avatar" :src="profile.user.photoUrl" alt="" />
      <div v-else class="avatar">{{ initials(profile.user.name) }}</div>
      <div>
        <div class="profile-name">{{ profile.user.name }}</div>
        <div class="muted">День {{ challenge.dayNumber }} · «{{ challenge.title }}»</div>
      </div>
    </div>

    <div class="streak-hero">
      <div class="num">🔥 {{ profile.streak.current }}</div>
      <div class="lbl">текущая серия (рекорд: {{ profile.streak.max }})</div>
    </div>

    <div class="card" style="display: flex; justify-content: space-between; align-items: center">
      <div>
        <div class="muted">Сегодня</div>
        <div style="font-weight: 700; font-size: 17px">Статус планки</div>
      </div>
      <span :class="`badge ${profile.todayState}`">{{ STATE_LABEL[profile.todayState] }}</span>
    </div>

    <div class="stats-grid">
      <div class="stat">
        <div class="v">{{ profile.totals.done }}</div>
        <div class="k">Сделано планок</div>
      </div>
      <div class="stat">
        <div class="v">{{ profile.totals.sick }}</div>
        <div class="k">Больничных</div>
      </div>
      <div class="stat">
        <div class="v">{{ profile.totals.missed }}</div>
        <div class="k">Пропусков</div>
      </div>
      <div class="stat">
        <div class="v">{{ formatMoney(profile.totals.finesTotal) }}</div>
        <div class="k">Мои штрафы</div>
      </div>
    </div>

    <div class="bank-chip" style="margin-top: 12px">
      <span>💰 Общий банк</span>
      <span class="v">{{ formatMoney(challenge.bank) }}</span>
    </div>

    <div class="card">
      <div class="muted">
        Кружок присылай в общий чат до {{ challenge.dailyDeadline }} (минимум
        {{ challenge.minDurationSec }} сек). Заболел — напиши боту /sick до {{ challenge.sickDeadline }}.
      </div>
    </div>
  </div>
</template>
