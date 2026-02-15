# Forum Post Template

## Title options

- EchoDeck: self-hosted music library player with background downloads
- EchoDeck (Next.js + Prisma): self-hosted downloader and streaming player

## Body template

I am sharing **EchoDeck**, a self-hosted music library app built with Next.js and Prisma.

What it does:

- Import tracks from supported sources
- Store files in your own storage
- Stream with seek/range support
- Track background download jobs with live status

Project links:

- Repo: `<your repo URL>`
- Setup docs: `<README URL>`
- Security policy: `<SECURITY.md URL>`

Operational notes:

- Intended for self-hosted use
- Production requires `JWT_SECRET` and `SETUP_SECRET`
- Reverse proxy mode is supported via `TRUST_PROXY=1`

Legal/compliance note:

- Users are responsible for complying with platform terms and copyright laws in their jurisdiction.

Feedback requested:

- Deployment feedback (Docker/reverse proxy)
- Reliability/observability suggestions
- UX improvements for queue and task visibility
