#!/usr/bin/env bash
# Deploys the images CI pushed for one commit. Run by dokudocs-deploy from
# /opt/dokudocs with that commit checked out; the registry token is on stdin.
set -euo pipefail

sha=$1
export DOKUDOCS_IMAGE=ghcr.io/unfik/dokudocs DOKUDOCS_TAG=$sha
backups=/var/backups/dokudocs
keep=10

env_value() { sed -n "s/^$1=//p" .env | tail -n 1; }

# The same files make build uses, so observability stays as .env has it.
files=(-f docker-compose.yaml)
case "$(env_value OBSERVABILITY)" in
  true | 1 | yes) files+=(-f docker-compose.observability.yaml) ;;
esac
compose=(docker compose "${files[@]}")

docker login ghcr.io --username github-actions --password-stdin >/dev/null
"${compose[@]}" pull --quiet migrate api collab frontend

# Migrations only go forward: keep a dump from before them.
mkdir -p "$backups"
dump="$backups/$(date -u +%Y%m%dT%H%M%SZ)-${sha:0:12}.sql.gz"
"${compose[@]}" exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip >"$dump"
ls -1t "$backups"/*.sql.gz | tail -n +$((keep + 1)) | xargs -r rm --
echo "Database dumped to $dump"

"${compose[@]}" up -d --no-build --remove-orphans

port=$(env_value FRONTEND_PORT)
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${port:-8088}/api/v1/health" >/dev/null &&
    curl -fsS "http://127.0.0.1:${port:-8088}/sign-in" | grep -q '<div id="root">'; then
    echo "$sha" >.deployed
    echo "Deployed $sha"
    exit 0
  fi
  sleep 2
done

"${compose[@]}" ps
"${compose[@]}" logs --tail 50 migrate api collab frontend
echo "The site did not come up healthy after deploying $sha" >&2
exit 1
