# Subsonic Client Smoke Test

This verifies the compatibility layer before testing in a GUI client.

## 1) Start server

```bash
npm run dev
```

## 2) Set env vars in another shell

```bash
export SUBSONIC_BASE_URL="http://localhost:3000/api/subsonic/rest"
export SUBSONIC_USER="your_username"
export SUBSONIC_PASS="your_password"
```

## 3) Run smoke script

```bash
npm run subsonic:smoke
```

The script checks:
- `ping`
- `getOpenSubsonicExtensions`
- `getMusicFolders`
- `search3`
- `getRandomSongs`
- `stream` with byte-range (if a song exists)

## 4) GUI client setup

Use:
- URL: `http://<host>:3000/api/subsonic/rest`
- Username/password: app credentials
- API version: `1.16.1` when configurable

If client supports token auth:
- Use standard Subsonic `t` + `s`.

If using reverse proxy/TLS, use your public HTTPS URL as `SUBSONIC_BASE_URL`.
