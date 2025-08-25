# Task List

1. ✅ Extend WebSocket hub to send multi-monitor display info on connect
Modified OverlayWebSocketHub to inject IScreenCaptureService; sync payload now includes displays and virtual_screen; camelCase JSON serialization via JsonSerializerOptions
2. ✅ Update browser viewer to support multi-monitor virtual canvas (fit-to-window scaling) and render overlays correctly
index.html now has display-layer, computes virtual_screen scale and offset, renders monitor frames, adapts on resize
3. ✅ Backend-first: Add Podman Compose stack (caddy, mcp, guacd, guacamole, postgres)
Added infra/podman-compose.yml, infra/Dockerfile.mcp, infra/Caddyfile, infra/README.md
4. ✅ Viewer: Add optional Guacamole integration (guacamole-common-js embed + iframe fallback)
Initialize guacamole-common-js if present via /guac tunnel; fallback to iframe at /guac
5. ✅ Security: Overlay WS token hardening (short-lived HMAC token via env secret)
Added OverlayTokenService, optional validation on /ws/overlays; /overlay/token mint endpoint for dev
6. ✅ Docs: VM xrdp provisioning guide
infra/VM_SETUP.md with step-by-step Fedora setup
7. ✅ Push to PR branch chore/web-only-alignment-ws-and-docs
Pushed commits with infra + viewer + security + docs

