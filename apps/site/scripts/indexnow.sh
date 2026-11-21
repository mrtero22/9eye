#!/bin/sh
# Tells IndexNow (Bing, Yandex, Seznam, Naver …) about every page in the built sitemap, so changes
# are picked up at once (docs/marketing/seo-plan.md). Run after a deploy that is open to search
# engines. The key is public by design: the file public/<key>.txt proves the site owns it.
set -e
cd "$(dirname "$0")/.."
KEY=41a282cdfdabb4e41d3d8ee0476c214e
HOST=9eye.org
URLS=$(grep -o '<loc>[^<]*</loc>' dist/sitemap.xml | sed -e 's/<loc>//' -e 's/<\/loc>//' | sed 's/.*/"&"/' | paste -sd, -)
[ -n "$URLS" ] || { echo "indexnow: no URLs in dist/sitemap.xml (built without SITE_URL?)" >&2; exit 1; }
curl -s -o /dev/null -w "indexnow: HTTP %{http_code}\n" -X POST https://api.indexnow.org/indexnow \
  -H 'Content-Type: application/json; charset=utf-8' \
  -d "{\"host\":\"$HOST\",\"key\":\"$KEY\",\"keyLocation\":\"https://$HOST/$KEY.txt\",\"urlList\":[$URLS]}"
