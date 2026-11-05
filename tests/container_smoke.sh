#!/bin/bash
set -euo pipefail

ENGINE="${ENGINE:-docker}"
IMAGE="${IMAGE:-research-digest:test}"
NAME="rd-smoke-$$"
PORT="${PORT:-18080}"

cleanup() { "$ENGINE" rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
status() { curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$1"; }

"$ENGINE" run -d --name "$NAME" -p "127.0.0.1:$PORT:8080" \
    --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges \
    "$IMAGE" >/dev/null

for _ in $(seq 1 30); do
    [ "$(status /)" = 200 ] && break
    sleep 0.5
done

[ "$(status /)" = 200 ] || fail "/ not served"
[ "$(status /app/digest.html)" = 200 ] || fail "app page not served"
[ "$(status /sw.js)" = 200 ] || fail "sw.js not served"
[ "$(status /vendor/ort/ort-wasm-simd-threaded.wasm)" = 200 ] || fail "ort wasm missing"
for blocked in /config.json /db.py /Caddyfile /.env /run.sh; do
    [ "$(status "$blocked")" = 404 ] || fail "$blocked is exposed"
done

headers="$(curl -sI "http://127.0.0.1:$PORT/")"
grep -qi '^cross-origin-opener-policy: same-origin' <<<"$headers" || fail "COOP header missing"
grep -qi '^cross-origin-embedder-policy: require-corp' <<<"$headers" || fail "COEP header missing"

uid="$("$ENGINE" exec "$NAME" id -u)"
[ "$uid" != 0 ] || fail "container process runs as root"

echo "ok"
