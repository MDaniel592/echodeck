# EchoDeck Release Process (Simplified)

## Normal Flow
1. Merge to `main` only with green CI.
2. `Release Please` opens/updates a release PR.
3. Merge that release PR:
- version files are bumped automatically
- tag and GitHub release are created automatically
4. `release.yml` publishes release assets (`.tar.gz` + `.sha256`).

If no release PR appears, confirm at least one releasable commit (`feat` or `fix`) landed since the previous release.

## Pre-Release Checks
```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Optional integration smoke:
```bash
npm run build
JWT_SECRET=local-test-secret DATABASE_URL=file:./itest.db SETUP_SECRET=local-setup-secret NODE_ENV=production npm run start
# in another shell
npm run test:integration
```

## Commit Conventions
Release Please depends on Conventional Commits. Keep these rules:

- `feat:` minor release
- `fix:` patch release
- `feat!:` or `BREAKING CHANGE:` major release
- `docs:`, `chore:`, `refactor:`, `test:` normally do not trigger a version bump

Use clear scopes when possible:
- `feat(auth): add logout-all endpoint`
- `fix(tasks): recover stale running workers on boot`
- `docs(roadmap): simplify active plan`

For normal releases:
- Do not edit version numbers manually
- Do not create tags manually

## Manual Fallback
If tag exists but release workflow did not run:
1. Open `Actions -> Release -> Run workflow`
2. Provide the tag (for example `echodeck-v1.1.0`)
3. Run it manually
