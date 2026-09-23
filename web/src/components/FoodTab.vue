<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api } from '../api';
import type { FoodDay, FoodEntry, FoodProduct, Meal } from '../types';
import { confirmAction, haptic } from '../telegram';
import { capitalize, formatDayHumanRu, todayInZone, weekdayShortRu } from '../helpers';
import { errorText, formatNum, newClientId, numOrNull } from '../fitness';
import LineChart from './LineChart.vue';

const MEAL_LABEL: Record<Meal, string> = {
  breakfast: 'Завтрак',
  lunch: 'Обед',
  dinner: 'Ужин',
  snack: 'Перекус',
};
const MEALS = Object.keys(MEAL_LABEL) as Meal[];
const MISSING_LABEL: Record<string, string> = {
  sex: 'пол',
  weight: 'вес',
  height: 'рост',
  birthYear: 'год рождения',
};

const data = ref<FoodDay | null>(null);
const loading = ref(true);
const busy = ref(false);
const error = ref<string | null>(null);

type Mode = 'product' | 'kcal' | 'custom';
const mode = ref<Mode>('product');

/** Какой приём пищи предложить по времени суток. */
function mealByHour(): Meal {
  const h = new Date().getHours();
  if (h < 11) return 'breakfast';
  if (h < 16) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snack';
}
const meal = ref<Meal>(mealByHour());

// --- поиск по справочнику ---
const query = ref('');
const results = ref<FoodProduct[]>([]);
const recent = ref<FoodProduct[]>([]);
const selected = ref<FoodProduct | null>(null);
const grams = ref('');
let searchTimer: ReturnType<typeof setTimeout> | undefined;
/** Ответы поиска приходят не по порядку: показываем только ответ на последний запрос. */
let searchSeq = 0;

watch(query, (q) => {
  if (searchTimer) clearTimeout(searchTimer);
  offNote.value = null;
  if (q.trim().length < 2) {
    results.value = [];
    return;
  }
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq;
    try {
      const found = (await api.searchFood(q)).products;
      if (seq === searchSeq) results.value = found;
    } catch {
      /* поиск не критичен: человек может ввести калории цифрой */
    }
  }, 250);
});

// --- внешняя база упакованных продуктов: только по кнопке, у сервиса жёсткий лимит запросов ---
const offBusy = ref(false);
const offNote = ref<string | null>(null);

async function searchOff() {
  const q = query.value.trim();
  if (q.length < 3 || offBusy.value) return;
  offBusy.value = true;
  offNote.value = null;
  try {
    const found = (await api.searchFoodOff(q)).products;
    const known = new Set(results.value.map((p) => p.id));
    results.value = [...results.value, ...found.filter((p) => !known.has(p.id))];
    offNote.value = found.length ? null : 'В Open Food Facts тоже не нашлось — добавьте свой продукт.';
  } catch (e) {
    offNote.value = errorText(e);
  } finally {
    offBusy.value = false;
  }
}

const kcalForm = reactive({ kcal: '', title: '' });
const customForm = reactive({ name: '', kcal100: '', protein100: '', fat100: '', carbs100: '' });
/** Один id на форму: повторная отправка на плохой сети не создаст вторую запись. */
const clientId = ref(newClientId());

