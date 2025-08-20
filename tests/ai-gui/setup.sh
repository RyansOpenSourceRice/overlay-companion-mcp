#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Python venv
if [ ! -d "$HERE/.venv" ]; then
  python3 -m venv "$HERE/.venv"
fi
source "$HERE/.venv/bin/activate"
python -m pip install --upgrade pip >/dev/null

# Try install minimal apt packages (best effort)
if command -v apt-get >/dev/null 2>&1; then
  (sudo apt-get update -y || apt-get update -y) >/dev/null || true
  (sudo apt-get install -y xvfb xauth imagemagick xdotool libx11-6 libxext6 libxrender1 libxi6 libxrandr2 libxtst6 libxcb1 libgl1 libfontconfig1 fonts-dejavu-core || \
   apt-get install -y xvfb xauth imagemagick xdotool libx11-6 libxext6 libxrender1 libxi6 libxrandr2 libxtst6 libxcb1 libgl1 libfontconfig1 fonts-dejavu-core) >/dev/null || true
fi

# Python deps (keep minimal)
pip install pillow numpy >/dev/null
# Optional: stronger checks if available
pip install opencv-python-headless >/dev/null || true

# For YAML scenarios
pip install pyyaml rich >/dev/null

# Official MCP Python SDK
pip install mcp >/dev/null
