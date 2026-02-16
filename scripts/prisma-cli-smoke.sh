#!/usr/bin/env bash
set -euo pipefail

# Smoke test that the local Prisma CLI is resolvable without network installs.
DB_FILE="./tmp/prisma-cli-smoke.db"
mkdir -p ./tmp
rm -f "$DB_FILE"

DATABASE_URL="file:${DB_FILE}" npx --no-install prisma db push

echo "Prisma CLI smoke test passed."
