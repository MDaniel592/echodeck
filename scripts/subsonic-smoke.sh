#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${SUBSONIC_BASE_URL:-http://localhost:3000/api/subsonic/rest}"
USER_NAME="${SUBSONIC_USER:-}"
PASSWORD="${SUBSONIC_PASS:-}"
CLIENT_NAME="${SUBSONIC_CLIENT_NAME:-smoke}"
VERSION="${SUBSONIC_VERSION:-1.16.1}"

if [[ -z "${USER_NAME}" || -z "${PASSWORD}" ]]; then
  echo "Set SUBSONIC_USER and SUBSONIC_PASS."
  exit 1
fi

PASS_HEX="$(printf '%s' "${PASSWORD}" | xxd -p -c 999)"

call() {
  local cmd="$1"
  shift
  curl -fsS "${BASE_URL}/${cmd}.view?u=${USER_NAME}&p=enc:${PASS_HEX}&v=${VERSION}&c=${CLIENT_NAME}&f=json$*"
}

echo "== ping"
call "ping" | head -c 300; echo

echo "== getOpenSubsonicExtensions"
call "getOpenSubsonicExtensions" | head -c 400; echo

echo "== getMusicFolders"
call "getMusicFolders" | head -c 500; echo

echo "== search3"
call "search3" "&query=a&artistCount=2&albumCount=2&songCount=2" | head -c 600; echo

echo "== getRandomSongs"
RANDOM_JSON="$(call "getRandomSongs" "&size=1")"
echo "${RANDOM_JSON}" | head -c 600; echo

SONG_ID="$(printf '%s' "${RANDOM_JSON}" | sed -n 's/.*"id":"\([0-9]\+\)".*/\1/p' | head -n 1)"
if [[ -n "${SONG_ID}" ]]; then
  echo "== stream range test (id=${SONG_ID})"
  curl -fsSI \
    -H "Range: bytes=0-1023" \
    "${BASE_URL}/stream.view?u=${USER_NAME}&p=enc:${PASS_HEX}&v=${VERSION}&c=${CLIENT_NAME}&f=json&id=${SONG_ID}" \
    | sed -n '1,20p'
else
  echo "No song found; skipping stream range test."
fi

echo "Smoke test complete."
