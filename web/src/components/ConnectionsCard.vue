<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '../api';
import type { HubInfo, HubProvider, IntegrationsResponse } from '../types';
import { confirmAction, haptic, openExternal } from '../telegram';
import { formatDateTimeRu } from '../helpers';
import { errorText } from '../fitness';

/** После подключения приходит история тренировок — родителю стоит перечитать сводку. */
const emit = defineEmits<{ (e: 'changed'): void }>();

const data = ref<IntegrationsResponse | null>(null);
const busy = ref(false);
const error = ref<string | null>(null);
const copied = ref<string | null>(null);
/** Ушли в браузер за согласием WHOOP: по возвращении проверяем, подключилось ли. */
const awaitingReturn = ref(false);
/** Какой хаб сейчас раскрыт с инструкцией. */
const openHub = ref<HubProvider | null>(null);
/** Раскрыта ли подсказка админу, как включить WHOOP на сервере. */
const whoopHelp = ref(false);

const whoop = computed(() => data.value?.connected.find((c) => c.provider === 'whoop') ?? null);

interface HubGuide {
  title: string;
  covers: string;
  note: string;
  steps: string[];
  /** Откуда взять приложение, если магазин — не лучший вариант. */
  download?: { label: string; url: string };
}

const HUBS: Record<HubProvider, HubGuide> = {
  hae: {
    title: 'iPhone · Apple Watch',
    covers: 'Всё, что пишет в «Здоровье»: Apple Watch, Garmin, Polar, Suunto, а также вес и состав тела с умных весов',
    note: 'Автоматизации в Health Auto Export — платная функция приложения. Процента воды в «Здоровье» нет, эта графа у iPhone останется пустой.',
    steps: [
      'Установите Health Auto Export из App Store и дайте ему доступ к тренировкам и показателям здоровья.',
      'Automations → New Automation → тип REST API.',
      'URL — адрес ниже. В Headers добавьте Authorization со значением ниже.',
      'Data Type — Workouts, Export Format — JSON, версия экспорта — v2. Маршрут и подробные метрики лучше выключить: выгрузка будет легче.',
      'Включите автоматизацию и нажмите Manual Export — первая выгрузка подтянет историю.',
      'Чтобы приходил вес, создайте вторую автоматизацию REST API — одна выгружает только один тип данных. Адрес и Authorization те же, Data Type — Health Metrics, Export Format — JSON, v2.',
      'В её списке метрик отметьте только Weight & Body Mass, Body Fat Percentage и Lean Body Mass: со всеми галочками выгрузка весит десятки мегабайт. Включите её и тоже нажмите Manual Export.',
    ],
  },
  health_connect: {
    title: 'Android · браслеты и часы',
    covers: 'Всё, что пишет в Health Connect: Mi Fitness, Zepp (Amazfit), Samsung Health, Garmin, Polar, а также вес и состав тела с умных весов',
    note: 'Huawei Health в Health Connect напрямую не пишет — таким участникам проще вносить тренировки вручную.',
    // В Google Play приложение платное, но у него открытый код и автор сам выкладывает
    // бесплатную сборку в релизах на GitHub — та же программа, без магазина.
    download: {
      label: 'Скачать бесплатную сборку (GitHub)',
      url: 'https://github.com/mcnaveen/health-connect-webhook/releases/latest',
    },
    steps: [
      'В приложении браслета включите синхронизацию с Health Connect (обычно «Профиль» → «Подключённые приложения»).',
      'Скачайте по кнопке ниже файл app-foss-release.apk и установите его: Android попросит разрешить установку из браузера — это нормально. В Google Play то же приложение платное, эта сборка — бесплатная, от самого автора.',
      'Откройте Health Connect Webhook и разрешите читать Exercise, Active calories и Heart rate.',
      'Чтобы приходил вес, разрешите там же Weight, Body fat, Lean body mass и Body water mass.',
      'Добавьте Webhook URL — адрес ниже. В Custom headers добавьте Authorization со значением ниже.',
      'Включите фоновую синхронизацию и нажмите Sync now.',
    ],
  },
};

async function load() {
  try {
    data.value = await api.getIntegrations();
  } catch (e) {
    error.value = errorText(e);
  }
}

async function run(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    await action();
    haptic('success');
  } catch (e) {
    error.value = errorText(e);
    haptic('error');
  } finally {
    busy.value = false;
  }
}

function connectWhoop() {
  void run(async () => {
    const { url } = await api.connectWhoop();
    awaitingReturn.value = true;
    openExternal(url);
  });
}

