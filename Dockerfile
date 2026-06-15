# syntax=docker/dockerfile:1

# ---------- Сборка фронта (Vue 3) ----------
FROM public.ecr.aws/docker/library/node:20-slim AS web
WORKDIR /app/web
COPY web/package.json ./
RUN npm install
COPY web/ ./
RUN npm run build

# ---------- Сборка сервера (TS) ----------
FROM public.ecr.aws/docker/library/node:20-slim AS server-build
WORKDIR /app/server
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY server/package.json ./
RUN npm install
COPY server/ ./
RUN npx prisma generate
RUN npm run build

# ---------- Рантайм ----------
FROM public.ecr.aws/docker/library/node:20-slim AS runtime
WORKDIR /app/server
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# node_modules из стадии сборки (включает сгенерированный Prisma Client, prisma CLI и tsx)
COPY --from=server-build /app/server/node_modules ./node_modules
COPY --from=server-build /app/server/dist ./dist
COPY server/package.json ./
COPY server/prisma ./prisma

# собранный фронт раздаётся сервером как статика
COPY --from=web /app/web/dist ./web/dist
ENV WEB_DIST=/app/server/web/dist

EXPOSE 3000

# Применяем схему к БД (db push), сидируем и стартуем
CMD ["sh", "-c", "npx prisma db push --skip-generate && npx tsx prisma/seed.ts && node dist/index.js"]
