# EchoDeck Release Process

## Recommended flow
1. Merge changes into `main` only when CI is green.
2. `Release Please` opens/updates a Release PR automatically from commits on `main`.
3. Merge the Release PR to:
- Bump `package.json` / `package-lock.json` version automatically.
- Create the Git tag (for example `v1.0.1`) and GitHub Release automatically.
4. The release workflow (tag-triggered) will:
- Publish multi-arch Docker images to GHCR.
- Attach source `.tar.gz` + `.sha256` assets to the GitHub Release.

## Pre-merge quality gate
Run locally (or ensure CI passes):

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Integration smoke:

```bash
npm run build
JWT_SECRET=local-test-secret DATABASE_URL=file:./itest.db SETUP_SECRET=local-setup-secret NODE_ENV=production npm run start
# separate shell
npm run test:integration
```

## Release PR and tagging behavior

- Do not manually edit version numbers for normal releases.
- Do not manually create tags for normal releases.
- Keep conventional commits so semantic version bumps are correct:
`feat` -> minor, `fix` -> patch, `feat!` / `BREAKING CHANGE` -> major.

## Commit history conventions
Use clear commit subjects to keep release notes understandable:
- `feat:` new behavior
- `fix:` bug fix
- `refactor:` internal restructuring
- `docs:` documentation only
- `chore:` maintenance/tooling

Example:
- `feat(auth): add logout-all endpoint`
- `fix(tasks): recover stale running workers on boot`
- `docs(roadmap): consolidate into echodeck roadmap`

## GitHub repository settings (one-time)
Configure these in GitHub `Settings`:

1. `Settings -> Actions -> General -> Workflow permissions`
- Set to `Read and write permissions`.
- Enable `Allow GitHub Actions to create and approve pull requests`.

2. `Settings -> Branches -> Branch protection rules -> main`
- Require a pull request before merging.
- Require status checks to pass before merging.
- Select checks:
`CI / ci`
`Commit Lint / commitlint`
- (Recommended) Require conversation resolution.
- (Recommended) Require linear history.

3. `Settings -> Actions -> General`
- Allow actions from GitHub Marketplace (needed for `release-please`, `docker/*`, `softprops/*`, `wagoid/*` actions used in workflows).

4. `Packages (GHCR)`
- Verify package visibility and access policy for `ghcr.io/<owner>/echodeck` matches your release intent (private/public).
