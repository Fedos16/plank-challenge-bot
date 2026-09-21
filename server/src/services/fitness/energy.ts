/**
 * Дневной расход энергии. Базовый обмен — по Миффлину — Сан-Жеору, самой точной из простых
 * формул; сверху — коэффициент бытовой активности (1,2 — сидячий образ жизни) и отдельно
 * калории тренировок. Тренировки не входят в коэффициент намеренно: они у нас посчитаны
 * по факту, а не усреднены «умеренной активностью».
 */

export type Sex = 'male' | 'female';

export interface BodyFacts {
  sex: Sex | null;
  weightKg: number | null;
  heightCm: number | null;
  birthYear: number | null;
  activityFactor: number;
}

/** Базовый обмен, ккал/сутки: 10·вес + 6,25·рост − 5·возраст, +5 мужчинам, −161 женщинам. */
export function mifflinStJeor(sex: Sex, weightKg: number, heightCm: number, age: number): number {
  return Math.round(10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161));
}

export type MissingFact = 'sex' | 'weight' | 'height' | 'birthYear';

export interface EnergyBaseline {
  /** Базовый обмен. null, если в анкете не хватает данных. */
  bmr: number | null;
  /** Расход без тренировок: базовый обмен × коэффициент бытовой активности. */
  baseline: number | null;
  /** Чего не хватает для расчёта — чтобы экран подсказал, что дозаполнить. */
  missing: MissingFact[];
}

export function energyBaseline(facts: BodyFacts, currentYear: number): EnergyBaseline {
  const missing: MissingFact[] = [];
  if (!facts.sex) missing.push('sex');
  if (!facts.weightKg) missing.push('weight');
  if (!facts.heightCm) missing.push('height');
  if (!facts.birthYear) missing.push('birthYear');
  if (missing.length) return { bmr: null, baseline: null, missing };

  const bmr = mifflinStJeor(facts.sex!, facts.weightKg!, facts.heightCm!, currentYear - facts.birthYear!);
  return { bmr, baseline: Math.round(bmr * facts.activityFactor), missing: [] };
}
