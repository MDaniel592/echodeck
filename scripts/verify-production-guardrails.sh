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
$FINDER 'RUN --mount=type=cache,target=/root/.npm PRISMA_VERSION=' Dockerfile
$FINDER 'DOTENV_VERSION=' Dockerfile
$FINDER 'npm install --no-save --no-audit --no-fund --ignore-scripts' Dockerfile
$FINDER 'npx --no-install prisma db push && exec node server.js' Dockerfile
$FINDER 'DATABASE_URL is required in production' prisma.config.ts

if rg -q 'COPY( --link)? --from=builder /app/node_modules ./node_modules' Dockerfile; then
  echo "Guardrail failed: full node_modules copy must not be present in runner stage."
  exit 1
fi

echo "Production guardrails verified."
