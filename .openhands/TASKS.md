# Task List

1. 🔄 Add WebSocket overlay broadcast in server (C#) and map /ws/overlays
OverlayWebSocketHub + OverlayEventBroadcaster; subscribe to OverlayService events.
2. 🔄 Serve static web client with overlay canvas and guaranteed click-through
Add web/index.html + overlay.js; pointer-events: none; viewport cropping via URL params.
3. ⏳ Add /api/test-overlay endpoint to trigger overlay broadcast
Use OverlayService to create a sample overlay; respects HEADLESS=1 to avoid GTK windows.
4. ⏳ Wire static files in csproj so they publish/run correctly
Include web/** as Content CopyToOutputDirectory=PreserveNewest.

