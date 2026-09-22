import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const RULES_TEXT = `Правила «Планка каждый день»

1. Каждый участник делает планку каждый день
2. Планка засчитывается только на локтях
3. Минимальное время планки — 1 минута
4. Подтверждение — кружочек в Telegram, отправленный в общий чат
5. В кружочке должно быть явно видно, что человек стоит в планке
6. Кружочек нужно отправить до 23:59 текущего дня
7. Если участник не сделал планку или не отправил кружочек вовремя, он переводит 500 рублей в общий банк
8. Старые видео, монтаж и фейковые подтверждения запрещены. За обман — двойной штраф: 1000 рублей
9. Если участник заболел или получил травму и не сможет сделать планку, он должен написать об этом в чат до 14:00 текущего дня
10. Общий банк участники тратят вместе по общему решению
11. За серию без пропусков даётся заморозка: её можно потратить в приложении на один пропущенный день — серия не прервётся, но штраф за пропуск останется`;

const QUOTES: string[] = [
  'Дисциплина — это мост между целью и результатом. Сегодня снова на локти!',
  'Минута планки сегодня сильнее любого «потом».',
  'Тело забудет боль, но запомнит, что ты не сдался.',
  'Серия не прерывается у тех, кто решил, а не у тех, кто захотел.',
  'Каждый день — это +1 к версии себя, которой ты гордишься.',
  'Сложно ровно одну минуту. Дальше — только гордость.',
  'Планка — это не про пресс, это про характер.',
  'Не жди мотивации. Встал в планку — мотивация пришла сама.',
  'Сегодняшний кружочек — это завтрашняя привычка.',
  'Чемпионы делают то же, что и все, только каждый день.',
  'Один пропуск стоит дороже, чем минута дискомфорта.',
  'Ты сильнее своего таймера. Докажи это снова.',
  'Постоянство побеждает талант, когда талант не приходит на тренировку.',
  'Пока ты держишь планку, отговорки лежат на полу.',
  'Маленькое усилие каждый день рушит большие оправдания.',
  'Не считай дни — пусть дни считают твою силу.',
  'Сегодня тяжело? Значит, ты становишься крепче прямо сейчас.',
  'Банк пополняют слабые. Будь тем, кто пополняет серию.',
  'Минута планки — это инвестиция, которая всегда в плюсе.',
  'Решимость измеряется не словами, а кружочками в чате.',
  'Ты не «должен» — ты «можешь». И ты уже это доказываешь.',
  'Привычка — это свобода. Сделал планку — и день твой.',
  'Каждая секунда в планке — это секунда, когда ты выбираешь себя.',
  'Сильные не те, кто не устаёт, а те, кто встаёт в планку уставшим.',
  'Лучшее время сделать планку было вчера. Второе лучшее — сейчас.',
  'Твоя серия — это история, которую ты пишешь каждый день.',
  'Не пропусти день — и день не пропустит тебя.',
  'Планка проверяет не мышцы, а решимость. Ты проходишь проверку.',
  'Комфорт — враг прогресса. Локти на пол, и вперёд.',
  'Сегодня ты на минуту ближе к тому, кем хочешь быть.',
  'Победа — это привычка. Поражение — тоже. Выбирай каждый день.',
  'Делай, даже когда не хочется. Особенно когда не хочется.',
  'Минута тишины и напряжения — лучший разговор с собой.',
  'Серия в 30 дней начинается с одного честного кружочка.',
  'Ты не обязан быть лучшим. Просто будь стабильным.',
  'Каждый держит планку в одиночку, но мы стоим вместе.',
  'Не ищи лёгких путей — ищи свои локти и таймер.',
  'Сильная привычка тише слов, но громче результатов.',
  'Пропустить легко, держать серию — почётно. Выбирай почёт.',
  'Сегодня снова минута, которая делает тебя несгибаемым.',
];

