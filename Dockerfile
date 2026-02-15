FROM node:22-trixie-slim

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# better-sqlite3 may need native build tooling depending on platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copy only install-critical files first for better layer caching.
COPY package.json package-lock.json ./
COPY scripts ./scripts
COPY tsconfig.json ./tsconfig.json

RUN npm ci

# Copy app source and build.
COPY . .

RUN npx prisma generate
RUN npm run build

RUN mkdir -p /app/data /app/downloads

ENV NODE_ENV=production
ENV DATABASE_URL=file:./data/dev.db

EXPOSE 3000

# Ensure downloader binaries and SQLite schema exist on container startup.
CMD ["sh", "-c", "npm run setup && npm run db:push && npm run start"]
