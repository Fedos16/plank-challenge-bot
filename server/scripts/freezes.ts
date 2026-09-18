/**
 * Пересчёт заморозок серии по всем участникам всех челленджей.
 *
 * Заработанные заморозки считаются из истории, поэтому отдельная миграция не нужна:
 * у всех, кто уже накопил серию, заморозки появляются сами. Скрипт нужен, чтобы
 * посмотреть глазами, сколько у кого получилось, и найти расхождения
 * (потраченных больше, чем заработано, или заморозка применена раньше её получения).
 *
 * Запуск: npm run freezes
 */
import { prisma } from '../src/lib/prisma';
import { getFreezeState } from '../src/services/freezes';
import { displayName } from '../src/services/users';
import { dateToDay } from '../src/lib/time';

async function main(): Promise<void> {
  const challenges = await prisma.challenge.findMany({ orderBy: { id: 'asc' } });
  if (!challenges.length) {
    console.log('Челленджей в базе нет.');
    return;
  }

  for (const challenge of challenges) {
    const participations = await prisma.participation.findMany({
      where: { challengeId: challenge.id },
      include: { user: true },
      orderBy: { joinedAt: 'asc' },
    });

    console.log(
      `\n=== «${challenge.title}» (#${challenge.id}) · заморозка за ${challenge.freezeEveryDays} дн. подряд, ` +
        `максимум на руках ${challenge.maxFreezes}${challenge.freezeEveryDays > 0 && challenge.maxFreezes > 0 ? '' : ' — ВЫКЛЮЧЕНО'} ===`,
    );
    if (!participations.length) {
      console.log('Участников нет.');
      continue;
    }

    let totalEarned = 0;
    let totalUsed = 0;
    let totalAvailable = 0;

    for (const p of participations) {
      const state = await getFreezeState(challenge, p);
      totalEarned += state.earned;
      totalUsed += state.used;
      totalAvailable += state.available;

      const name = displayName(p.user).padEnd(24).slice(0, 24);
      const suffix = p.status === 'active' ? '' : ' (вышел)';
      console.log(
        `${name} заработал ${state.earned} · потратил ${state.used} · доступно ${state.available}` +
          ` · серия подряд ${state.runLength}${suffix}`,
      );

      if (state.used > state.earned) {
        console.log(`  ⚠️ потрачено больше, чем заработано (${state.used} > ${state.earned})`);
      }
      for (const u of state.usages) {
        if (u.earnedDay > u.day) {
          console.log(`  ⚠️ заморозка на ${u.day} получена только ${u.earnedDay}`);
        }
      }
      if (state.usages.length) {
        console.log(
          `  заморожены дни: ${state.usages.map((u) => u.day).join(', ')}`,
        );
      }
    }

    const frozenRows = await prisma.streakFreeze.count({ where: { challengeId: challenge.id } });
    console.log(
      `Итого: заработано ${totalEarned}, потрачено ${totalUsed} (записей в базе ${frozenRows}), доступно сейчас ${totalAvailable}.`,
    );
    console.log(`Старт челленджа: ${dateToDay(challenge.startDate)}.`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
