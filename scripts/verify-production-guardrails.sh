#!/usr/bin/env bash
set -euo pipefail

if ! command -v rg >/dev/null 2>&1; then
  echo "ripgrep (rg) is required for verify-production-guardrails.sh" >&2
  exit 1
fi

rg -q 'ARG YTDLP_VERSION' Dockerfile
rg -q 'ARG SPOTDL_VERSION' Dockerfile
rg -q 'RUN test -n "\$YTDLP_VERSION" && test -n "\$SPOTDL_VERSION"' Dockerfile
rg -q 'COPY --from=builder /app/node_modules/\.bin/prisma ./node_modules/\.bin/prisma' Dockerfile
rg -q 'test -x \./node_modules/\.bin/prisma && \./node_modules/\.bin/prisma db push --skip-generate' Dockerfile
rg -q 'DATABASE_URL is required in production' prisma.config.ts

echo "Production guardrails verified."
