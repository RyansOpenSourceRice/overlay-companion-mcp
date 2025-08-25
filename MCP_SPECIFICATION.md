# Overlay Companion (MCP) – MCP Protocol (Web‑first)

This document defines the MCP surface for a browser‑first overlay system. The server exposes an HTTP transport at /mcp and broadcasts overlay events to web viewers via /ws/overlays. The browser renders a guaranteed click‑through layer using CSS pointer‑events: none. Native overlays remain optional; the default UX is the web viewer.

---

## Transport and Endpoints

- MCP over HTTP: GET/POST /mcp (ModelContextProtocol.AspNetCore)
- WebSocket overlays: /ws/overlays (text JSON messages)
- Static viewer: / (stub viewer drawing overlays); will embed Guacamole RDP canvas in future
- Setup/config helpers: /setup, /config

---

## WebSocket Overlay Messages

- overlay_created: { overlay: { id, x, y, width, height, color, opacity, monitor_index, created_at } }
- overlay_removed: { overlay_id }
- clear_overlays: {}
- request_sync (planned)
- sync_state (planned)

Viewer URL params for viewport cropping: vx, vy, vw, vh, scale.

---

## Tools (concise)

The canonical, machine‑readable definitions are implemented in code and summarized here for clarity.

### draw_overlay (async)
- x, y, width, height: number
- color?: string (name or hex)
- opacity?: number (0..1, default 0.5)
- label?: string
- temporary_ms?: number
- click_through?: boolean (default true)
- monitor_index?: number
Returns: overlay_id, bounds, monitor_index

### remove_overlay (sync)
- overlay_id: string
Returns: removed, not_found

### clear_overlays (sync)
Removes all overlays. Returns: ok

### batch_overlay (async)
- overlays: OverlaySpec[] (fields as in draw_overlay)
- one_at_a_time?: boolean
Returns: overlay_ids: string[]

### take_screenshot (async)
- region?: { x, y, width, height }
- full_screen?: boolean
- scale?: number
- wait_for_stable_ms?: number
Returns: image_base64, width, height, region, monitor_index, display_scale, viewport_scroll

### get_display_info (sync)
Returns: displays[], total_virtual_screen

### click_at (sync)
- x, y: number
- button?: "left" | "right" | "middle"
- clicks?: number
- require_user_confirmation?: boolean
- action_timing_hint?: object
Returns: success, was_confirmed

### type_text (async)
- text: string
- typing_speed_wpm?: number
- require_user_confirmation?: boolean
- action_timing_hint?: object
Returns: success, typed_length

---

## Modes and Safety

- Modes: passive (read‑only), assist (confirmation required), autopilot (guard‑railed automation)
- Input simulation is gated by mode and can require explicit user confirmation
- CORS configured; TLS terminates at reverse proxy (Caddy)
- Planned: per‑viewer JWTs for overlay WS and session scoping

---

## Roadmap Notes (implementation‑oriented)

- Replace stub viewer with Guacamole RDP canvas and keep overlay layer above
- Add initial WS sync (server emits current overlay state on connect)
- Playwright E2E across draw/remove/clear and 2‑window viewport sync
- Multi‑monitor launcher to open/crop two browser windows automatically

---

## Removed legacy content

This MCP spec intentionally removes outdated sections (Avalonia troubleshooting, AppImage internals, deep CI/CD notes, and claims like “no network access”). Those belong in separate operational docs if needed.