async function main() {
  const startEnv = process.env.CHALLENGE_START_DATE; // YYYY-MM-DD
  const startDate = startEnv
    ? new Date(`${startEnv}T00:00:00.000Z`)
    : new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);

  const challenge = await prisma.challenge.upsert({
    where: { key: 'planka' },
    update: {},
    create: {
      key: 'planka',
      title: 'Планка каждый день',
      description: 'Ежедневная планка на локтях минимум 1 минута. Подтверждение — кружочек в чат.',
      rulesText: RULES_TEXT,
      isActive: true,
      timezone: process.env.TZ ?? 'Europe/Moscow',
      startDate,
      dailyDeadline: '23:59',
      sickDeadline: '14:00',
      minDurationSec: 60,
      fineAmount: 500,
      fakeFineMultiplier: 2,
      freezeStreakOnSick: true,
      freezeEveryDays: 30,
      maxFreezes: 3,
      reportTime: '00:05',
      reminderTime: '21:00',
    },
  });

  const existingQuotes = await prisma.motivationalQuote.count({
    where: { challengeId: challenge.id },
  });
  if (existingQuotes === 0) {
    await prisma.motivationalQuote.createMany({
      data: QUOTES.map((text) => ({ challengeId: challenge.id, text, isActive: true })),
    });
    console.log(`Добавлено мотивационных речей: ${QUOTES.length}`);
  } else {
    console.log(`Речи уже есть (${existingQuotes}), пропускаю.`);
  }

  console.log(`Сид готов. Челлендж #${challenge.id} «${challenge.title}», старт ${startDate.toISOString().slice(0, 10)}.`);

  // Сид идёт при КАЖДОМ старте контейнера, в цепочке `db push && seed && node`: исключение
  // здесь не дало бы приложению подняться. Справочник продуктов — не повод ронять прод.
  try {
    await seedFoods();
  } catch (err) {
    console.error('Справочник продуктов не обновлён (приложение стартует без него):', err);
  }
}

/** [слаг, название, ккал, белки, жиры, углеводы, граммов в порции, подпись порции] — всё на 100 г. */
type FoodRow = [string, string, number, number, number, number, number | null, string | null];

/**
 * Имя для поиска: нижний регистр, «ё» → «е». Дублирует normalizeFoodName из src/services/food.ts —
 * сид не может его импортировать: в рантайм-образ попадает каталог prisma/, но не src/.
 */
function normalizeFoodName(name: string): string {
  return name.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/**
 * Базовый справочник продуктов. Новые позиции добавляются, изменившиеся — обновляются (цифры
 * в файле иногда правятся), удалённые из файла остаются в базе: на них ссылаются записи дневника.
 */
async function seedFoods(): Promise<void> {
  const file = path.join(__dirname, 'data', 'foods.ru.json');
  const rows = JSON.parse(fs.readFileSync(file, 'utf8')) as FoodRow[];

  const existing = await prisma.foodProduct.findMany({ where: { source: 'seed' } });
  const bySlug = new Map(existing.map((p) => [p.externalId, p]));

  const fresh = [];
  let updated = 0;
  for (const [slug, name, kcal100, protein100, fat100, carbs100, servingGrams, servingLabel] of rows) {
    const data = { name, nameLc: normalizeFoodName(name), kcal100, protein100, fat100, carbs100, servingGrams, servingLabel };
    const current = bySlug.get(slug);
    if (!current) {
      fresh.push({ source: 'seed', externalId: slug, ...data });
    } else if ((Object.keys(data) as (keyof typeof data)[]).some((k) => current[k] !== data[k])) {
      await prisma.foodProduct.update({ where: { id: current.id }, data });
      updated += 1;
    }
  }
  if (fresh.length) await prisma.foodProduct.createMany({ data: fresh, skipDuplicates: true });
  console.log(`Справочник продуктов: всего ${rows.length}, добавлено ${fresh.length}, обновлено ${updated}.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
