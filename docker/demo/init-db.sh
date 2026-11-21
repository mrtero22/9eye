#!/usr/bin/env bash
# Makes the demo database (Dockerfile): an empty PostgreSQL cluster, 9eye's tables, the sample
# companies, the demo admin and MCP token, and the working data (weeks, filled days, ad campaigns)
# made through the MCP tools. Runs when the image is built, and again when an empty volume is mounted
# on /var/lib/9eye.
set -euo pipefail
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)

mkdir -p /var/lib/9eye
chown postgres:postgres /var/lib/9eye
runuser -u postgres -- "$PGBIN/initdb" -D /var/lib/9eye/pg -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null

bash /app/docker/demo/pg.sh start
runuser -u postgres -- psql -h 127.0.0.1 -U postgres -q \
  -c "CREATE ROLE nineeye LOGIN PASSWORD 'nineeye-demo'" \
  -c "CREATE DATABASE nineeye OWNER nineeye"

set -a
. /app/.env
set +a
cd /app/apps/api
../../node_modules/.bin/prisma migrate deploy >&2
../../node_modules/.bin/tsx prisma/seed.ts >&2
../../node_modules/.bin/tsx scripts/demo-setup.ts /var/lib/9eye/demo-token
../../node_modules/.bin/tsx scripts/demo-data.ts
bash /app/docker/demo/pg.sh stop
