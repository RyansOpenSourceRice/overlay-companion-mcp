[![Sheld.io: Prefunctional Development](https://img.shields.io/badge/Sheld.io-Prefunctional%20Development-blueviolet?style=flat-square)](https://sheld.io) [![Vibe Coded: Disclosure](https://img.shields.io/badge/Vibe%20Coded-Disclosure-informational?style=flat-square)](https://github.com/danielrosehill/Vibe-Coded-Disclosure)


# Clipboard Bridge (Rust)

A tiny HTTP service to read/write the VM clipboard for Overlay Companion MCP.
Supports **bidirectional** clipboard: copy into the VM (POST) and out of the VM
(GET), which is what makes clipboard-based workflows usable through the web
viewer (Phase E2).

- Port: 8765 (configurable via CLIPBOARD_BRIDGE_PORT)
- Bind: 0.0.0.0 (configurable via CLIPBOARD_BRIDGE_HOST)
- Auth: `X-API-Key` header. **Required.** The service refuses to start without a
  strong, non-default key (Phase E3 hardening — the old hardcoded
  `overlay-companion-mcp` default is rejected).
- CORS: restricted to `CLIPBOARD_BRIDGE_ALLOWED_ORIGIN` (default
  `http://localhost:8080`, the management server's web origin). Never `*`.
- Location: `apps/clipboard-bridge-rust`

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `CLIPBOARD_BRIDGE_HOST` | `0.0.0.0` | Bind address |
| `CLIPBOARD_BRIDGE_PORT` | `8765` | Listen port |
| `CLIPBOARD_BRIDGE_API_KEY` | (none) | **Required** shared secret for `X-API-Key` |
| `CLIPBOARD_BRIDGE_ALLOWED_ORIGIN` | `http://localhost:8080` | Allowed browser origin |

Run (direct):

```
CLIPBOARD_BRIDGE_API_KEY='<strong-random-secret>' \
CLIPBOARD_BRIDGE_ALLOWED_ORIGIN='http://localhost:8080' \
cargo run --release -p clipboard-bridge --manifest-path apps/clipboard-bridge-rust/Cargo.toml
```

Docker/compose integration is recommended in production.

Legacy implementations:
- A previous Flatpak/Python version now lives in `legacy/clipboard-bridge-python`. Use only for reference.

API examples (bidirectional):

- Health: `curl http://127.0.0.1:8765/health`
- Copy OUT of the VM: `curl -H "X-API-Key: <key>" http://127.0.0.1:8765/clipboard`
- Copy INTO the VM: `curl -X POST -H "Content-Type: application/json" -H "X-API-Key: <key>" \
    -d '{"content":"Hello","content_type":"text/plain"}' http://127.0.0.1:8765/clipboard`
- Clear: `curl -X DELETE -H "X-API-Key: <key>" http://127.0.0.1:8765/clipboard`

Notes:
- Uses Wayland (`wl-clipboard`) or X11 (`xclip`/`xsel`) if available; otherwise
  falls back to GTK clipboard when present in runtime.
- In the container-desktop test target (Kasm/noVNC), the browser clipboard and
  the VM clipboard are bridged through this service by the web viewer, so copy
  in and copy out both work without host `xclip` permissions.
- **Permissions.** The web viewer calls the bridge with the `X-API-Key`; the
  management server holds the key server-side and never exposes it to the
  browser. Keep `CLIPBOARD_BRIDGE_ALLOWED_ORIGIN` set to the actual web origin.
- Designed to be minimal and headless.
