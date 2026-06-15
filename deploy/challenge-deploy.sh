#!/usr/bin/env bash
# Деплой: подтягивает origin/main и пересобирает при изменении.
# Используется и systemd-таймером, и GitHub Actions (self-hosted раннер).
# flock сериализует запуски, чтобы таймер и раннер не деплоили одновременно.
set -euo pipefail
exec 9>/var/lock/challenge-deploy.lock
flock 9
cd /opt/challenge
git fetch --quiet origin main
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [ "$LOCAL" != "$REMOTE" ]; then
  echo "$(date -Is) deploy $LOCAL -> $REMOTE"
  git reset --hard origin/main
  docker compose up -d --build
  docker image prune -f
  docker compose ps
else
  echo "$(date -Is) up-to-date ($LOCAL)"
fi
