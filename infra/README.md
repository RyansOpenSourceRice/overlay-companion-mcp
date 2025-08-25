Infra plan (single-user first, production-ready later)

Overview
This project targets a web-first overlay viewer with an MCP backend and a remote desktop powered by Apache Guacamole.
We prioritize backend/infrastructure so the front-end can remain thin.

Components
- MCP server: .NET app in this repo, HTTP at / and WebSocket /ws/overlays
- Guacamole: guacd gateway + Guacamole web app (Tomcat), Postgres DB
- Reverse proxy: Caddy (TLS, routing)
- VM host: Fedora Silverblue/Workstation VM with xrdp (RDP) on libvirt/KVM

Single-user dev path (fast)
1) Run MCP locally: `dotnet run -c Release --project src/OverlayCompanion.csproj -- --http`
2) Defer Guacamole initially; use the built-in viewer to validate overlays
3) When ready, run Guacamole stack via Podman (rootless) or podman-compose

Podman containers (core)
- caddy: routes / -> web, /mcp -> MCP, /guac -> Guacamole
- web: static viewer from this repo (or a vite app if introduced)
- mcp: published .NET image of this repo
- guacd: Apache Guacamole gateway
- guacamole: Guacamole web app (bundled Tomcat)
- postgres: DB for Guacamole

Recommended order
1) Postgres
2) guacd
3) guacamole (configure to point to Postgres)
4) MCP
5) Caddy (terminates TLS, routes to others)

VM guidance (backend first)
- Host: libvirt/KVM; create Fedora VM with 2 vCPU, 4–8 GB RAM, 40 GB disk
- Install xrdp in the VM and prefer Xorg session for stability with FreeRDP
- Set desktop resolution to match multi-monitor combined size (e.g., 3840x1080)
- Guacamole will RDP to the VM; the web overlay sits above the Guacamole canvas

Guacamole JS client
- Use guacamole-common-js in the viewer to embed the canvas
- Keep an absolutely-positioned overlay layer above it with pointer-events: none
- The viewer announces viewport info to MCP; MCP broadcasts overlays in desktop coords

Security notes
- Short-lived JWT for overlay WS sessions
- CORS/CSP locked down at Caddy in production
- OIDC for Guacamole optional

Next steps
- Add podman-compose.yml for guacd, guacamole, postgres, caddy, mcp, web
- Add minimal caddy Caddyfile with routes and headers
- Add a bootstrap endpoint to mint short-lived overlay tokens
