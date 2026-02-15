# Contributing

## Scope

EchoDeck is a self-hosted project. Contributions should prioritize:

- Security and operational safety
- Reliability under public internet exposure
- Clear documentation and predictable behavior

## Local setup

1. Copy `.env.example` to `.env`.
2. Set `JWT_SECRET`.
3. Run `npm install`.
4. Run `npm run setup` to install required binaries.
5. Run `npm run dev`.

## Before opening a PR

Run:

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`

## Security expectations

- Never commit secrets, tokens, private keys, or personal data.
- Do not post sensitive logs in issues or PRs.
- If you find a vulnerability, use the process in `SECURITY.md`.

## Commit and PR guidance

- Keep changes focused and scoped.
- Include rationale for non-trivial behavior changes.
- Add or update tests when fixing bugs.
- Update docs when adding env vars, APIs, or deployment behavior.

## Legal/compliance note

Contributors should avoid language that implies bypassing platform terms or copyright protections.
Use neutral wording centered on self-hosted library management and lawful use.
