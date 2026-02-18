# EchoDeck Plan (Simplified)

Last updated: 2026-02-18

## Current Scope
EchoDeck already covers:
- Multi-user auth and ownership scoping
- Library import/scan and metadata enrichment
- Download task queue + SSE updates
- Subsonic-compatible API
- Docker deployment with Prisma migrations

This file tracks only pending work, ordered by impact.

## Priority Now

### P0 Reliability and Ops
- Stabilize flaky CI around ownership backfill test.
- Add explicit health endpoints (`/api/health`, `/api/ready`) for proxy/orchestrator checks.
- Standardize API error payload shape (JSON) across routes.

### P1 Correctness and Performance
- Fix pagination/dedup consistency in songs API so `total` and visible rows match user expectations.
- Stop full-catalog fetch on homepage for large libraries; move to incremental loading/cursor pagination.
- Reduce database pressure from per-client task SSE polling (shared snapshots and/or push model).

### P1 Security Hardening
- Keep reverse-proxy CSRF model explicit (`TRUST_PROXY`, `CSRF_TRUSTED_ORIGINS`) and test-covered.
- Revisit login rate limiting to reduce third-party account lockout risk.

## Optional (Technical Debt)
- Split large modules:
  - `app/api/subsonic/rest/route.ts`
  - `app/components/Player.tsx`
  - `app/components/DownloadForm.tsx`
- Introduce storage adapter abstraction for future S3/R2 support.

## Not Planned Short-Term
- Adaptive/HLS streaming
- Full queue backend replacement for workers
- Provider SDK playback modes
