# Overlay Companion (MCP) – Web‑first Specification

This specification defines the browser‑first architecture for Overlay Companion. The MCP server (C#/.NET) exposes an HTTP transport and broadcasts overlay events over WebSockets to a browser viewer that renders a guaranteed click‑through layer (CSS `pointer-events: none`). Native GTK4 overlays remain available for local sessions, but the default UX is the web viewer.

---

## 1) Architecture

Reference deployment (self‑hosted, OSS‑first):

```
AI Client (Cherry Studio) ──HTTP──▶ MCP Server (C#/.NET, ASP.NET Core)
                                     │
                                     ├──WebSocket (/ws/overlays) ──▶ Browser Overlay Viewer (HTML/JS)
                                     │                                  ├─ Overlay layer (pointer-events: none)
                                     │                                  └─ Viewport cropping (vx, vy, vw, vh, scale)
                                     │
                                     └──Reverse Proxy (Caddy) ──▶ Apache Guacamole ──▶ guacd ──▶ RDP ──▶ Fedora Silverblue VM (xrdp)
```

- Orchestration: Podman (rootless) containers, provisioned by OpenTofu modules
- Datastore: Postgres for Guacamole (and future session state)
- Target desktop: Fedora Silverblue (Wayland) with xrdp inside a VM, single large RDP desktop spanning monitors
- Multi‑monitor MVP: Two browser windows, each full‑screen on a physical display and cropped to its viewport of the RDP desktop

Legacy STDIO transport exists for compatibility, but HTTP is the default and recommended.

---

## 2) Server Endpoints

- GET /mcp: MCP over HTTP (official SDK)
- GET /ws/overlays: WebSocket broadcast of overlay events (fan‑out to all connected viewers)
- GET /: Static overlay viewer (stub)
- GET /setup, GET /config: Convenience configuration endpoints

---

## 3) Browser Overlay Protocol (WebSocket)

Message types
- overlay_created
- overlay_removed
- clear_overlays
- request_sync (planned)
- sync_state (planned)

Example payloads
```json
{ "type": "overlay_created", "overlay": {
  "id": "d3f1...",
  "x": 100, "y": 200, "width": 300, "height": 120,
  "color": "#ffcc00", "opacity": 0.5,
  "monitor_index": 0, "created_at": "2025-08-24T08:10:00Z"
}}
```
```json
{ "type": "overlay_removed", "overlay_id": "d3f1..." }
```
```json
{ "type": "clear_overlays" }
```

Viewer URL parameters (cropping for multi‑monitor)
- vx, vy: viewport origin (global desktop coordinates)
- vw, vh: viewport size
- scale: client‑side scaling factor

The overlay layer is absolutely positioned with `pointer-events: none`, so all user input passes through to the underlying viewer (e.g., Guacamole canvas).

---

## 4) Tool Surface (summary)

The MCP toolset focuses on overlays, screenshots, and light input/sessions. Canonical, machine‑readable definitions live in MCP_SPECIFICATION.md. Key tools and notable parameters:

- draw_overlay (async)
  - x, y, width, height (px)
  - color (name or hex), opacity (0..1, default 0.5)
  - label (optional text), temporary_ms
  - click_through (bool, default true)
  - monitor_index (int, optional)
- remove_overlay (sync): overlay_id
- clear_overlays (sync): removes all overlays
- batch_overlay (async): array of overlay specs; optional one_at_a_time
- take_screenshot (async): region/full_screen, scale, wait_for_stable_ms
- get_display_info (sync): monitor geometry for viewport planning
- click_at / type_text (sync/async): kept but typically mediated by human confirmation in assist/autopilot modes

Minimal JSON (abbreviated)
```json
{
  "mcp_spec_version": "1.0",
  "name": "overlay-companion-mcp",
  "description": "Web‑first overlays, screenshots, and input for human‑in‑the‑loop UI automation.",
  "tools": [
    {
      "id": "draw_overlay",
      "mode": "async",
      "params": {
        "x": { "type": "number" },
        "y": { "type": "number" },
        "width": { "type": "number" },
        "height": { "type": "number" },
        "color": { "type": "string", "optional": true },
        "opacity": { "type": "number", "optional": true },
        "label": { "type": "string", "optional": true },
        "temporary_ms": { "type": "number", "optional": true },
        "click_through": { "type": "boolean", "optional": true },
        "monitor_index": { "type": "number", "optional": true }
      },
      "returns": {
        "overlay_id": "string",
        "bounds": { "x": "number", "y": "number", "width": "number", "height": "number" },
        "monitor_index": "number"
      }
    }
  ]
}
```

---

## 5) Security Model

- TLS termination at Caddy; CORS configured for the web app
- Authentication/authorization handled at the proxy and Guacamole (OIDC or local); per‑viewer JWTs for overlay WS are planned
- No long‑term storage of screenshots by default; session data retention is configurable
- Principle of least privilege: input simulation gated by modes and confirmations

---

## 6) Implementation Roadmap (Web‑first)

Short‑term
- Replace stub viewer with Guacamole canvas; keep overlay layer above
- Initial WS sync on connect and “request_sync” message type
- Playwright E2E: draw, remove, clear, 2‑window viewport sync; click‑through verification

Medium
- Multi‑monitor window manager (launch/crop multiple viewers automatically)
- Per‑session auth tokens for WS overlay channels
- Server‑side overlay composition offscreen for recording/replay

Later
- Native wrapper/FreeRDP multimon for environments where browser is not available

---

## 7) Versioning

Date‑based: YYYY.MM.DD[.N]

---

## 8) Notes moved out of spec

This specification intentionally drops legacy content (Avalonia specifics, deep CI/CD mechanics, packaging minutiae). See docs/ for any remaining operational notes.
