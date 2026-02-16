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

# Native build tooling for better-sqlite3
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copy install-critical files first for better layer caching.
COPY package.json package-lock.json ./
COPY scripts ./scripts
COPY tsconfig.json ./tsconfig.json

RUN npm ci

# Copy app source and build.
COPY . .

RUN npx prisma generate
RUN npm run build

# Download downloader binaries during build so they are cached in the image.
RUN test -n "$YTDLP_VERSION" && test -n "$SPOTDL_VERSION"
RUN npm run setup

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

# Copy standalone output (includes only needed node_modules)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Prisma schema + config (needed for db push at startup)
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

# Generated Prisma client (standalone traces include it, but be explicit)
COPY --from=builder /app/app/generated ./app/generated

# Downloader binaries fetched during build
COPY --from=builder /app/bin ./bin

# better-sqlite3 native addon (serverExternalPackages)
COPY --from=builder /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder /app/node_modules/bindings ./node_modules/bindings
COPY --from=builder /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path
COPY --from=builder /app/node_modules/prebuild-install ./node_modules/prebuild-install
COPY --from=builder /app/node_modules/node-abi ./node_modules/node-abi

# Prisma CLI (needed for db push at startup)
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/dotenv ./node_modules/dotenv
COPY --from=builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma

RUN mkdir -p /app/data /app/downloads

EXPOSE 3000

# Push schema then start the standalone server.
CMD ["sh", "-c", "test -x ./node_modules/.bin/prisma && ./node_modules/.bin/prisma db push --skip-generate && node server.js"]
