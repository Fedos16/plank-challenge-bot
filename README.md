# Спортивные челленджи — Telegram-бот + Web App

Telegram-бот с Web App для трекинга ежедневных спортивных челленджей. Первый челлендж —
**«Планка каждый день»**: участники ежедневно присылают видео-кружок с планкой в общий чат,
бот отслеживает выполнение, серии, болезни, штрафы и общий банк, а каждое утро шлёт отчёт
за предыдущий день с мотивационной речью.

## Возможности

- **Подтверждение планки** — бот ловит видео-кружки в общем чате, засчитывает при длительности
  ≥ минимума (по умолчанию 60 сек) и до дедлайна (23:59).
- **Модерация** — под каждым засчитанным кружком админ может нажать «Фейк (×2)» или
  «Не засчитывать»; штрафы пересчитываются автоматически.
- **Болезни** — команда `/sick` или кнопка в боте до 14:00 освобождает от штрафа за день.
- **Дневной отчёт** — каждое утро в чат: кто сделал/пропустил/болел, день челленджа, серии,
  банк и одна из ~40 редактируемых мотивационных речей.
- **Напоминания** — вечером тем, кто ещё не прислал кружок.
- **Банк** — учётный реестр (штрафы пополняют, траты списывают); сумму можно править вручную.
- **Web App** — профиль (серия, рекорд, пропуски, штрафы, статус), рейтинг, правила.
- **Админка** (внутри Web App, для пользователей с правами) — редактирование всех настроек:
  штраф, множитель за фейк, дедлайны, минимум планки, текст правил, даты, чат, банк, речи,
  участники, ручные правки статусов за день, запуск отчёта.

## Стек

