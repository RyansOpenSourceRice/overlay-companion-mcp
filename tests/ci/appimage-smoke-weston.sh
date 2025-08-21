#!/usr/bin/env bash
set -euo pipefail

APPIMAGE_PATH="${1:?AppImage path required}"
if [ ! -f "$APPIMAGE_PATH" ]; then
  echo "AppImage not found: $APPIMAGE_PATH" >&2
  exit 1
fi

export XDG_RUNTIME_DIR="$HOME/.xdg-runtime"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

# Start weston in headless mode with Xwayland
weston --backend=headless --xwayland --idle-time=0 --socket=wayland-ci --log=/tmp/weston.log &
WESTON_PID=$!
trap 'kill $WESTON_PID >/dev/null 2>&1 || true' EXIT

# Give weston time to start
sleep 3

# Export Wayland env and run the AppImage with smoke-test
export WAYLAND_DISPLAY=wayland-ci
export AVALONIA_PLATFORM=Wayland
export AVALONIA_USE_WAYLAND=1
export OC_WINDOW_READY_FILE=/tmp/oc_window_ready_wayland.txt

set +e
"$APPIMAGE_PATH" --smoke-test > /tmp/appimage-wayland.log 2>&1 &
PID=$!
set -e

for i in $(seq 1 40); do
  if [ -f "$OC_WINDOW_READY_FILE" ]; then
    echo "✅ Wayland window-ready detected: $OC_WINDOW_READY_FILE"
    kill $PID >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 1
  if ! kill -0 $PID >/dev/null 2>&1; then
    echo "❌ AppImage process exited early. Logs:" >&2
    tail -n +1 /tmp/appimage-wayland.log || true
    exit 1
  fi

done

echo "❌ No Wayland window-ready signal within timeout. Logs:" >&2
echo "--- weston.log ---" >&2
head -n 200 /tmp/weston.log || true

echo "--- appimage-wayland.log ---" >&2
head -n 200 /tmp/appimage-wayland.log || true
exit 1
