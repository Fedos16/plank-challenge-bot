import type { FastifyInstance } from 'fastify';
import { authPreHandler } from './auth';
import { parseId } from './resolve';
import {
  MEALS,
  addFoodEntry,
  createCustomProduct,
  deleteFoodEntry,
  getFoodDay,
  parseFoodDay,
  recentProducts,
  searchProducts,
} from '../services/food';
import { searchOpenFoodFacts } from '../services/openFoodFacts';

/**
 * Дневник питания. Личный и от челленджа не зависит: еду друг друга участники не видят,
 * а калории нужны человеку и после конца челленджа.
 */
export async function foodRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authPreHandler);

  // День целиком: записи, итог, расход и баланс. Без ?day — сегодня
  app.get('/food/day', async (req, reply) => {
    const day = parseFoodDay((req.query as { day?: string } | undefined)?.day);
    if (!day) return reply.code(400).send({ error: 'bad_food_day' });
    return { ...(await getFoodDay(req.ctx!.user.id, day)), meals: MEALS };
  });

  // Возвращает обновлённый день, чтобы фронт не перезапрашивал
  app.post('/food/entries', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await addFoodEntry(req.ctx!.user.id, body);
    if (typeof result === 'string') {
      return reply.code(result === 'product_not_found' ? 404 : 400).send({ error: result });
    }
    const day = parseFoodDay(body.day);
    return { ...(await getFoodDay(req.ctx!.user.id, day!)), meals: MEALS };
  });

  app.delete('/food/entries/:id', async (req, reply) => {
    const id = parseId((req.params as { id: string }).id, reply);
    if (id === null) return;
    const ok = await deleteFoodEntry(req.ctx!.user.id, id);
    if (!ok) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  app.get('/food/search', async (req) => {
    const q = (req.query as { q?: string } | undefined)?.q;
    return { products: typeof q === 'string' ? await searchProducts(q) : [] };
  });

  // Поиск упакованных продуктов во внешней базе. Только по явной кнопке: у сервиса жёсткий
  // лимит запросов, и дёргать его на каждый символ нельзя. Найденное оседает в справочнике.
  app.get('/food/search/off', async (req, reply) => {
    const q = (req.query as { q?: string } | undefined)?.q;
    const result = await searchOpenFoodFacts(typeof q === 'string' ? q : '');
    if (typeof result === 'string') {
      const code = result === 'off_rate_limited' ? 429 : result === 'off_unavailable' ? 502 : 400;
      return reply.code(code).send({ error: result });
    }
    return { products: result };
  });

  app.get('/food/recent', async (req) => ({ products: await recentProducts(req.ctx!.user.id) }));

  // Свой продукт: то, чего нет в справочнике
  app.post('/food/products', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await createCustomProduct(req.ctx!.user.id, body);
    if (typeof result === 'string') return reply.code(400).send({ error: result });
    return result;
  });
}