- **Сервер:** Node.js + TypeScript, [grammY](https://grammy.dev) (бот), [Fastify](https://fastify.dev) (API), [Prisma](https://www.prisma.io) + PostgreSQL, node-cron.
- **Фронт:** Vue 3 + Vite (Telegram Web App).
- **Деплой:** Docker Compose (app + Postgres + Caddy с авто-HTTPS).

## Структура

```
challenge/
├── server/                 # бот + API + cron
│   ├── src/
│   │   ├── bot/            # grammY: бот, клавиатуры, хэндлеры
│   │   ├── api/            # Fastify: сервер, auth(initData), роуты
│   │   ├── jobs/           # планировщик (отчёт, напоминания)
│   │   ├── services/       # доменная логика (статусы, серии, банк, отчёт…)
│   │   ├── lib/            # config, prisma, time, валидация initData
│   │   └── index.ts        # точка входа
│   └── prisma/             # schema.prisma + seed.ts
├── web/                    # Vue 3 Web App
│   └── src/
│       ├── components/     # Profile / Leaderboard / Rules / Admin
│       ├── api.ts, types.ts, telegram.ts, helpers.ts, styles.css
│       └── App.vue, main.ts
├── Dockerfile              # multi-stage: web build → server build → runtime
├── docker-compose.yml
├── Caddyfile
└── .env.example
```

## Настройка бота в Telegram (@BotFather)

1. Создайте бота: `/newbot`, получите **BOT_TOKEN**.
2. **Отключите privacy mode** (иначе бот не увидит чужие кружки в группе):
   `/setprivacy` → выберите бота → **Disable**.
   *Либо* сделайте бота **администратором** общей группы — тогда он получает все сообщения
   независимо от privacy mode.
3. Привяжите Web App: `/newapp` (или `/setmenubutton`) и укажите URL `https://<ваш-домен>`.
4. Узнайте свой Telegram ID (напишите [@userinfobot](https://t.me/userinfobot)) и впишите его
   в `ADMIN_TELEGRAM_IDS`.

## Деплой на VPS (Docker)

Требуется: домен, указывающий A-записью на IP сервера, и установленный Docker + Docker Compose.

```bash
cp .env.example .env
# заполните BOT_TOKEN, PUBLIC_DOMAIN, WEBAPP_URL, WEBHOOK_SECRET, ADMIN_TELEGRAM_IDS, POSTGRES_PASSWORD
docker compose up -d --build
```

При старте контейнер `app`:
- применяет схему к БД (`prisma db push`),
- сидирует челлендж «Планка» и ~40 речей (идемпотентно),
- запускает сервер (бот + API + cron) и устанавливает webhook.

Caddy сам получит TLS-сертификат Let's Encrypt для `PUBLIC_DOMAIN`.

После запуска:
1. Добавьте бота в общую группу (админом либо с отключённым privacy mode).
2. В группе выполните `/bindchat` (от админа) — чат привяжется к челленджу, кружки начнут
   засчитываться. Узнать id чата можно командой `/chatid`.
3. Откройте Web App у бота — профиль и (для админов) раздел «Админ».

## Локальная разработка

Нужны Node.js 20+ и PostgreSQL (можно поднять только БД: `docker compose up -d db`).

```bash
# сервер
cd server
cp ../.env.example .env        # DATABASE_URL → ваш локальный/докерный Postgres
#   для localhost: postgresql://challenge:challenge@localhost:5432/challenge
#   USE_WEBHOOK=false (long polling, не нужен публичный URL для самого бота)
npm install
npm run prisma:generate
npm run prisma:migrate:dev      # или: npx prisma db push
npm run prisma:seed
npm run dev                     # бот (long polling) + API на :3000

# фронт (в другом терминале)
cd web
npm install
npm run dev                     # Vite на :5173, /api проксируется на :3000
```

Для проверки Web App в браузере без Telegram задайте `web/.env`:
```
VITE_DEV_TELEGRAM_ID=<ваш_telegram_id>
```
— сервер в dev-режиме (`NODE_ENV != production`) примет этот заголовок вместо initData.

Сам Web App внутри Telegram требует HTTPS — для тестирования поднимите туннель
(`cloudflared tunnel --url http://localhost:5173` или `ngrok http 5173`) и укажите его URL в
`WEBAPP_URL` и в кнопке Web App у @BotFather.

### Быстрый smoke-тест API (без бота)

Проверяет весь путь API → сервисы → БД на запущенном Postgres с применённой схемой и сидом:

```bash
cd server
# поднимите БД (docker compose up -d db) и примените схему: npx prisma db push && npm run prisma:seed
DATABASE_URL=postgresql://challenge:challenge@localhost:5432/challenge \
  ADMIN_TELEGRAM_IDS=999 NODE_ENV=development npm run smoke
```

Скрипт дёргает `/api/challenge`, `/api/me`, `/api/leaderboard`, админские роуты (банк, речи,
участники, ручная правка дня, запуск отчёта) под dev-пользователем `999` и печатает результаты.

## Как считается планка

- Кружок (`video_note`) от зарегистрированного участника в привязанном чате с
  `duration ≥ minDurationSec` → засчитан (`counted`). После дедлайна → `late` (= пропуск, штраф).
- Содержание (реально ли планка, не монтаж) автоматически не проверяется — для этого ручная
  модерация админом: «Фейк (×2)» (двойной штраф) или «Не засчитывать».
- Нет ни кружка, ни валидного больничного к концу дня → пропуск, штраф `fineAmount`.
- Серия (`streak`) — последовательные дни с засчитанной планкой; валидный больничный её
  «замораживает» (настраивается `freezeStreakOnSick`).

## Команды бота

| Команда | Доступ | Назначение |
|---|---|---|
| `/start` | все | регистрация + кнопка Web App |
| `/app` | все | кнопка запуска Web App (работает и в группе) |
| `/sick` | участники | сообщить о болезни на сегодня |
| `/rules` | все | правила челленджа |
| `/id` | все | узнать свой Telegram ID |
| `/chatid` | админ | id текущего чата |
| `/bindchat` | админ | привязать текущий чат к челленджу |
| `/pinapp` | админ | опубликовать и закрепить кнопку запуска приложения |
| `/report [YYYY-MM-DD]` | админ | вручную сформировать и отправить отчёт |

## Открытие Web App из группы

Inline-кнопки `web_app` Telegram разрешает только в личке. Чтобы запускать приложение из
группы, используется **Direct Link Mini App**: настройте в @BotFather **Main Mini App** (или
`/newapp` с коротким именем) с URL вашего домена. После этого работают `/app`, `/pinapp` и
кнопки в отчётах. `/pinapp` публикует и закрепляет кнопку запуска вверху группы.

## Авто-деплой

Деплой по пушу в `main` через **GitHub Actions на self-hosted раннере**
(`.github/workflows/deploy.yml`). Раннер развёрнут прямо на сервере, поэтому деплой выполняется
локально (без SSH) и не зависит от GitHub-hosted минут/биллинга. Шаги job:
`git fetch && git reset --hard origin/main && docker compose up -d --build`.

Сервер развёрнут как git-клон в `/opt/challenge`; `.env` лежит рядом (в `.gitignore`) и
`git reset --hard` его не трогает. Раннер: служба
`actions.runner.Fedos16-plank-challenge-bot.challenge-vps` (`/opt/actions-runner`, под root).
