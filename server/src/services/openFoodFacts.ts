import type { FoodProduct } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { config } from '../lib/config';
import { normalizeFoodName, toProductDTO, type ProductDTO } from './food';

/**
 * Поиск в Open Food Facts — для упакованных продуктов, которых нет в базовом справочнике
 * (конкретный йогурт, батончик, хлопья). Найденное кэшируется в общем справочнике, так что
 * второй раз тот же продукт находит уже локальный поиск.
 *
 * Сервис бесплатный и просит беречь его: не больше 10 поисковых запросов в минуту с одного
 * адреса и внятный User-Agent. Поэтому запрос уходит только по явной кнопке, а не на каждый
 * символ, есть общий лимит и короткий кэш одинаковых запросов.
 */

const KJ_PER_KCAL = 4.184;
const TIMEOUT_MS = 6000;
/** Наш лимит строже разрешённого: запас на перезапуски и второй контейнер во время деплоя. */
const MAX_PER_MINUTE = 8;
const CACHE_MS = 10 * 60_000;
const USER_AGENT = 'SportChallengeBot/1.0 (self-hosted fitness challenge; github.com/Fedos16/plank-challenge-bot)';

const recentCalls: number[] = [];
const cache = new Map<string, { at: number; products: ProductDTO[] }>();

/** Есть ли ещё запросы в этой минуте. Чистая — время передаётся снаружи. */
export function takeRateSlot(calls: number[], now: number, limit = MAX_PER_MINUTE): boolean {
  while (calls.length && now - calls[0]! >= 60_000) calls.shift();
  if (calls.length >= limit) return false;
  calls.push(now);
  return true;
}

function finite(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export interface OffProduct {
  code: string;
  name: string;
  brand: string | null;
  kcal100: number;
  protein100: number | null;
  fat100: number | null;
  carbs100: number | null;
  servingGrams: number | null;
}

/**
 * Продукт из ответа OFF → наш формат. База наполняется пользователями, поэтому записей без
 * названия или калорий много — они бесполезны для дневника и отбрасываются.
 */
export function mapOffProduct(input: unknown): OffProduct | null {
  if (!input || typeof input !== 'object') return null;
  const p = input as Record<string, unknown>;
  const code = typeof p.code === 'string' || typeof p.code === 'number' ? String(p.code).trim() : '';
  const rawName = [p.product_name_ru, p.product_name].find((n) => typeof n === 'string' && n.trim());
  if (!code || typeof rawName !== 'string') return null;

  const n = (p.nutriments && typeof p.nutriments === 'object' ? p.nutriments : {}) as Record<string, unknown>;
  // Энергия бывает только в килоджоулях — тогда пересчитываем
  const kj = finite(n['energy-kj_100g']) ?? finite(n.energy_100g);
  const kcal = finite(n['energy-kcal_100g']) ?? (kj === null ? null : kj / KJ_PER_KCAL);
  if (kcal === null || kcal < 0 || kcal > 900) return null;

  const macro = (v: unknown) => {
    const x = finite(v);
    return x === null || x < 0 || x > 100 ? null : round1(x);
  };
  const serving = finite(p.serving_quantity);
  const brand = typeof p.brands === 'string' && p.brands.trim() ? p.brands.split(',')[0]!.trim().slice(0, 40) : null;

  return {
    code,
    name: rawName.replace(/\s+/g, ' ').trim().slice(0, 80),
    brand,
    kcal100: round1(kcal),
    protein100: macro(n.proteins_100g),
    fat100: macro(n.fat_100g),
    carbs100: macro(n.carbohydrates_100g),
    servingGrams: serving !== null && serving > 0 && serving <= 2000 ? round1(serving) : null,
  };
}

export type OffError = 'off_disabled' | 'off_rate_limited' | 'off_unavailable' | 'bad_query';

export async function searchOpenFoodFacts(query: string): Promise<ProductDTO[] | OffError> {
  if (!config.offApiBase) return 'off_disabled';
  const q = normalizeFoodName(query);
  if (q.length < 3 || q.length > 60) return 'bad_query';

  const cached = cache.get(q);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.products;
  if (!takeRateSlot(recentCalls, Date.now())) return 'off_rate_limited';

  const params = new URLSearchParams({
    search_terms: q,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: '20',
    fields: 'code,product_name,product_name_ru,brands,nutriments,serving_quantity',
  });
  let raw: unknown[];
  try {
    const res = await fetch(`${config.offApiBase}/cgi/search.pl?${params}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return 'off_unavailable';
    const json = (await res.json()) as { products?: unknown };
    raw = Array.isArray(json.products) ? json.products : [];
  } catch {
    // сеть, таймаут, не-JSON в ответе: внешний сервис не должен ронять дневник
    return 'off_unavailable';
  }

  const saved: FoodProduct[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const p = mapOffProduct(item);
    if (!p || seen.has(p.code)) continue;
    seen.add(p.code);
    const data = {
      name: p.name,
      nameLc: normalizeFoodName(p.brand ? `${p.name} ${p.brand}` : p.name),
      brand: p.brand,
      kcal100: p.kcal100,
      protein100: p.protein100,
      fat100: p.fat100,
      carbs100: p.carbs100,
      servingGrams: p.servingGrams,
      servingLabel: p.servingGrams === null ? null : 'порция',
    };
    saved.push(
      await prisma.foodProduct.upsert({
        where: { source_externalId: { source: 'off', externalId: p.code } },
        create: { source: 'off', externalId: p.code, ...data },
        update: data,
      }),
    );
  }

  const products = saved.filter((p) => !p.isHidden).map(toProductDTO);
  cache.set(q, { at: Date.now(), products });
  return products;
}
