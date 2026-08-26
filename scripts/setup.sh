#!/usr/bin/env bash
set -Eeuo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker Engine or Docker Desktop, then run this script again." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required. Update Docker, then run this script again." >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example. Set every CHANGE_ME value, then run this script again." >&2
  exit 1
fi

if grep -Eq '^([A-Z0-9_]+)=CHANGE_ME' .env; then
  echo "Your .env still contains CHANGE_ME values. Replace them with strong secrets before deployment." >&2
  exit 1
fi

docker compose config --quiet
docker compose up --build --detach
docker compose exec backend npm run seed
docker compose ps
echo "Deployment is running. Open the address configured by APP_ORIGIN after its reverse proxy is ready."
