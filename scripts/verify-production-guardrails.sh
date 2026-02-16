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
$FINDER 'COPY --from=builder /app/node_modules/\.bin/prisma ./node_modules/\.bin/prisma' Dockerfile
$FINDER 'test -x \./node_modules/\.bin/prisma && \./node_modules/\.bin/prisma db push --skip-generate' Dockerfile
$FINDER 'DATABASE_URL is required in production' prisma.config.ts

echo "Production guardrails verified."
