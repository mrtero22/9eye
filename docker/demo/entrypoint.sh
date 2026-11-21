#!/usr/bin/env bash
# The 9eye demo container (Dockerfile): PostgreSQL, then the web app (the default) or the MCP server
# over stdio.
#   docker run --rm -p 4101:4101 9eye     → the web app on http://localhost:4101
#   docker run --rm -i 9eye mcp           → MCP over stdio, as the demo admin in the sample station
set -euo pipefail
mode="${1:-web}"

# Only MCP messages may reach stdout (fd 3 keeps it for the stdio server); the rest goes to stderr.
exec 3>&1 1>&2

[ -f /var/lib/9eye/pg/PG_VERSION ] || bash /app/docker/demo/init-db.sh
bash /app/docker/demo/pg.sh start
trap 'bash /app/docker/demo/pg.sh stop || true' EXIT

set -a
. /app/.env
set +a
cd /app/apps/api

case "$mode" in
  mcp)
    # In the foreground, so the server reads the client's stdin; it ends when the client closes it.
    NINEEYE_MCP_TOKEN="$(cat /var/lib/9eye/demo-token)" ../../node_modules/.bin/tsx scripts/mcp-stdio.ts 1>&3
    ;;
  web)
    ../../node_modules/.bin/tsx src/server.ts &
    api=$!
    for _ in $(seq 1 120); do
      (exec 9<>/dev/tcp/127.0.0.1/4100) 2>/dev/null && break
      sleep 0.5
    done
    cd /app/apps/web
    ../../node_modules/.bin/vite preview --host 0.0.0.0 --port 4101 --strictPort &
    web=$!
    trap 'kill -TERM "$web" "$api" 2>/dev/null || true' TERM INT
    cat <<'EOF'

  9eye demo is running: http://localhost:4101
  Sign in as demo@9eye.local / 9eye-demo-password (a platform admin; sample companies only).
  MCP over stdio: docker run --rm -i <image> mcp

EOF
    wait "$web"
    ;;
  *)
    echo "Unknown mode \"$mode\": use web (the default) or mcp."
    exit 2
    ;;
esac
