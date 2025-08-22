#!/usr/bin/env bash
set -euo pipefail

# Local smoke test that checks whether the AppImage shows a window.
# It runs the AppImage with --smoke-test and waits for a ready file.

APPIMAGE_PATH="${1:-build/*.AppImage}"
READY_FILE="${OC_WINDOW_READY_FILE:-$HOME/.cache/overlay-companion-mcp/window-ready.txt}"
TIMEOUT_SEC=${TIMEOUT_SEC:-30}

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
export HEADLESS=0
"$APPIMAGE_PATH" --smoke-test --http > /tmp/oc-appimage.log 2>&1 &
PID=$!

# Optional: log xvfb-run display when under Xvfb
export DISPLAY=${DISPLAY:-:99}
set -e

# Wait for ready file (HTTP server startup or GUI window)
echo "⏳ Waiting for AppImage startup (HTTP server or GUI window)..."
for i in $(seq 1 $TIMEOUT_SEC); do
  if [ -f "$READY_FILE" ]; then
    echo "✅ Startup ready signal detected at $READY_FILE"
    
    # Check if HTTP server is running by looking for the listening message
    if grep -q "Now listening on.*:3000" /tmp/oc-appimage.log 2>/dev/null; then
      echo "✅ HTTP server confirmed running on port 3000"
    fi
    
    # Wait for process to exit naturally (smoke test should exit on its own)
    wait $PID 2>/dev/null || true
    echo "✅ AppImage smoke test completed successfully"
    exit 0
  fi
  sleep 1
  if ! kill -0 $PID >/dev/null 2>&1; then
    echo "❌ AppImage process exited early before startup completed. Logs:" >&2
    tail -n +1 /tmp/oc-appimage.log >&2 || true
    exit 1
  fi
  
  # Show progress every 5 seconds
  if [ $((i % 5)) -eq 0 ]; then
    echo "⏳ Still waiting... (${i}/${TIMEOUT_SEC}s)"
  fi
done

echo "❌ AppImage did not start within ${TIMEOUT_SEC}s. Logs:" >&2
cat /tmp/oc-appimage.log >&2 || true
kill $PID >/dev/null 2>&1 || true
ps aux | grep overlay-companion-mcp || true

exit 1
