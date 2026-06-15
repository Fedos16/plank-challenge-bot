<script setup lang="ts">
import type { ChallengePublic } from '../types';
import { formatMoney } from '../helpers';

defineProps<{ challenge: ChallengePublic }>();
</script>

<template>
  <div>
    <div class="card">
      <h2>{{ challenge.title }}</h2>
      <div class="muted">{{ challenge.description }}</div>
    </div>

    <div class="card">
      <div class="rules">{{ challenge.rulesText }}</div>
    </div>

    <div class="card">
      <h3>Параметры</h3>
      <div class="list-item">
        <div class="grow">Минимум планки</div>
        <b>{{ challenge.minDurationSec }} сек</b>
      </div>
      <div class="list-item">
        <div class="grow">Дедлайн кружка</div>
        <b>{{ challenge.dailyDeadline }}</b>
      </div>
      <div class="list-item">
        <div class="grow">Дедлайн болезни</div>
        <b>{{ challenge.sickDeadline }}</b>
      </div>
      <div class="list-item">
        <div class="grow">Штраф за пропуск</div>
        <b>{{ formatMoney(challenge.fineAmount) }}</b>
      </div>
      <div class="list-item">
        <div class="grow">Штраф за фейк (×{{ challenge.fakeFineMultiplier }})</div>
        <b>{{ formatMoney(challenge.fineAmount * challenge.fakeFineMultiplier) }}</b>
      </div>
    </div>
  </div>
</template>
