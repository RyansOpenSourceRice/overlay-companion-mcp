using OverlayCompanion.Models;
using OverlayCompanion.Services;
using System.ComponentModel;
using ModelContextProtocol.Server;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// MCP tool for drawing overlays
/// Implements the draw_overlay tool from MCP_SPECIFICATION.md
/// </summary>
[McpServerToolType]
public static class DrawOverlayTool
{
    [McpServerTool, Description("Draw an overlay box on the screen")]
    public static async Task<string> DrawOverlay(
        IOverlayService overlayService,
        IModeManager modeManager,
        [Description("X coordinate of the overlay")] int x,
        [Description("Y coordinate of the overlay")] int y,
        [Description("Width of the overlay")] int width,
        [Description("Height of the overlay")] int height,
        [Description("Color of the overlay (hex format, e.g., #FF0000)")] string color = "#FF0000",
        [Description("Opacity of the overlay (0.0 to 1.0)")] double opacity = 0.5,
        [Description("Unique identifier for the overlay")] string? id = null)
    {
        // Check if action is allowed in current mode
        if (!modeManager.CanExecuteAction("draw_overlay"))
        {
            throw new InvalidOperationException($"Action 'draw_overlay' not allowed in {modeManager.CurrentMode} mode");
        }

        // Create screen region
        var bounds = new ScreenRegion(x, y, width, height);

        // Generate overlay ID if not provided
        var overlayId = id ?? Guid.NewGuid().ToString();

        // Draw overlay (convert opacity to temporary duration for now)
        var temporaryMs = opacity < 1.0 ? 5000 : 0; // Temporary overlay if not fully opaque
        var actualOverlayId = await overlayService.DrawOverlayAsync(bounds, color, overlayId, temporaryMs);

        // Return JSON string response
        var response = new
        {
            overlay_id = actualOverlayId,
            bounds = new
            {
                x = bounds.X,
                y = bounds.Y,
                width = bounds.Width,
                height = bounds.Height
            },
            color = color,
            opacity = opacity,
            monitor_index = 0 // TODO: Implement proper monitor detection
        };

        return System.Text.Json.JsonSerializer.Serialize(response);
    }
}