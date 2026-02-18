# syntax=docker/dockerfile:1.7
# ---- Builder stage ----
FROM node:22-trixie-slim AS builder

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL=file:./data/dev.db
ARG YTDLP_VERSION
ARG SPOTDL_VERSION
ARG YTDLP_SHA256
ARG SPOTDL_SHA256
ENV YTDLP_VERSION=${YTDLP_VERSION}
ENV SPOTDL_VERSION=${SPOTDL_VERSION}
ENV YTDLP_SHA256=${YTDLP_SHA256}
ENV SPOTDL_SHA256=${SPOTDL_SHA256}
ENV SKIP_SETUP=1

# Native build tooling for better-sqlite3
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates xz-utils \
  && rm -rf /var/lib/apt/lists/*

# Copy install-critical files first for better layer caching.
COPY package.json package-lock.json ./
COPY scripts ./scripts
COPY tsconfig.json ./tsconfig.json

RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# Copy app source and build.
COPY . .

RUN npx prisma generate && npm run build

# Download downloader binaries during build so they are cached in the image.
RUN test -n "$YTDLP_VERSION" && test -n "$SPOTDL_VERSION" \
  && SKIP_SETUP=0 npm run setup

# ---- Runner stage ----
FROM node:22-trixie-slim

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV DATABASE_URL=file:./data/dev.db
ENV PORT=3000
ENV NODE_OPTIONS="--max-old-space-size=256"

# ca-certificates needed for any outbound HTTPS (yt-dlp updates, etc.)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install runtime-only tools not traced into standalone:
# - prisma + dotenv for startup migrations
# - tsx for detached download task workers (`node --import tsx`)
# Resolve exact versions from the lockfile to avoid runtime drift.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm PRISMA_VERSION="$(node -p 'require("./package-lock.json").packages["node_modules/prisma"].version')" \
  && DOTENV_VERSION="$(node -p 'require("./package-lock.json").packages["node_modules/dotenv"].version')" \
  && TSX_VERSION="$(node -p 'require("./package-lock.json").packages["node_modules/tsx"].version')" \
  && npm install --no-save --no-audit --no-fund --ignore-scripts \
    "prisma@${PRISMA_VERSION}" \
    "dotenv@${DOTENV_VERSION}" \
    "tsx@${TSX_VERSION}"

# Copy standalone output.
COPY --link --from=builder /app/.next/standalone ./
COPY --link --from=builder /app/.next/static ./.next/static
COPY --link --from=builder /app/public ./public

# Prisma schema + migrations + config (needed for migrate deploy at startup)
COPY --link --from=builder /app/prisma ./prisma
COPY --link --from=builder /app/prisma.config.ts ./prisma.config.ts

# Generated Prisma client (standalone traces include it, but be explicit)
COPY --link --from=builder /app/app/generated ./app/generated

# Detached worker sources executed by tsx at runtime.
COPY --link --from=builder /app/lib ./lib
COPY --link --from=builder /app/scripts ./scripts
COPY --link --from=builder /app/tsconfig.json ./tsconfig.json

# Downloader binaries fetched during build
COPY --link --from=builder /app/bin ./bin

RUN mkdir -p /app/data /app/downloads

EXPOSE 3000

# Apply versioned migrations before starting the server.
CMD ["sh", "-c", "npx --no-install prisma migrate deploy && exec node server.js"]
