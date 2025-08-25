# Task List

1. ✅ Extend WebSocket hub to send multi-monitor display info on connect
Modified OverlayWebSocketHub to inject IScreenCaptureService; sync payload now includes displays and virtual_screen; camelCase JSON serialization via JsonSerializerOptions
2. ✅ Update browser viewer to support multi-monitor virtual canvas (fit-to-window scaling) and render overlays correctly
index.html now has display-layer, computes virtual_screen scale and offset, renders monitor frames, adapts on resize
3. ⏳ Explore in browser: launch server and open viewer to verify flows (no Playwright)

4. ⏳ Commit changes and update PR (no push without confirmation)


