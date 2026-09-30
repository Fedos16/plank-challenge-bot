<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ApiError, api } from '../api';
import type { ProfileChallenge, UserProfile } from '../types';
import { STATE_LABEL, initials } from '../helpers';
import { hearts } from '../fitness';
import { haptic } from '../telegram';
import ProfileHistory from './ProfileHistory.vue';

/**
 * Профиль человека: свой — вкладкой «Профиль», чужой — по тапу на участника в рейтинге или
 * ленте. Чужой виден, только если вы вместе хотя бы в одном челлендже, и в нём — только
 * общие челленджи. Своё имя можно поменять: оно заменит имя из Telegram в отчётах и рейтингах.
 */
const props = defineProps<{ userId: number | 'me'; canGoBack?: boolean }>();
const emit = defineEmits<{
  (e: 'back'): void;
  (e: 'open-challenge', id: number, kind: string): void;
  (e: 'open-personal', id: number): void;
  (e: 'renamed', name: string): void;
}>();

const profile = ref<UserProfile | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

/** Чей челлендж раскрыт с историей. Единственный раскрывается сразу — выбирать не из чего. */
const expanded = ref<number | null>(null);

function toggle(id: number) {
  expanded.value = expanded.value === id ? null : id;
}

const editing = ref(false);
const nameInput = ref('');
const saving = ref(false);
const nameError = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    profile.value = await api.getUserProfile(props.userId);
    const only = profile.value.challenges.length === 1 ? profile.value.challenges[0] : null;
    expanded.value = only ? only.id : null;
  } catch (e) {
    profile.value = null;
    error.value =
      e instanceof ApiError && e.status === 404
        ? 'Профиль виден только участникам общих челленджей.'
        : e instanceof Error
          ? e.message
          : 'Ошибка загрузки';
  } finally {
    loading.value = false;
  }
}

function startEdit() {
  nameInput.value = profile.value?.nameSettings?.customName ?? '';
  nameError.value = null;
  editing.value = true;
}

async function saveName(value = nameInput.value) {
  saving.value = true;
  nameError.value = null;
  try {
    const r = await api.setMyName(value);
    if (profile.value?.nameSettings) {
      profile.value.user.name = r.name;
      profile.value.nameSettings.customName = r.customName;
    }
    editing.value = false;
    haptic('success');
    emit('renamed', r.name);
  } catch (e) {
    nameError.value = e instanceof Error ? e.message : 'Не удалось сохранить';
    haptic('error');
  } finally {
    saving.value = false;
  }
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const since = computed(() => {
  if (!profile.value) return '';
  // с числом месяц идёт в родительном падеже: «с 28 сентября 2026»
  const d = new Date(profile.value.user.memberSince);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).replace(/\s*г\.$/, '');
});

const workoutHours = computed(() => {
  const w = profile.value?.stats.workouts;
  if (!w) return '';
  return w.minutes >= 60 ? `${Math.round(w.minutes / 6) / 10} ч` : `${w.minutes} мин`;
});

function fitnessLine(c: ProfileChallenge): string {
  const f = c.fitness;
  if (!f) return '';
  if (f.eliminated) return 'выбыл';
  if (f.phase === 'upcoming') return 'скоро старт';
  if (f.phase === 'finished') return 'завершён';
  return f.week ? `${f.week.done} из ${f.week.required} на этой неделе` : '';
}

onMounted(load);
watch(() => props.userId, load);
</script>