async function load(day?: string) {
  try {
    data.value = await api.getFoodDay(day);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}

/** Заголовок дня: «Сегодня, вт», «Вчера, пн», дальше — «Пн, 15 сен». */
const dayTitle = computed(() => {
  if (!data.value) return '';
  const today = data.value.isToday ? data.value.day : todayInZone();
  const human = capitalize(formatDayHumanRu(data.value.day, today));
  return human === 'Сегодня' || human === 'Вчера' ? `${human}, ${weekdayShortRu(data.value.day)}` : human;
});

function shiftDay(delta: number) {
  if (!data.value) return;
  const d = new Date(`${data.value.day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  void load(d.toISOString().slice(0, 10));
}

function pick(p: FoodProduct) {
  selected.value = p;
  grams.value = String(p.lastGrams ?? p.servingGrams ?? 100);
  error.value = null;
}

/** Калории выбранного продукта на введённую граммовку — видно до записи. */
const preview = computed(() => {
  const g = numOrNull(grams.value);
  const p = selected.value;
  if (!p || g === null || g <= 0) return null;
  const part = (v: number | null) => (v === null ? null : Math.round((v * g) / 10) / 10);
  return { kcal: Math.round((p.kcal100 * g) / 100), protein: part(p.protein100), fat: part(p.fat100), carbs: part(p.carbs100) };
});

async function submit(action: () => Promise<FoodDay>) {
  if (busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    data.value = await action();
    clientId.value = newClientId();
    haptic('success');
    recent.value = (await api.getRecentFood()).products;
  } catch (e) {
    error.value = errorText(e);
    haptic('error');
  } finally {
    busy.value = false;
  }
}

function addProduct() {
  const g = numOrNull(grams.value);
  const p = selected.value;
  if (!p || g === null) {
    error.value = 'Введите граммы';
    return;
  }
  void submit(async () => {
    const day = await api.addFoodEntry({ clientId: clientId.value, day: data.value?.day, meal: meal.value, productId: p.id, grams: g });
    selected.value = null;
    query.value = '';
    return day;
  });
}

function addKcal() {
  const kcal = numOrNull(kcalForm.kcal);
  if (kcal === null) {
    error.value = 'Введите калории';
    return;
  }
  void submit(async () => {
    const day = await api.addFoodEntry({
      clientId: clientId.value, day: data.value?.day, meal: meal.value, kcal, title: kcalForm.title.trim() || undefined,
    });
    kcalForm.kcal = kcalForm.title = '';
    return day;
  });
}

async function addCustom() {
  const kcal100 = numOrNull(customForm.kcal100);
  if (!customForm.name.trim() || kcal100 === null) {
    error.value = 'Нужны название и калории на 100 г';
    return;
  }
  if (busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    const product = await api.createFoodProduct({
      name: customForm.name,
      kcal100,
      protein100: numOrNull(customForm.protein100),
      fat100: numOrNull(customForm.fat100),
      carbs100: numOrNull(customForm.carbs100),
    });
    Object.assign(customForm, { name: '', kcal100: '', protein100: '', fat100: '', carbs100: '' });
    mode.value = 'product';
    pick(product);
    haptic('success');
  } catch (e) {
    error.value = errorText(e);
    haptic('error');
  } finally {
    busy.value = false;
  }
}

async function remove(e: FoodEntry) {
  if (!(await confirmAction(`Удалить «${e.title}»?`)) || busy.value) return;
  busy.value = true;
  try {
    await api.deleteFoodEntry(e.id);
    await load(data.value?.day);
  } catch (err) {
    error.value = errorText(err);
  } finally {
    busy.value = false;
  }
}

/** Записи по приёмам пищи в порядке дня; без приёма — в конце. */
const groups = computed(() => {
  const entries = data.value?.entries ?? [];
  const result: { label: string; kcal: number; items: FoodEntry[] }[] = [];
  for (const m of [...MEALS, null]) {
    const items = entries.filter((e) => e.meal === m);
    if (items.length) result.push({ label: m ? MEAL_LABEL[m] : 'Без приёма', kcal: items.reduce((s, e) => s + e.kcal, 0), items });
  }
  return result;
});

const targetPercent = computed(() => {
  const d = data.value;
  return d?.target ? Math.min(100, Math.round((d.eaten.kcal / d.target) * 100)) : null;
});

const weekPoints = computed(() => (data.value?.week ?? []).map((w) => ({ day: w.day, value: w.eaten })));
const weekHasData = computed(() => weekPoints.value.some((p) => p.value > 0));

const kcal = (n: number) => n.toLocaleString('ru-RU');

onMounted(async () => {
  await load();
  try {
    recent.value = (await api.getRecentFood()).products;
  } catch {
    /* без «недавних» можно жить */
  }
});
</script>

<template>
  <div v-if="loading" class="center">Загрузка…</div>

  <template v-else-if="data">
    <div class="day-nav">
      <button class="btn small secondary" @click="shiftDay(-1)">‹</button>
      <div class="day-title">{{ dayTitle }}</div>
      <button class="btn small secondary" :disabled="data.isToday" @click="shiftDay(1)">›</button>
    </div>

    <!-- Итог дня -->
    <div class="card">
      <div class="eaten">
        <span class="num">{{ kcal(data.eaten.kcal) }}</span>
        <span class="muted">ккал съедено<template v-if="data.target"> из {{ kcal(data.target) }}</template></span>
      </div>
      <div v-if="targetPercent !== null" class="bar">
        <div class="bar-fill" :class="{ over: data.eaten.kcal > (data.target ?? 0) }" :style="{ width: targetPercent + '%' }" />
      </div>
      <div class="muted macros">
        Б {{ formatNum(data.eaten.protein) }} · Ж {{ formatNum(data.eaten.fat) }} · У {{ formatNum(data.eaten.carbs) }} г
      </div>

      <template v-if="data.energy.baseline !== null">
        <div class="row"><div class="name">Расход без тренировок</div><div class="meta">{{ kcal(data.energy.baseline) }}</div></div>
        <div class="row"><div class="name">Тренировки</div><div class="meta">{{ kcal(data.workoutKcal) }}</div></div>
        <div class="row">
          <div class="name">Баланс</div>
          <div class="fire" :class="{ deficit: (data.balance ?? 0) < 0 }">
            {{ (data.balance ?? 0) > 0 ? '+' : '−' }}{{ kcal(Math.abs(data.balance ?? 0)) }}
            <span class="muted">{{ (data.balance ?? 0) < 0 ? 'дефицит' : 'профицит' }}</span>
          </div>
        </div>
        <div class="muted" style="margin-top: 8px">
          Расход — базовый обмен {{ kcal(data.energy.bmr ?? 0) }} ккал по формуле Миффлина — Сан-Жеора с поправкой
          на бытовую активность. Оценка приблизительная: следите за трендом, а не за цифрой дня.
        </div>
      </template>
      <div v-else class="muted" style="margin-top: 8px">
        Чтобы считать дефицит и профицит, не хватает данных:
        {{ data.energy.missing.map((m) => MISSING_LABEL[m]).join(', ') }}. Заполните анкету в разделе «Ещё»
        <template v-if="data.energy.missing.includes('weight')"> и запишите вес во вкладке «Тело»</template>.
      </div>
    </div>

    <!-- Добавить -->
    <div class="card">
      <div class="subtabs">
        <button :class="{ active: mode === 'product' }" @click="mode = 'product'">🔎 Продукт</button>
        <button :class="{ active: mode === 'kcal' }" @click="mode = 'kcal'">🔢 Калории</button>
        <button :class="{ active: mode === 'custom' }" @click="mode = 'custom'">➕ Свой продукт</button>
      </div>

      <label v-if="mode !== 'custom'" class="field">
        <span class="lbl req">Приём пищи</span>
        <select v-model="meal">
          <option v-for="m in MEALS" :key="m" :value="m">{{ MEAL_LABEL[m] }}</option>
        </select>
      </label>

      <template v-if="mode === 'product'">
        <template v-if="!selected">
          <input v-model="query" placeholder="Гречка, куриная грудка, борщ…" />
          <div v-if="!query && recent.length" class="chips">
            <button v-for="p in recent" :key="p.id" type="button" @click="pick(p)">{{ p.name }}</button>
          </div>
          <div v-for="p in results" :key="p.id" class="result" @click="pick(p)">
            <div class="name">
              {{ p.name }}
              <span v-if="p.brand" class="muted">· {{ p.brand }}</span>
            </div>
            <div class="meta">{{ kcal(p.kcal100) }} ккал / 100 г</div>
          </div>
          <div v-if="query.trim().length >= 2 && !results.length" class="muted" style="margin-top: 10px">
            В справочнике не нашлось. Поищите среди упакованных продуктов, введите калории цифрой
            или добавьте свой продукт.
          </div>
          <button
            v-if="query.trim().length >= 3"
            class="btn small secondary"
            style="margin-top: 10px"
            :disabled="offBusy"
            @click="searchOff"
          >
            {{ offBusy ? 'Ищем…' : '🌍 Искать в Open Food Facts' }}
          </button>
          <div v-if="offNote" class="muted" style="margin-top: 8px">{{ offNote }}</div>
        </template>

        <template v-else>
          <div class="picked">
            <div>
              <div class="name">{{ selected.name }}</div>
              <div class="muted">{{ kcal(selected.kcal100) }} ккал на 100 г</div>
            </div>
            <button class="btn small secondary" @click="selected = null">Другой</button>
          </div>
          <label class="field">
            <span class="lbl req">Сколько, г</span>
            <input v-model="grams" inputmode="decimal" @keyup.enter="addProduct" />
          </label>
          <div v-if="selected.servingGrams" class="chips">
            <button v-for="n in [1, 2, 3]" :key="n" type="button" @click="grams = String(selected.servingGrams! * n)">
              {{ n > 1 ? n + ' × ' : '' }}{{ selected.servingLabel }} · {{ selected.servingGrams * n }} г
            </button>
          </div>
          <div v-if="preview" class="preview">
            <b>{{ kcal(preview.kcal) }} ккал</b>
            <span v-if="preview.protein !== null" class="muted">
              · Б {{ formatNum(preview.protein) }} · Ж {{ formatNum(preview.fat ?? 0) }} · У {{ formatNum(preview.carbs ?? 0) }}
            </span>
          </div>
          <button class="btn" :disabled="busy" @click="addProduct">Добавить</button>
        </template>
      </template>

      <template v-else-if="mode === 'kcal'">
        <div class="two">
          <label class="field">
            <span class="lbl req">Калории</span>
            <input v-model="kcalForm.kcal" inputmode="numeric" placeholder="450" @keyup.enter="addKcal" />
          </label>
          <label class="field">
            <span class="lbl">Что это</span>
            <input v-model="kcalForm.title" maxlength="80" placeholder="Бизнес-ланч" @keyup.enter="addKcal" />
          </label>
        </div>
        <button class="btn" :disabled="busy" @click="addKcal">Добавить</button>
      </template>

      <template v-else>
        <div class="muted" style="margin-bottom: 10px">
          Цифры — с упаковки, на 100 г. Продукт останется в общем справочнике: друзья найдут его поиском.
        </div>
        <label class="field"><span class="lbl req">Название</span><input v-model="customForm.name" maxlength="80" /></label>
        <div class="two">
          <label class="field"><span class="lbl req">Ккал на 100 г</span><input v-model="customForm.kcal100" inputmode="decimal" /></label>
          <label class="field"><span class="lbl">Белки, г</span><input v-model="customForm.protein100" inputmode="decimal" /></label>
          <label class="field"><span class="lbl">Жиры, г</span><input v-model="customForm.fat100" inputmode="decimal" /></label>
          <label class="field"><span class="lbl">Углеводы, г</span><input v-model="customForm.carbs100" inputmode="decimal" /></label>
        </div>
        <button class="btn" :disabled="busy" @click="addCustom">Сохранить и выбрать</button>
      </template>

      <div v-if="error" class="error-text" style="margin-top: 10px">{{ error }}</div>
    </div>

    <!-- Дневник -->
    <div v-for="g in groups" :key="g.label" class="card">
      <div class="meal-head">
        <h3>{{ g.label }}</h3>
        <span class="muted">{{ kcal(g.kcal) }} ккал</span>
      </div>
      <div v-for="e in g.items" :key="e.id" class="row">
        <div class="name">
          {{ e.title }}
          <div v-if="e.grams" class="meta">{{ formatNum(e.grams, 0) }} г</div>
        </div>
        <div class="fire">{{ kcal(e.kcal) }}</div>
        <button class="row-x" :disabled="busy" @click="remove(e)">✕</button>
      </div>
    </div>
    <div v-if="!groups.length" class="card">
      <div class="muted">За этот день записей нет. Дневник видите только вы.</div>
    </div>

    <div v-if="weekHasData" class="card">
      <h3>Неделя</h3>
      <LineChart :points="weekPoints" unit="ккал" :digits="0" :target="data.target" />
    </div>
  </template>
</template>

<style scoped>
.day-nav {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.day-title {
  flex: 1;
  text-align: center;
  font-weight: 700;
  font-size: 16px;
}
.eaten {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}
.eaten .num {
  font-size: 34px;
  font-weight: 800;
  line-height: 1;
}
.macros {
  margin: 8px 0 4px;
}
.bar {
  height: 8px;
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.18);
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  border-radius: 4px;
  background: var(--green);
}
.bar-fill.over {
  background: var(--red);
}
.fire.deficit {
  color: var(--green);
}
.two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  /* поля в ряд по нижнему краю: длинная подпись на узком экране переносится и не должна их сдвигать */
  align-items: end;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 10px 0;
}
.chips button {
  border: none;
  background: rgba(128, 128, 128, 0.14);
  color: var(--text);
  padding: 7px 11px;
  border-radius: 16px;
  font-size: 13px;
  cursor: pointer;
}
.result {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 11px 0;
  border-bottom: 1px solid rgba(128, 128, 128, 0.12);
  cursor: pointer;
}
.result:last-child {
  border-bottom: none;
}
.result .name,
.picked .name {
  font-weight: 600;
}
.result .meta {
  color: var(--hint);
  font-size: 12px;
  white-space: nowrap;
}
.picked {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.preview {
  margin: 4px 0 12px;
  font-size: 15px;
}
.meal-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.row-x {
  border: none;
  background: none;
  color: var(--red);
  cursor: pointer;
  font-size: 13px;
  padding: 0 0 0 10px;
}
</style>
