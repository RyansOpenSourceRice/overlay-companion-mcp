#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
ARTIFACTS="$HERE/artifacts"
mkdir -p "$ARTIFACTS"

# 1) Minimal deps
"$HERE/setup.sh"

# 2) Build app if not already published
if [ ! -f "$ROOT/build/publish/overlay-companion-mcp" ]; then
  echo "[AI-GUI] Building app (dotnet publish)..."
  bash "$ROOT/scripts/build-appimage.sh" || true
  # Fallback to direct publish if AppImage script is unavailable or fails
  if [ ! -f "$ROOT/build/publish/overlay-companion-mcp" ]; then
    DOTNET=dotnet
    if command -v dotnet >/dev/null 2>&1; then DOTNET=dotnet; elif [ -x "$HOME/.dotnet/dotnet" ]; then DOTNET="$HOME/.dotnet/dotnet"; fi
    "$DOTNET" publish "$ROOT/src/OverlayCompanion.csproj" -c Release -r linux-x64 --self-contained true -o "$ROOT/build/publish" /p:PublishSingleFile=true
  fi
fi

APP_BIN="$ROOT/build/publish/overlay-companion-mcp"
if [ ! -x "$APP_BIN" ]; then
  echo "[AI-GUI] ERROR: app binary not found at $APP_BIN" | tee "$ARTIFACTS/error.txt"
  exit 1
fi

# 3) Launch under virtual display and run harness
VSCREEN=${VSCREEN:-"1920x1080x24"}
XVFB_ARGS=${XVFB_ARGS:-"-screen 0 ${VSCREEN}"}

export AI_GUI_APP_BIN="$APP_BIN"
export AI_GUI_ROOT="$ROOT"
export AI_GUI_ARTIFACTS="$ARTIFACTS"

if command -v xvfb-run >/dev/null 2>&1; then
  xvfb-run -s "$XVFB_ARGS" bash -lc "\
    set -euo pipefail; \
    source '$HERE/.venv/bin/activate'; \
    python '$HERE/harness.py' | tee '$ARTIFACTS/harness.log' \
  "
else
  echo "[AI-GUI] WARNING: xvfb-run not found; falling back to HEADLESS API-only smoke test"
  HEADLESS=1 bash -lc "\
    set -euo pipefail; \
    source '$HERE/.venv/bin/activate'; \
    python '$HERE/harness.py' | tee '$ARTIFACTS/harness.log' \
  "
fi
