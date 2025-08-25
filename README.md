# Overlay Companion MCP (Web‑first)

A browser‑first, human‑in‑the‑loop screen interaction system. The MCP server (C#/.NET) broadcasts overlay events over WebSockets, and a browser client renders them in a guaranteed click‑through layer (CSS pointer‑events: none). Native GTK4 overlays remain as an optional local path; the default UX is web.

- Protocol: Model Context Protocol (MCP) over HTTP
- Server: ASP.NET Core with /mcp (MCP), /ws/overlays (WebSocket), and a static viewer at /
- Viewer: Static HTML/JS overlay layer; planned integration with Apache Guacamole for remote desktop
- Infra preference: Podman (rootless), OpenTofu; target desktop VM: Fedora Silverblue with xrdp; OSS stack (Caddy, Guacamole, Postgres)

## Why the pivot to web‑first
- Guaranteed click‑through using CSS instead of compositor‑specific tricks
- Multi‑monitor with no native windowing hacks: open multiple browser windows cropped to viewports
- Works the same locally and over remote desktop (Guacamole)

## Architecture
Components
- MCP Server (C#/.NET)
  - /mcp: HTTP transport for MCP
  - /ws/overlays: WebSocket fan‑out of overlay events
  - /: Static viewer (stub) that draws overlays
- OverlayEventBroadcaster
  - In‑memory registry of WS clients; broadcasts create/remove/clear events
- Browser Viewer (stub)
  - Absolutely positioned overlay layer with pointer‑events: none
  - Viewport cropping via URL params: vx, vy, vw, vh, scale
  - Draws boxes from WS messages; clicks go to the canvas behind (or Guacamole in future)
- Remote Desktop (planned)
  - Apache Guacamole embeds a FreeRDP canvas; overlay sits above it in the DOM

Data flow
1) An MCP tool (e.g., draw_overlay) is invoked
2) Server updates internal state and broadcasts overlay events over /ws/overlays
3) Browser viewer renders the boxes in a click‑through overlay layer

Notes on native overlays
- GTK4 overlay windows are still supported for local sessions. On Wayland we attempt gtk‑layer‑shell; we clear the input region for pass‑through. The web path is the primary experience going forward.

## Quick start
Prereqs: .NET 8 SDK to build from source; any modern browser for the viewer.

- Run the server (dev):
  - dotnet run from src/ (or run the published binary/AppImage)
- Open the viewer:
  - http://localhost:3000/
- Create a test overlay:
  - From the GTK UI: Overlay tab -> Test Click‑Through Overlay
  - Or via tools from your MCP client (draw_overlay)
- Multi‑monitor demo:
  - Open two browser windows full‑screen on two physical monitors
  - Use viewport params, e.g. /?vx=0&vy=0&vw=1920&vh=1080 and /?vx=1920&vy=0&vw=1920&vh=1080

Endpoints
- /mcp: MCP HTTP transport
- /ws/overlays: WebSocket stream of overlay events
- /: Static overlay viewer (stub)
- /setup and /config: Convenience configuration endpoints

## MCP configuration example (HTTP transport)
```json
{
  "mcpServers": {
    "overlay_companion": {
      "url": "http://localhost:3000/mcp",
      "description": "Web‑first click‑through overlays with multi‑monitor via browser viewports",
      "tags": ["overlay", "click-through", "browser", "multi-monitor", "websocket"],
      "provider": "Overlay Companion",
      "provider_url": "https://github.com/RyansOpenSauceRice/overlay-companion-mcp"
    }
  }
}
```

Legacy stdio is available with --stdio, but HTTP is the default and recommended.

## System notes
- Viewer runs anywhere a browser runs; overlays are click‑through by design
- Server currently targets Linux; Fedora Silverblue Wayland is the reference environment
- AppImage builds are supported; in‑app update controls appear when running as AppImage (details moved to docs)

## Development
- Server: C#/.NET, ASP.NET Core
- Web client: static HTML/JS (no build step); replace with Guacamole integration in future
- Run server on port 3000; open the viewer at /

## Roadmap (short)
- Replace stub viewer with Guacamole RDP canvas
- Initial WS sync for late‑joining viewers
- Playwright E2E for overlay draw, click‑through, and multi‑window sync
- Infra modules (Podman/OpenTofu) and Web UI for user‑facing configuration

## License
GPL‑3.0
