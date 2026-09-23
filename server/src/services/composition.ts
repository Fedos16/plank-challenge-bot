/**
 * Состав тела, присланный текстом боту. Весы с закрытым приложением (Mi Body Composition
 * Scale 2 и Zepp Life) отдают в Health Connect только вес — жир и мышцы человек переписывает
 * с экрана приложения весов ответом на сообщение о взвешивании:
 *
 *   «24,4 58,7»                 — жир, мышцы
 *   «24,4 58,7 51,9»            — жир, мышцы, вода
 *   «жир 24,4 мышцы 58,7 кг»    — с подписями, в любом порядке
 *
 * Жир и вода — всегда проценты. Мышцы — в единице, которую человек выбрал в приложении,
 * если в сообщении нет явного «%» или «кг».
 */

export type MuscleUnit = 'kg' | 'percent';

export interface CompositionText {
  bodyFat?: number;
  water?: number;
  muscle?: { value: number; unit: MuscleUnit };
}

type Field = 'bodyFat' | 'muscle' | 'water';

const ORDER: Field[] = ['bodyFat', 'muscle', 'water'];

function fieldOf(label: string | undefined): Field | null {
  if (!label) return null;
  if (/^(жир|fat)/.test(label)) return 'bodyFat';
  if (/^(мышц|muscle)/.test(label)) return 'muscle';
  if (/^(вод|water)/.test(label)) return 'water';
  return null;
}

const TOKEN = /(жир\S*|fat|мышц\S*|muscle\S*|вод\S*|water)?\s*[:=—-]?\s*(\d{1,3}(?:[.,]\d+)?)\s*(%|кг|kg)?/giu;

/**
 * Разбирает сообщение. null — это не состав тела: в сообщении есть что-то кроме чисел, подписей
 * и разделителей. Так обычная переписка с цифрами («приду в 7») не превратится в замер.
 */
export function parseCompositionText(text: string, defaultMuscleUnit: MuscleUnit): CompositionText | null {
  const source = text.trim().toLowerCase();
  if (!source) return null;

  const result: CompositionText = {};
  const used = new Set<Field>();
  let rest = source;

  for (const m of source.matchAll(TOKEN)) {
    const [whole, label, raw, unit] = m;
    if (!raw) continue;
    const field = fieldOf(label) ?? ORDER.find((f) => !used.has(f));
    if (!field || used.has(field)) return null;
    used.add(field);
    rest = rest.replace(whole, ' ');

    const value = Number(raw.replace(',', '.'));
    if (field === 'muscle') {
      const muscleUnit: MuscleUnit = unit === '%' ? 'percent' : unit ? 'kg' : defaultMuscleUnit;
      result.muscle = { value, unit: muscleUnit };
    } else {
      if (unit && unit !== '%') return null; // жир и вода в килограммах — не наш формат
      result[field] = value;
    }
  }

  if (used.size === 0) return null;
  // между числами допустимы только разделители
  if (!/^[\s,;/|.]*$/u.test(rest)) return null;
  return result;
}
