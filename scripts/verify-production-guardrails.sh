#!/usr/bin/env bash
set -euo pipefail

if command -v rg >/dev/null 2>&1; then
  FINDER='rg -q'
else
  FINDER='grep -Eq'
fi

$FINDER 'ARG YTDLP_VERSION' Dockerfile
$FINDER 'ARG SPOTDL_VERSION' Dockerfile
$FINDER 'RUN test -n "\$YTDLP_VERSION" && test -n "\$SPOTDL_VERSION"' Dockerfile
$FINDER 'COPY --from=builder /app/node_modules ./node_modules' Dockerfile
$FINDER 'npx --no-install prisma db push && exec node server.js' Dockerfile
$FINDER 'DATABASE_URL is required in production' prisma.config.ts

echo "Production guardrails verified."
