# Task List

1. ✅ Update README to be HTTP-first, deprecate STDIO, set endpoint to '/' and adjust limitations

2. ✅ Update SPECIFICATION.md privacy/networking and roadmap bullets away from Avalonia; keep STDIO as legacy

3. ✅ Update MCP_SPECIFICATION.md to HTTP root endpoint '/', tags, and security model note

4. 🔄 Minor code alignment: update Program.cs configuration JSON, setup UI, and log message to reflect '/' and dynamic port; add /mcp alias, web root static page, WS overlays
Program.cs changed: MapMcp("/" and "/mcp"), GetMcpConfiguration url now root, setup HTML reflects Post '/', logs show dynamic port, UseWebSockets added; added OverlayWebSocketHub and wwwroot/index.html; created WS endpoint and static root handler.
5. ⏳ Optional: Update ROADMAP and SDK_INTEGRATION_SUMMARY to reflect HTTP-first and legacy STDIO


