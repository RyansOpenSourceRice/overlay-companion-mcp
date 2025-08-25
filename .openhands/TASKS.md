# Task List

1. ✅ Extend WebSocket hub to send multi-monitor display info on connect
Modified OverlayWebSocketHub to inject IScreenCaptureService; sync payload now includes displays and virtual_screen; camelCase JSON serialization via JsonSerializerOptions
2. ✅ Update browser viewer to support multi-monitor virtual canvas (fit-to-window scaling) and render overlays correctly
index.html now has display-layer, computes virtual_screen scale and offset, renders monitor frames, adapts on resize
3. ✅ Backend-first: Add Podman Compose stack (caddy, mcp, guacd, guacamole, postgres)
Added infra/podman-compose.yml, infra/Dockerfile.mcp, infra/Caddyfile, infra/README.md
4. ✅ Viewer: Add optional Guacamole integration (iframe + optional guacamole-common-js embed)
Inserted a /guac iframe placeholder; overlay layers remain above; resize handler adjusts it
5. ⏳ Run server on port 12001 with --http and verify viewer opens
Earlier attempts collided with stdio; run clean on a free port and explore
6. ✅ Push to PR branch chore/web-only-alignment-ws-and-docs
Pushed 3 commits to PR #34 branch

