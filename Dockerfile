# 9eye demo: PostgreSQL, the API, the web app and the sample companies in one container.
# Demo only: it has a built-in password and MCP token. For real use, run the parts on their own
# (README, Quick start).
#
#   docker build -t 9eye .
#   docker run --rm -p 4101:4101 9eye     → http://localhost:4101 — demo@9eye.local / 9eye-demo-password
#   docker run --rm -i 9eye mcp           → the MCP server over stdio, as the demo admin (docs/mcp.md)

FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Packages first, so a change in the code does not reinstall them.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/site/package.json apps/site/
RUN npm ci --no-audit --no-fund

COPY . .

# The Prisma client, the web app's files, the demo settings, and a database with the sample companies.
RUN npm -w @9eye/api run db:generate \
 && npm -w @9eye/web run build \
 && cp docker/demo/env.demo .env \
 && echo "NINEEYE_SECRET_KEY=$(openssl rand -base64 32)" >> .env \
 && bash docker/demo/init-db.sh

EXPOSE 4101
ENTRYPOINT ["bash", "/app/docker/demo/entrypoint.sh"]
CMD ["web"]
