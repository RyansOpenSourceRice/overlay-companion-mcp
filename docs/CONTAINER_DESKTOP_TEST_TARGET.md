# Container Desktop Test Target (Phase E1)

[![Vibe Coded: Disclosure](https://img.shields.io/badge/Vibe%20Coded-Disclosure-informational?style=flat-square)](https://github.com/danielrosehill/Vibe-Coded-Disclosure)

> **What this is.** A **container desktop** (browser-reachable GUI) used as the
> E2E target for the Playwright suite and for local manual testing. It is **not**
> a nested VM and needs no `/dev/kvm`, no KVM passthrough, and no hypervisor.
> It reuses the project's existing KasmVNC integration (ConnectionManager
> already speaks `kasmvnc | vnc | rdp`).

## Why a container, not a nested VM

- The Overlay Companion is a **web viewer over KasmVNC**; a container desktop is
  the exact topology it was designed for.
- No nested virt, no heavy base images, no special host permissions beyond Docker.
- It doubles as the **Playwright CI target**: headless FireFox drives the real
  SPA (login, connections, settings) exactly as a user would.

## Topology

```
browser (FireFox, Playwright)
   │  http
   ▼
overlay-web (management server + SPA)
   │  /mcp proxy
   ▼
mcp-server (C#) ──► kasmvnc (container desktop GUI, browser-pane)
   │
   └──► clipboard-bridge (Rust, bidirectional clipboard)
```

## Running it

```bash
cd infra
# Required: a strong secret for the clipboard bridge (fail-fast if absent).
export CLIPBOARD_BRIDGE_API_KEY='<strong-random>'
podman-compose -f kasmvnc-compose.yml up -d
```

Services:
- KasmVNC GUI: `http://localhost:6080`
- Web viewer: `http://localhost:8082`
- MCP server: `http://localhost:3001`
- Clipboard bridge: `http://localhost:8765` (X-API-Key auth, CORS pinned)

## Using it as the E2E target

The Playwright suite in `tests/playwright-csharp/` targets
`APP_TARGET_URL=http://localhost:8082` by default in CI against this stack.
Local run:

```bash
cd tests/playwright-csharp
dotnet build -c Release
~/.dotnet/tools/playwright install firefox
APP_TARGET_URL=http://localhost:8082 dotnet test -c Release
```

The web viewer's overlay canvas also exposes the **accessibility/semantics tree**
(`#overlay-companion-a11y` with roles + accessible names) so CI asserts on
semantic output, not pixel coordinates.

## Clipboard in/out (Phase E2)

Bidirectional clipboard works through `clipboard-bridge`:
- **Copy out of the VM:** `GET /clipboard` (X-API-Key)
- **Copy into the VM:** `POST /clipboard` with `{content, content_type}`

The web viewer holds the key server-side and never exposes it to the browser.
See `docs/CLIPBOARD_BRIDGE.md` for full config.