async function disconnectWhoop() {
  if (!(await confirmAction('Отключить WHOOP? Уже загруженные тренировки останутся, новые приходить перестанут.'))) return;
  void run(async () => {
    await api.disconnectWhoop();
    await load();
  });
}

function setHubs(hubs: HubInfo[]) {
  if (data.value) data.value.hubs = hubs;
}

function toggleHub(hub: HubInfo) {
  if (openHub.value === hub.provider) {
    openHub.value = null;
    return;
  }
  openHub.value = hub.provider;
  // адрес и токен нужны сразу, как только человек открыл инструкцию
  if (!hub.token) void run(async () => setHubs((await api.connectHub(hub.provider)).hubs));
}

async function rotateHub(hub: HubInfo) {
  if (!(await confirmAction('Выпустить новый токен? Телефон перестанет отправлять тренировки, пока не впишете новый.'))) return;
  void run(async () => setHubs((await api.rotateHubToken(hub.provider)).hubs));
}

async function disconnectHub(hub: HubInfo) {
  if (!(await confirmAction('Отключить? Токен перестанет действовать, уже загруженные тренировки останутся.'))) return;
  void run(async () => {
    setHubs((await api.disconnectHub(hub.provider)).hubs);
    openHub.value = null;
  });
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = what;
    haptic('success');
    setTimeout(() => (copied.value = null), 2000);
  } catch {
    haptic('error');
  }
}

/**
 * Согласие WHOOP даётся во внешнем браузере, и приложение об успехе узнать не может — только
 * спросить сервер, когда пользователь вернулся. История догружается в фоне, поэтому дважды.
 */
async function onVisible() {
  if (document.visibilityState !== 'visible' || !awaitingReturn.value) return;
  await load();
  if (whoop.value?.status !== 'active') return;
  awaitingReturn.value = false;
  haptic('success');
  emit('changed');
  setTimeout(() => emit('changed'), 5000);
}

onMounted(() => {
  void load();
  document.addEventListener('visibilitychange', onVisible);
});
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisible));
</script>

