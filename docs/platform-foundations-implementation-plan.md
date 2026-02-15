# Platform Foundations Roadmap

## Goal
Move from a single-user downloader/player to a scalable multi-user media platform without breaking current workflows.

## Principles
- Keep current download and playback flow working during each phase.
- Prefer additive schema changes first, cleanup later.
- Ship in small slices with tests per slice.

## Phase 1: Multi-User and Access Control

### Data model
- Add roles: `admin`, `user`.
- Add ownership to core entities: songs, playlists, download tasks, task events.
- Make playlist uniqueness user-scoped, not global.
- Add optional server-side sessions/revocation table.

### API and auth
- Add a shared `requireAuth()` helper returning `userId` and role.
- Scope all reads/writes by `userId`.
- Add admin user-management endpoints.
- Add session revoke/logout-all endpoint.

### Migration order
1. Add nullable `userId` columns.
2. Backfill existing rows to bootstrap admin.
3. Enforce non-null and ownership indexes.

### Success criteria
- Users cannot read or mutate another user’s data.
- Existing single-user instances auto-migrate cleanly.

## Phase 2: Metadata and Browse Model

### Data model
- Add `Artist` and `Album` tables.
- Expand song metadata: album, albumArtist, track/disc numbers, year, genre, ISRC, lyrics, technical audio fields.
- Add indexes for artist/album/song browse and sort.

### Ingestion
- Enrich downloader ingestion with metadata when available.
- Add metadata parsing for local files.
- Keep dedup behavior compatible with existing library data.

### API/UI
- Add artist and album browse endpoints.
- Extend song filters/sorting by album/year/genre.
- Add Artists/Albums views in UI.

### Success criteria
- Users can browse by artist/album and view ordered album tracks.

## Phase 3: Library Import and Scan

### Data model
- Add `Library`, `LibraryPath`, and `LibraryScanRun`.
- Track file linkage fields on songs (library, relative path, mtime/hash).

### Services
- Add scanner service for enumerate -> extract metadata -> upsert -> cleanup.
- Add manual scans first, scheduled scans next, watch mode last.
- Serialize scan jobs per library.

### API
- Libraries CRUD-lite endpoints.
- Scan trigger and scan-run history endpoints.

### Success criteria
- Existing folders can be imported reliably and re-scanned incrementally.

## Phase 4: Client Compatibility Layer

### Routing
- Add dedicated compatibility namespace: `app/api/subsonic/rest/route.ts`.

### Endpoint rollout
- Wave 1: basic auth/ping, library browse, song lookup, stream, playlists.
- Wave 2: search, scrobble, favorites/star, cover art.

### Implementation
- Keep mapping logic in a dedicated adapter layer.
- Keep all requests user-scoped.

### Success criteria
- At least one external client can browse and stream successfully.

## Phase 5: Playback State Sync

### Data model
- Add `PlaybackSession` (per user/device).
- Add `PlaybackQueueItem` (ordered queue items).

### API/UI
- Add get/update session endpoints.
- Add queue set/reorder endpoints.
- Keep localStorage as cache only; server becomes source of truth.

### Success criteria
- Queue and now-playing resume across refresh and across devices.

## Delivery Plan (PR Slices)
1. Auth guard refactor + ownership schema + backfill migration.
2. User-scoped route updates + isolation tests.
3. Artist/album schema + metadata ingestion updates.
4. Artist/album browse endpoints + UI views.
5. Library schema + manual scanner + scan APIs.
6. Scheduled/watch scan follow-up.
7. Compatibility layer wave 1.
8. Playback session schema/API/UI sync.

## Risks
- SQLite lock contention during scan/download concurrency.
- Existing UI assumptions about globally visible data.
- Behavior differences across external clients in compatibility endpoints.

## Done Criteria
- Multi-user ownership and role checks are enforced everywhere.
- Metadata model supports artist/album browse.
- Folder import/scan works for existing collections.
- Compatibility endpoints support external browse + stream.
- Playback state persists per user/device.
