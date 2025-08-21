#!/usr/bin/env bash
set -euo pipefail

# Local smoke test that checks whether the AppImage shows a window.
# It runs the AppImage with --smoke-test and waits for a ready file.

APPIMAGE_PATH="${1:-build/*.AppImage}"
READY_FILE="${OC_WINDOW_READY_FILE:-$HOME/.cache/overlay-companion-mcp/window-ready.txt}"
TIMEOUT_SEC=${TIMEOUT_SEC:-60}

if [ ! -e $APPIMAGE_PATH ]; then
  echo "AppImage not found. Run the AppImage build first (scripts/build-appimage.sh)." >&2
  exit 1
fi

rm -f "$READY_FILE"
mkdir -p "$(dirname "$READY_FILE")"

export OC_WINDOW_READY_FILE="$READY_FILE"
export OC_SMOKE_TEST=1

# Some environments require --appimage-extract-and-run; try normally first then fallback
set +e
"$APPIMAGE_PATH" --smoke-test > /tmp/oc-appimage.log 2>&1 &
PID=$!

# Optional: log xvfb-run display when under Xvfb
export DISPLAY=${DISPLAY:-:99}
set -e

# Wait for ready file
for i in $(seq 1 $TIMEOUT_SEC); do
  if [ -f "$READY_FILE" ]; then
    echo "✅ Window ready signal detected at $READY_FILE"
    kill $PID >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 1
done

echo "❌ Window did not appear within ${TIMEOUT_SEC}s. Logs:" >&2
cat /tmp/oc-appimage.log >&2 || true
kill $PID >/dev/null 2>&1 || true
exit 1
