/**
 * Удаления и окно синхронизации в выгрузке хаба — общая часть Health Auto Export и Health Connect.
 *
 * Приложения-хабы шлют только то, что есть сейчас, и об удалении не сообщают: человек стёр
 * тренировку в Mi Fitness или поправил её в WHOOP, а у нас она осталась висеть. WHOOP-интеграция
 * такое чинит своим вебхуком (`workout.deleted`), у хабов такого события нет — поэтому отправитель
 * может сказать об этом сам, добавив к обычной выгрузке одно из двух полей:
 *
 *   { "data": { "workouts": [...], "deleted": ["id-1", "id-2"] } }          // адресно
 *   { "data": { "workouts": [...], "window": { "from": "…", "to": "…" } } } // сверка окна
 *
 * `deleted` — список externalId, которых у источника больше нет.
 * `window` — отправитель ручается, что `workouts` это ВСЁ, что у него есть за этот интервал;
 * тренировки того же источника внутри интервала, которых нет в выгрузке, помечаются удалёнными.
 * Окно применяется только когда оно указано явно: Health Auto Export и Health Connect его не шлют,
 * их поведение не меняется, а скользящее окно приложения никогда не снесёт лишнего.
 *
 * Поля ищутся и в корне тела, и внутри `data` — у HAE всё лежит в `data`, у Health Connect в корне.
 */

/** Верхняя граница на список удалений: защита от случайной выгрузки «сотрите всё». */
const MAX_DELETIONS = 500;

export interface HubSyncDirectives {
  /** externalId, которых у источника больше нет. */
  deleted: string[];
  /** Интервал, за который выгрузка полная. */
  window: { from: Date; to: Date } | null;
}

function parseTime(v: unknown): Date | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const at = new Date(v);
  return Number.isNaN(at.getTime()) ? null : at;
}

function pick(body: Record<string, unknown>, key: string): unknown {
  const data = body.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const inner = (data as Record<string, unknown>)[key];
    if (inner !== undefined) return inner;
  }
  return body[key];
}

export function parseHubSyncDirectives(body: unknown): HubSyncDirectives {
  const empty: HubSyncDirectives = { deleted: [], window: null };
  if (!body || typeof body !== 'object' || Array.isArray(body)) return empty;
  const b = body as Record<string, unknown>;

  const rawDeleted = pick(b, 'deleted');
  const deleted = Array.isArray(rawDeleted)
    ? [...new Set(rawDeleted.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()))].slice(0, MAX_DELETIONS)
    : [];

  let window: HubSyncDirectives['window'] = null;
  const rawWindow = pick(b, 'window');
  if (rawWindow && typeof rawWindow === 'object' && !Array.isArray(rawWindow)) {
    const w = rawWindow as Record<string, unknown>;
    const from = parseTime(w.from ?? w.start);
    const to = parseTime(w.to ?? w.end);
    // Перевёрнутый или пустой интервал — не окно: молча игнорируем, выгрузка от этого не ломается
    if (from && to && to.getTime() > from.getTime()) window = { from, to };
  }

  return { deleted, window };
}
