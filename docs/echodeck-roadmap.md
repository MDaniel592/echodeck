# EchoDeck Roadmap

## Goal
Evolve EchoDeck from a local downloader/player into a scalable multi-user, multi-source music platform with:
- Great local playback UX
- Cloud-ready storage and streaming
- Robust Spotify/YouTube/SoundCloud ingestion
- External client compatibility (Subsonic/OpenSubsonic)

## Product Direction
Use an adapter-based architecture:
- Core domain: `Track`, `Playlist`, `Queue`, `PlaybackSession`
- Source adapters: Spotify, YouTube, SoundCloud
- Storage adapters: local disk now, object storage later (S3/R2)
- Delivery adapters: direct file stream now, adaptive/HLS later if needed

## Completed Foundations

### Platform foundations (multi-user + data model)
- Added roles (`admin`, `user`) and ownership to core entities.
- Added shared auth guard (`requireAuth`) returning user identity and role.
- Scoped API reads/writes to user ownership and added admin user-management APIs.
- Added logout-all/session invalidation endpoint.
- Backfill + ownership verification scripts for single-user migration.

### Metadata and browse model
- Added artist/album data model and links from songs.
- Expanded metadata fields (album, albumArtist, track/disc numbers, year, genre, ISRC, lyrics, and technical audio fields).
- Added artist/album browse endpoints and UI views.
- Added sorting/filtering support for album/year/genre.

### Library import and scan
- Added library schema (`Library`, `LibraryPath`, `LibraryScanRun`) and song file-link fields.
- Added scanner flow (enumerate -> metadata extract -> upsert -> cleanup).
- Added manual scan APIs and scan-run history APIs.
- Added scheduled scan + watch-triggered scan follow-up.
- Serialized scan jobs per library.

### Client compatibility layer
- Added dedicated compatibility namespace under `app/api/subsonic/rest`.
- Implemented browse/stream/search/playlist/scrobble/star/cover-art and related endpoints.
- Kept mapping logic in adapter utilities and preserved user scoping.

### Playback state sync
- Added `PlaybackSession` and `PlaybackQueueItem` data models.
- Added session + queue set/reorder APIs.
- Implemented client hydration/sync behavior with localStorage as cache.

### Additional shipped work
- Login rate limiting, setup hardening, and JWT startup validation.
- Safe fetch controls (host/IP/redirect/size/type/timeout constraints).
- Task reliability improvements (heartbeat, stale recovery, cancel/retry/recover, SSE streams).
- Deployment/env quality improvements and CI checks.

## Priority Roadmap

### P1: UX and reliability polish
1. Playback session maturity
- Improve cross-device resume behavior and conflict handling between active devices.
- Persist and restore playback position with better fidelity.

2. Metadata-driven UX
- Expand album-first browsing, richer search, and smart playlists based on metadata.

### P2: Cloud player foundations
1. Storage abstraction
- Introduce storage interface (`put`, `get`, `delete`, `signedUrl`).
- Implement local adapter and object storage adapter.

2. CDN and signed delivery
- Serve cloud assets through signed URLs/CDN while preserving range-request behavior.

3. Worker queue hardening
- Replace detached workers with a queue backend (retry/backoff/observability).
- Add dead-letter handling and idempotency keys.

### P3: Source expansion
1. Source search/import UX
- In-app search for track/artist/album/playlist with one-click enqueue.

2. Playlist sync mode
- Periodic source playlist sync policies: import new, skip known, optionally archive removed.

3. Source-specific policy modes
- Keep downloaded-local playback as default.
- Add policy-compliant SDK playback mode if needed.

## Technical Improvements by Area

### Playback
- Global keyboard shortcuts (play/pause/next/previous/seek).
- Gapless/crossfade and replay-gain normalization options.
- Keep explicit queue reorder sync APIs aligned with UI drag-drop behavior.

### Download pipeline
- Provider health scoring and failover preference order.
- Per-provider latency/error metrics.
- Configurable concurrency/rate limits by source.

### API and data
- Cursor pagination for tasks/events/songs.
- Consistent typed error model.
- Additional audit fields for moderation/debugging.

### Security
- CSRF strategy for state-changing routes where appropriate.
- Explicit refresh/session revocation strategy documentation and implementation.
