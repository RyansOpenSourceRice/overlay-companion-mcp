[![Sheld.io: Prefunctional Development](https://img.shields.io/badge/Sheld.io-Prefunctional%20Development-blueviolet?style=flat-square)](https://sheld.io) [![Vibe Coded: Disclosure](https://img.shields.io/badge/Vibe%20Coded-Disclosure-informational?style=flat-square)](https://github.com/danielrosehill/Vibe-Coded-Disclosure)

AI GUI Test Harness (AllHands)

Goal
- Provide a simple, key‑free, AI‑first GUI test harness that runs in AllHands cloud without GitHub Actions or external API keys.

Highlights
- No API keys (uses MCP stdio where available; otherwise degrades to smoke tests)
- Runs under a virtual display (Xvfb) so overlays render
- Saves screenshots and JSON transcripts to artifacts/
- Lives entirely under tests/ai-gui/ to avoid clutter

Prereqs (AllHands cloud)
- Linux base with apt available (for Xvfb/ImageMagick). The setup script will attempt to install minimal packages.
- .NET SDK 8+ (the repo scripts already auto-install if missing)

Quick start

# From the repo root
./tests/ai-gui/run.sh

What run.sh does
1) Ensures Xvfb and minimal tools are installed (via setup.sh)
2) Builds the app (dotnet publish) if no existing binary is found
3) Starts a virtual display and launches the app without HEADLESS
4) Runs the Python harness to:
   - Try MCP stdio: list tools, draw_overlay, take_screenshot, remove_overlay
   - If MCP not available, run a smoke test: capture screen using ImageMagick and verify the app window appears
5) Saves evidence in tests/ai-gui/artifacts/

Folder structure
- run.sh                 Entry point to run tests under Xvfb
- setup.sh               Minimal dependency bootstrap (xvfb, imagemagick, python venv)
- harness.py             Orchestrates test flow and evidence capture
- planner.py             Simple rule-based planner for creative test steps (key-free)
- drivers/mcp_stdio.py   Minimal JSON-RPC over stdio client
- verifier/image_checks.py  Image assertions using Pillow (and numpy if available)
- scenarios/basic.yaml   Example scenario spec for planner
- artifacts/             Screenshots, logs, transcripts (gitignored)

Notes
- HEADLESS is NOT set during visual tests so overlays can render.
- If you want purely API plumbing, set HEADLESS=1 in the environment before run.sh (the harness will auto switch to API-only checks).
- If the MCP stdio server is not yet functional, harness will run smoke tests and still produce artifacts.

Troubleshooting
- If xvfb-run is missing and setup.sh cannot install it, you can fallback to headless API tests by exporting HEADLESS=1.
- If ImageMagick import is missing, the harness will attempt a pure Pillow capture fallback (not always available in headless). Prefer installing imagemagick.
