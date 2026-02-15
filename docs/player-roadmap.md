# Player, Cloud, and Source Roadmap

## Goal
Evolve the app from a local downloader/player into a scalable multi-source music platform:
- Great local playback UX
- Cloud-ready storage and streaming
- Robust Spotify/YouTube/SoundCloud ingestion

## Product Direction
Use an adapter-based architecture:
- Core domain: `Track`, `Playlist`, `Queue`, `PlaybackSession`
- Source adapters: Spotify, YouTube, SoundCloud
- Storage adapters: local disk now, object storage later (S3/R2)
- Delivery adapters: direct file stream now, adaptive/HLS later if needed

This keeps local playback stable while enabling cloud and source expansion without rewriting core features.

## Completed

### Auth and Security Hardening
- Login rate limiting (10 attempts / 15 min per IP) with 429 + Retry-After.
- Atomic first-user setup (transactional check-and-create, no race condition).
- Optional `SETUP_SECRET` to lock setup in production.
- JWT_SECRET fail-fast validation at startup via `instrumentation.ts`.
- Centralized safe-fetch utility (`lib/safeFetch.ts`): host allowlist, private/link-local IP blocking, redirect cap, response size/type/timeout limits.

### Library Scalability
- Server-side pagination, filtering, sorting, and search for songs (`GET /api/songs`).
- Server-side pagination and filtering for tasks (`GET /api/tasks`).
- Database indexes on Song (playlistId, source, createdAt, title, artist), DownloadTask (status, createdAt), DownloadTaskEvent (taskId).
- Internal `filePath`/`coverPath` stripped from client-facing API responses.

### Worker/Task Reliability
- Task heartbeat timestamps (30s interval) and stale-task recovery.
- Startup crash recovery: marks stuck "running" tasks as failed on boot.
- Cancel endpoint (`POST /api/tasks/:id/cancel`) with SIGTERM to worker.
- Retry endpoint (`POST /api/tasks/:id/retry`) creates new task from a failed one.
- Manual recovery endpoint (`POST /api/tasks/recover`).
- Live task updates via SSE (`/api/tasks/stream`, `/api/tasks/:id/stream`).

### Deployment and Config
- `JWT_SECRET` required in `docker-compose.yml` (fails with clear error if missing).
- `.env.example` documents all variables with generation instructions.
- `.env.example` defaults `ENABLE_AUTO_SETUP=1` for easier first-run setup.
- Reproducible downloader pinning via `YTDLP_VERSION`/`SPOTDL_VERSION`.
- Optional binary integrity verification via `YTDLP_SHA256`/`SPOTDL_SHA256`.
- `npm run validate-env` script checks required env vars per environment.
- `npm run check-deps` reports installed binary/tool versions.
- CI workflow: lint, typecheck, test, build.

### Code Quality
- Async FS in all API handlers (stream, cover, song delete).
- Strict parseInt validation across API routes.
- Vitest test suite (auth, rate limiting, sanitize, safeFetch, byte-range parsing).
- Removed unused QueuePanel component.

## Priority Roadmap

### P1: Core UX and Reliability
1. Queue/session persistence across devices
- Persist queue and now-playing session on backend per user.
- Keep localStorage as a fast cache, not source of truth.
- Support session resume after refresh and from another device.

2. Metadata expansion for music-player features
- Add album, albumArtist, trackNumber, discNumber, year, genre, ISRC, and lyrics fields.
- Enable album views, richer search, and smart playlists.

### P2: Cloud Player Foundations
1. Storage abstraction
- Introduce a storage interface (`put`, `get`, `delete`, `signedUrl`).
- Implement local adapter and object storage adapter.

2. CDN and signed delivery
- Serve cloud assets through signed URLs and CDN.
- Keep range-request support for seek behavior.

3. Worker queue hardening
- Replace detached process workers with a queue backend for retries, backoff, and observability.
- Add dead-letter handling and idempotency keys.

4. Multi-user ownership and permissions
- Add ownership to songs, playlists, tasks, and events.
- Add role checks for admin and regular users.

### P3: Spotify/YouTube Feature Expansion
1. Source search and import UX
- Add in-app search by track/artist/album/playlist and one-click enqueue.

2. Playlist sync mode
- Periodic sync for source playlists with policies:
  - import new tracks
  - skip known tracks
  - optionally archive removed tracks

3. Source-specific playback policy modes
- Keep downloaded-local playback as default.
- If needed, add separate policy-compliant mode for platform SDK playback.

## Technical Improvements by Area

### Playback
- Add global keyboard shortcuts (play/pause, next, previous, seek).
- Add gapless/crossfade option and replay gain normalization.
- Add explicit queue reordering APIs (drag-drop reorder sync).

### Download Pipeline
- Add health scoring for providers and failover preference order.
- Track per-provider latency/error metrics.
- Add configurable concurrency/rate limits by source.

### API and Data
- Add cursor pagination for tasks/events/songs.
- Add consistent error model with typed error codes.
- Add audit fields for moderation and debugging.

### Security
- Add CSRF strategy for state-changing routes where appropriate.
- Add explicit session revocation and refresh strategy.
