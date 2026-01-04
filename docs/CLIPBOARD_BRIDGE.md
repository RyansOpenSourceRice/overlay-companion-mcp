[![Sheld.io: Prefunctional Development](https://img.shields.io/badge/Sheld.io-Prefunctional%20Development-blueviolet?style=flat-square)](https://sheld.io) [![Vibe Coded: Disclosure](https://img.shields.io/badge/Vibe%20Coded-Disclosure-informational?style=flat-square)](https://github.com/danielrosehill/Vibe-Coded-Disclosure)


# Clipboard Bridge (Rust)

A tiny HTTP service to read/write the VM clipboard for Overlay Companion MCP.

- Port: 8765 (configurable via CLIPBOARD_BRIDGE_PORT)
- Bind: 0.0.0.0 (configurable via CLIPBOARD_BRIDGE_HOST)
- Auth: X-API-Key header (default: overlay-companion-mcp). Set CLIPBOARD_BRIDGE_API_KEY to override.
- Location: apps/clipboard-bridge-rust

Run (direct):

```
cargo run --release -p clipboard-bridge --manifest-path apps/clipboard-bridge-rust/Cargo.toml
```

Docker/compose integration is recommended in production.

Legacy implementations:
- A previous Flatpak/Python version now lives in legacy/clipboard-bridge-python. Use only for reference.


Run (Flatpak) [legacy notes]:
- The former Flatpak pipeline has been archived under legacy/clipboard-bridge-python. Prefer the Rust app above.

API examples:

- Health: curl http://127.0.0.1:8765/health
- Get clipboard: curl -H "X-API-Key: overlay-companion-mcp" http://127.0.0.1:8765/clipboard
- Set clipboard: curl -X POST -H "Content-Type: application/json" -H "X-API-Key: overlay-companion-mcp"         -d '{"content":"Hello","content_type":"text/plain"}' http://127.0.0.1:8765/clipboard

Notes:
- Uses Wayland (wl-clipboard) or X11 (xclip/xsel) if available; otherwise falls back to GTK clipboard when present in runtime.
- Designed to be minimal and headless.
