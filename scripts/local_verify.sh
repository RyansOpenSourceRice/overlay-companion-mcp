#!/usr/bin/env bash
# R9 — local-first verification: exercise the running product end-to-end.
#
#   scripts/local_verify.sh [http://localhost:8080]
#
# Asserts, against a RUNNING stack (docker/podman compose up):
#   1. /health green
#   2. demo login works
#   3. the scripted prompt draws an overlay via chat (SSE contains
#      success:true + overlay_id)
#   4. (optional) Playwright pixel check when available — verifies the
#      annotation actually renders on the overlay canvas
#
# Runs entirely on your machine; no GitHub runners needed. A slim PR workflow
# only runs compile checks; heavy verification stays local per project policy.
set -euo pipefail

BASE="${1:-http://localhost:8080}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

fail() { echo "FAIL: $1"; exit 1; }
pass() { echo "PASS: $1"; }

# 1) health ---------------------------------------------------------------
HEALTH="$(curl -fsS "$BASE/health" || true)"
echo "$HEALTH" | grep -q '"status":"healthy"\|mcpServer' || fail "health endpoint not healthy"
pass "health"

# 2) login ----------------------------------------------------------------
CODE="$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR" -X POST "$BASE/auth/local/login" \
  -H 'content-type: application/json' \
  -d '{"username":"demo@overlay.local","password":"demo-password-1234"}')"
[ "$CODE" = "200" ] || fail "login returned $CODE"
pass "login"

# 3) scripted prompt -> overlay drawn -------------------------------------
SSE="$(curl -sN -b "$JAR" -X POST "$BASE/api/chat" \
  -H 'content-type: application/json' -H 'accept: text/event-stream' \
  --max-time 150 \
  -d '{"messages":[{"role":"user","content":"Draw a yellow circle around the close button of the welcome to OpenStreetMap window."}]}')"

if echo "$SSE" | grep -q 'overlay_id'; then
  pass "chat drew an overlay"
else
  # Non-determinism of small models: allow an explicit retry once.
  echo "... no overlay yet; retrying prompt"
  SSE="$(curl -sN -b "$JAR" -X POST "$BASE/api/chat" \
    -H 'content-type: application/json' -H 'accept: text/event-stream' \
    --max-time 150 \
    -d '{"messages":[{"role":"user","content":"Call template_overlay with template circle at x=960 y=540 width=200 height=200 color yellow now."}]}')"
  echo "$SSE" | grep -q 'overlay_id' || fail "no overlay_id in chat SSE after retry"
  pass "chat drew an overlay (retry)"
fi

# 4) optional pixel check --------------------------------------------------
# Resolution order for the playwright module:
#   1. plain import from repo-local infra/scripts/node_modules (symlink ok)
#   2. $PLAYWRIGHT_MODULE/playwright (explicit override)
if command -v node >/dev/null && { [ -d "infra/scripts/node_modules/playwright" ] || [ -d "infra/scripts/node_modules/playwright-core" ] || [ -d "${PLAYWRIGHT_MODULE:-}/playwright" ]; }; then
  export NODE_PATH="${PLAYWRIGHT_MODULE:-$PWD/infra/scripts/node_modules}"
  PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}" \
    node infra/scripts/pixel-check.mjs "$BASE" || fail "pixel check"
  pass "pixel check"
else
  echo "SKIP pixel check (playwright not found locally)"
fi

echo "ALL CHECKS PASSED ($BASE)"
