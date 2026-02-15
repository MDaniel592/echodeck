# Security Policy

## Supported Versions

Only the latest `main` branch is supported for security fixes.

## Reporting a Vulnerability

Please do not open public GitHub issues for security vulnerabilities.

Report privately using GitHub Security Advisories for this repository.

Include:

- Affected version/commit
- Reproduction steps
- Impact assessment
- Suggested remediation (if available)

We will acknowledge receipt as soon as possible and coordinate a fix and disclosure timeline.

## Deployment Hardening

For public deployments:

- Set strong `JWT_SECRET` and `SETUP_SECRET`.
- Set `TRUST_PROXY=1` only when behind a trusted reverse proxy.
- Keep dependencies and binaries updated.
- Rotate provider credentials and move them to environment variables.
- Restrict service exposure at the network layer (firewall/reverse proxy).
