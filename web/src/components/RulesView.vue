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
      <div v-if="challenge.freezeEveryDays > 0 && challenge.maxFreezes > 0" class="list-item">
        <div class="grow">❄️ Заморозка серии</div>
        <b>1 за {{ challenge.freezeEveryDays }} дн. подряд, максимум {{ challenge.maxFreezes }}</b>
      </div>
    </div>

    <div v-if="challenge.freezeEveryDays > 0 && challenge.maxFreezes > 0" class="card">
      <h3>❄️ Как работает заморозка</h3>
      <div class="muted">
        За каждые {{ challenge.freezeEveryDays }} дней подряд даётся одна заморозка, на руках можно
        держать не больше {{ challenge.maxFreezes }}. Заморозку тратишь сам в своём профиле и только
        на пропущенный день — и не раньше того дня, когда заморозка заработана. Серия за этот день
        не прерывается, штраф за пропуск остаётся.
      </div>
    </div>
  </div>
</template>
