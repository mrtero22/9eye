#!/bin/sh
# Builds the website for its domain and uploads it to Cloudflare Pages (decision 0022).
# Reads CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID from the repository's .env (never printed).
# The site is open to search engines since 2026-10-29 (SITE_INDEX=1 by default, user);
# SITE_INDEX=0 builds it closed again (every page noindex) — that removes it from Google.
set -e
cd "$(dirname "$0")/.."
ENV_FILE=../../.env
CLOUDFLARE_API_TOKEN=$(grep '^CLOUDFLARE_API_TOKEN=' "$ENV_FILE" | cut -d= -f2-)
CLOUDFLARE_ACCOUNT_ID=$(grep '^CLOUDFLARE_ACCOUNT_ID=' "$ENV_FILE" | cut -d= -f2-)
if [ -z "$CLOUDFLARE_API_TOKEN" ] || [ -z "$CLOUDFLARE_ACCOUNT_ID" ]; then
  echo "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are missing in $ENV_FILE" >&2
  exit 1
fi
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
export SITE_URL="${SITE_URL:-https://9eye.org}"
export SITE_INDEX="${SITE_INDEX:-1}"
export WRANGLER_SEND_METRICS=false

sh scripts/astro.sh build
PATH=/opt/node24/bin:$PATH npx --yes wrangler@4.152.0 pages deploy dist --project-name "${PAGES_PROJECT:-9eye}" --branch main --commit-dirty=true
# Open to search engines: tell IndexNow about the pages (a failed ping does not fail the deploy).
if [ "$SITE_INDEX" = "1" ]; then sh scripts/indexnow.sh || true; fi