<template>
  <div v-if="data" class="card">
    <h3>⌚ Подключения</h3>
    <div class="muted" style="margin-bottom: 6px">
      Тренировки с часов и браслетов приходят сами. Если та же тренировка внесена и вручную, в зачёт
      пойдёт запись с устройства, а ручная пометится дублем.
    </div>

    <!-- WHOOP: облачное подключение, показывается, только если настроено на сервере -->
    <div v-if="data.available.whoop" class="conn">
      <div class="grow">
        <div class="name">WHOOP</div>
        <div v-if="whoop?.status === 'active'" class="muted">
          Подключён<template v-if="whoop.lastSyncAt"> · сверка {{ formatDateTimeRu(whoop.lastSyncAt) }}</template>
        </div>
        <div v-else-if="whoop?.status === 'reauth_required'" class="error-text small">
          Доступ отозван или истёк — подключите заново
        </div>
        <div v-else class="muted">Тренировки, калории и пульс с браслета</div>
      </div>
      <button v-if="whoop?.status === 'active'" class="btn small secondary" :disabled="busy" @click="disconnectWhoop">
        Отключить
      </button>
      <button v-else class="btn small" :disabled="busy" @click="connectWhoop">
        {{ whoop ? 'Заново' : 'Подключить' }}
      </button>
    </div>
    <div v-if="awaitingReturn" class="muted">
      Разрешите доступ в открывшемся браузере и вернитесь сюда — статус обновится сам.
    </div>

    <!-- WHOOP не настроен на сервере: участникам он не виден, админу — что осталось сделать -->
    <template v-if="data.whoopSetup">
      <div class="conn">
        <div class="grow">
          <div class="name">WHOOP <span class="muted">· не настроен</span></div>
          <div class="muted">Видите это только вы, как админ. Участникам WHOOP не показывается.</div>
        </div>
        <button class="btn small secondary" @click="whoopHelp = !whoopHelp">
          {{ whoopHelp ? 'Скрыть' : 'Как включить' }}
        </button>
      </div>
      <div v-if="whoopHelp" class="guide">
        <ol class="steps">
          <li>Создайте приложение на developer.whoop.com и впишите в него два адреса ниже. Scopes: offline, read:workout, read:profile. Версия вебхуков — v2.</li>
          <li>
            В <code>.env</code> на сервере задайте:
            <b>{{ data.whoopSetup.missing.join(', ') }}</b>.
            TOKEN_ENC_KEY — любая длинная случайная строка; менять её потом нельзя.
          </li>
          <li>Пересоздайте контейнер, иначе переменные не подхватятся: <code>docker compose up -d --force-recreate app</code></li>
        </ol>
        <template v-if="data.whoopSetup.redirectUrl">
          <div class="field-label">Redirect URL</div>
          <div class="field-value">{{ data.whoopSetup.redirectUrl }}</div>
          <button class="btn small secondary" @click="copy(data.whoopSetup.redirectUrl, 'whoop-redirect')">
            {{ copied === 'whoop-redirect' ? 'Скопировано ✓' : 'Скопировать' }}
          </button>
          <div class="field-label" style="margin-top: 12px">Webhook URL</div>
          <div class="field-value">{{ data.whoopSetup.webhookUrl }}</div>
          <button class="btn small secondary" @click="copy(data.whoopSetup.webhookUrl, 'whoop-webhook')">
            {{ copied === 'whoop-webhook' ? 'Скопировано ✓' : 'Скопировать' }}
          </button>
        </template>
      </div>
    </template>

    <!-- Телефонные хабы -->
    <template v-for="hub in data.hubs" :key="hub.provider">
      <div class="conn">
        <div class="grow">
          <div class="name">{{ HUBS[hub.provider].title }}</div>
          <div v-if="hub.lastEventAt" class="muted">Данные приходили {{ formatDateTimeRu(hub.lastEventAt) }}</div>
          <div v-else-if="hub.token" class="muted">Токен выдан — ждём первую выгрузку с телефона</div>
          <div v-else class="muted">{{ HUBS[hub.provider].covers }}</div>
        </div>
        <button class="btn small" :class="{ secondary: !!hub.token }" :disabled="busy" @click="toggleHub(hub)">
          {{ openHub === hub.provider ? 'Скрыть' : hub.token ? 'Настройки' : 'Подключить' }}
        </button>
      </div>

      <div v-if="openHub === hub.provider" class="guide">
        <div class="muted">{{ HUBS[hub.provider].covers }}.</div>
        <ol class="steps">
          <li v-for="(s, i) in HUBS[hub.provider].steps" :key="i">{{ s }}</li>
        </ol>
        <button
          v-if="HUBS[hub.provider].download"
          class="btn small"
          style="margin-bottom: 12px"
          @click="openExternal(HUBS[hub.provider].download!.url)"
        >
          ⬇️ {{ HUBS[hub.provider].download!.label }}
        </button>

        <div v-if="!hub.url" class="error-text small">
          На сервере не задан публичный адрес (WEBAPP_URL) — адрес для приложения собрать не из чего.
        </div>
        <template v-else-if="hub.token">
          <div class="field-label">URL</div>
          <div class="field-value">{{ hub.url }}</div>
          <button class="btn small secondary" @click="copy(hub.url, hub.provider + 'url')">
            {{ copied === hub.provider + 'url' ? 'Скопировано ✓' : 'Скопировать адрес' }}
          </button>

          <div class="field-label" style="margin-top: 12px">Заголовок Authorization</div>
          <div class="field-value">Bearer {{ hub.token }}</div>
          <button class="btn small secondary" @click="copy('Bearer ' + hub.token, hub.provider + 'token')">
            {{ copied === hub.provider + 'token' ? 'Скопировано ✓' : 'Скопировать значение' }}
          </button>

          <div class="muted" style="margin-top: 10px">
            Токен — пароль от ваших тренировок: не пересылайте его. {{ HUBS[hub.provider].note }}
          </div>
          <div class="inline-actions" style="margin-top: 10px">
            <button class="btn small secondary" :disabled="busy" @click="rotateHub(hub)">Новый токен</button>
            <button class="btn small secondary" :disabled="busy" @click="disconnectHub(hub)">Отключить</button>
          </div>
        </template>
      </div>
    </template>

    <div v-if="error" class="error-text small" style="margin-top: 8px">{{ error }}</div>
  </div>
</template>

<style scoped>
.conn {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-top: 1px solid rgba(128, 128, 128, 0.12);
}
.conn .grow {
  flex: 1;
  min-width: 0;
}
.conn .name {
  font-weight: 600;
}
.small {
  font-size: 13px;
}
.guide {
  padding: 4px 12px 12px;
  margin-bottom: 4px;
  border-radius: 12px;
  background: var(--bg);
}
.steps {
  margin: 8px 0 12px;
  padding-left: 20px;
  font-size: 14px;
  line-height: 1.5;
}
.steps li {
  margin-bottom: 6px;
}
.field-label {
  font-size: 12px;
  color: var(--hint);
  margin-bottom: 4px;
}
.field-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  word-break: break-all;
  background: rgba(128, 128, 128, 0.12);
  border-radius: 10px;
  padding: 8px 10px;
  margin-bottom: 8px;
}
</style>