<template>
  <div>
    <button v-if="canGoBack" class="back-link" @click="$emit('back')">‹ Назад</button>

    <div v-if="loading" class="center">Загрузка…</div>
    <div v-else-if="error || !profile" class="center">
      <div class="muted">{{ error }}</div>
      <button v-if="canGoBack" class="btn small" @click="$emit('back')">Назад</button>
    </div>

    <template v-else>
      <!-- Шапка: аватар, имя, с какого времени с нами -->
      <div class="card head">
        <img v-if="profile.user.photoUrl" :src="profile.user.photoUrl" class="avatar" alt="" />
        <div v-else class="avatar">{{ initials(profile.user.name) }}</div>

        <template v-if="!editing">
          <div class="who">{{ profile.user.name }}</div>
          <div v-if="profile.user.username" class="muted">@{{ profile.user.username }}</div>
          <div class="muted">с нами с {{ since }}</div>
          <button v-if="profile.isMe" class="btn small secondary edit" @click="startEdit">
            ✏️ Изменить имя
          </button>
        </template>

        <div v-else class="edit-form">
          <input
            v-model="nameInput"
            maxlength="40"
            :placeholder="profile.nameSettings?.telegramName"
            @keyup.enter="saveName()"
          />
          <div class="muted hint">
            Это имя увидят все: в отчётах, рейтингах и ленте. Пустое — будет как в Telegram
            ({{ profile.nameSettings?.telegramName }}).
          </div>
          <div v-if="nameError" class="error-text">{{ nameError }}</div>
          <div class="edit-actions">
            <button class="btn small" :disabled="saving" @click="saveName()">Сохранить</button>
            <button class="btn small secondary" :disabled="saving" @click="editing = false">Отмена</button>
          </div>
          <button
            v-if="profile.nameSettings?.customName"
            class="link-btn"
            :disabled="saving"
            @click="saveName('')"
          >
            Вернуть имя из Telegram
          </button>
        </div>
      </div>

      <!-- Сводка -->
      <div class="stats">
        <div class="stat">
          <div class="v">{{ profile.stats.challenges }}</div>
          <div class="l">{{ plural(profile.stats.challenges, 'челлендж', 'челленджа', 'челленджей') }}</div>
        </div>
        <div v-if="profile.stats.bestStreak" class="stat">
          <div class="v fire">🔥 {{ profile.stats.bestStreak }}</div>
          <div class="l">лучшая серия</div>
        </div>
        <div v-if="profile.stats.workouts?.count" class="stat">
          <div class="v">{{ profile.stats.workouts.count }}</div>
          <div class="l">
            {{ plural(profile.stats.workouts.count, 'тренировка', 'тренировки', 'тренировок') }},
            {{ workoutHours }}
          </div>
        </div>
      </div>

      <!-- Групповые челленджи -->
      <div class="card">
        <h3>{{ profile.isMe ? 'Мои челленджи' : 'Общие челленджи' }}</h3>
        <div v-if="!profile.challenges.length" class="muted">Пока ни в одном челлендже.</div>
        <template v-for="c in profile.challenges" :key="c.id">
          <div class="row tappable" :class="{ open: expanded === c.id }" @click="toggle(c.id)">
            <div class="name">
              {{ c.kind === 'fitness' ? '🏋️ ' : '' }}{{ c.title }}
              <div v-if="c.plank" class="meta">
                сделано: {{ c.plank.doneCount }} · рекорд: {{ c.plank.maxStreak }} ·
                сегодня: {{ STATE_LABEL[c.plank.todayState].toLowerCase() }}
              </div>
              <div v-else-if="c.fitness" class="meta">
                {{ fitnessLine(c) }}
                <template v-if="typeof c.fitness.progressPercent === 'number'">
                  · 🎯 {{ c.fitness.progressPercent }}%
                </template>
              </div>
            </div>
            <div v-if="c.plank" class="fire">🔥 {{ c.plank.currentStreak }}</div>
            <div v-else-if="c.fitness?.outOfCompetition" class="muted">вне зачёта</div>
            <div v-else-if="c.fitness" class="lives">{{ hearts(c.fitness.livesLeft, c.fitness.livesTotal) }}</div>
            <span class="chev">›</span>
          </div>
          <div v-if="expanded === c.id" class="expanded">
            <ProfileHistory :user-id="profile.isMe ? 'me' : profile.user.id" :challenge-id="c.id" />
            <button v-if="profile.isMe" class="link-btn" @click="$emit('open-challenge', c.id, c.kind)">
              Открыть челлендж ›
            </button>
          </div>
        </template>
      </div>

      <!-- Личные — только в своём профиле -->
      <div v-if="profile.personal?.length" class="card">
        <h3>Личные</h3>
        <div
          v-for="p in profile.personal"
          :key="p.id"
          class="row tappable"
          @click="$emit('open-personal', p.id)"
        >
          <div class="name">
            💪 {{ p.title }}
            <div class="meta">всего: {{ p.totalReps }} {{ p.unit }}</div>
          </div>
          <div class="fire">🔥 {{ p.currentStreak }}</div>
          <span class="chev">›</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.back-link {
  background: none;
  border: none;
  color: var(--link);
  font-size: 15px;
  padding: 0 0 12px;
  cursor: pointer;
}
.head {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 2px;
}
.avatar {
  width: 88px;
  height: 88px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--button);
  color: var(--button-text);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--display);
  font-size: 30px;
  font-weight: 700;
  margin-bottom: 10px;
}
.who {
  font-family: var(--display);
  font-size: 22px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: -0.01em;
  overflow-wrap: anywhere;
}
.edit {
  margin-top: 12px;
}
.edit-form {
  width: 100%;
  text-align: left;
}
.edit-form .hint {
  margin-top: 6px;
  font-size: 13px;
}
.edit-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.link-btn {
  background: none;
  border: none;
  color: var(--link);
  padding: 10px 0 0;
  font-size: 14px;
  cursor: pointer;
}
.stats {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.stat {
  flex: 1;
  min-width: 0;
  background: var(--secondary-bg);
  border-radius: var(--radius-sm);
  padding: 12px 10px;
  text-align: center;
}
.stat .v {
  font-family: var(--display);
  font-size: 20px;
  font-weight: 800;
}
.stat .l {
  font-size: 12px;
  color: var(--hint);
}
.tappable {
  cursor: pointer;
}
.chev {
  font-size: 22px;
  color: var(--hint);
  transition: transform 0.15s ease;
}
/* раскрытый челлендж: стрелка вниз, история под строкой */
.row.open {
  border-bottom: none;
}
.row.open .chev {
  transform: rotate(90deg);
}
.expanded {
  padding-bottom: 8px;
  border-bottom: 1px solid var(--rule);
}
.expanded:last-child {
  border-bottom: none;
}
.lives {
  font-size: 13px;
  white-space: nowrap;
}
</style>
