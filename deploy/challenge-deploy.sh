#!/usr/bin/env bash
# Опрашивает origin/main и передеплоивает при изменении.
# Ставится на сервер в /usr/local/bin/ и запускается systemd-таймером (см. *.timer).
set -euo pipefail
cd /opt/challenge
git fetch --quiet origin main
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [ "$LOCAL" != "$REMOTE" ]; then
  echo "$(date -Is) deploy $LOCAL -> $REMOTE"
  git reset --hard origin/main
  docker compose up -d --build
  docker image prune -f
else
  echo "$(date -Is) up-to-date ($LOCAL)"
fi
