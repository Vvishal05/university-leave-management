#!/usr/bin/env bash
set -Eeuo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

[[ -f .env ]] || { echo "Missing .env. Copy .env.example and configure it first." >&2; exit 1; }
grep -Eq '^([A-Z0-9_]+)=CHANGE_ME' .env && { echo "Replace all CHANGE_ME values in .env before deploying." >&2; exit 1; }

docker compose config --quiet
docker compose build --pull
docker compose up --detach --remove-orphans
docker compose ps
echo "Updated containers are running. Run 'docker compose logs --follow' if a service needs attention."
