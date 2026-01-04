[![Sheld.io: Prefunctional Development](https://img.shields.io/badge/Sheld.io-Prefunctional%20Development-blueviolet?style=flat-square)](https://sheld.io) [![Vibe Coded: Disclosure](https://img.shields.io/badge/Vibe%20Coded-Disclosure-informational?style=flat-square)](https://github.com/danielrosehill/Vibe-Coded-Disclosure)


# Clipboard Bridge (Flatpak)

A tiny HTTP service to read/write the VM clipboard for Overlay Companion MCP.

- Port: 8765 (configurable via CLIPBOARD_BRIDGE_PORT)
- Bind: 0.0.0.0 (configurable via CLIPBOARD_BRIDGE_HOST)
- Auth: X-API-Key header (default: overlay-companion-mcp). Set CLIPBOARD_BRIDGE_API_KEY to override.

Run (Flatpak):

1) Build bundle (optional; CI does this on releases):
   - flatpak-builder --force-clean --repo=repo build flatpak/clipboard-bridge/org.overlaycompanion.ClipboardBridge.yml
   - flatpak build-bundle repo org.overlaycompanion.ClipboardBridge.flatpak org.overlaycompanion.ClipboardBridge --runtime
2) Install and run:
   - flatpak install --user ./org.overlaycompanion.ClipboardBridge.flatpak
   - flatpak run org.overlaycompanion.ClipboardBridge  # runs Rust HTTP service

CI smoke test:
- GitHub Actions builds the Flatpak headlessly, installs the bundle, launches the service, polls /health until healthy, then shuts down.
- The smoke test uses the headless server only; no GTK is required.

API examples:

- Health: curl http://127.0.0.1:8765/health
- Get clipboard: curl -H "X-API-Key: overlay-companion-mcp" http://127.0.0.1:8765/clipboard
- Set clipboard: curl -X POST -H "Content-Type: application/json" -H "X-API-Key: overlay-companion-mcp"         -d '{"content":"Hello","content_type":"text/plain"}' http://127.0.0.1:8765/clipboard

Notes:
- Uses Wayland (wl-clipboard) or X11 (xclip/xsel) if available; otherwise falls back to GTK clipboard when present in runtime.
- Designed to be minimal and headless.
