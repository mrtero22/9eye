#!/bin/sh
# Astro 7 needs Node 22 or newer. The host Node is 20 (the API and the app stay on it), so the site
# runs on /opt/node24 when the default node is older. The built site is plain files and needs no Node.
cd "$(dirname "$0")/.." || exit 1
NODE=node
major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$major" -lt 22 ] && [ -x /opt/node24/bin/node ]; then NODE=/opt/node24/bin/node; fi
ASTRO=node_modules/astro/bin/astro.mjs
[ -f "$ASTRO" ] || ASTRO=../../node_modules/astro/bin/astro.mjs
[ -f "$ASTRO" ] || { echo "astro is not installed: run npm install" >&2; exit 1; }
export ASTRO_TELEMETRY_DISABLED=1
exec "$NODE" "$ASTRO" "$@"
