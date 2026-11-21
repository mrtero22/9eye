#!/usr/bin/env bash
# Starts or stops the demo's PostgreSQL (localhost only); its log is /var/lib/9eye/pg.log.
#   bash docker/demo/pg.sh start | stop
set -euo pipefail
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)
case "${1:-}" in
  start) runuser -u postgres -- "$PGBIN/pg_ctl" -D /var/lib/9eye/pg -l /var/lib/9eye/pg.log -o "-c listen_addresses=127.0.0.1 -p 5432" -w -s start ;;
  stop) runuser -u postgres -- "$PGBIN/pg_ctl" -D /var/lib/9eye/pg -m fast -w -s stop ;;
  *) echo "usage: pg.sh start|stop" >&2; exit 2 ;;
esac
