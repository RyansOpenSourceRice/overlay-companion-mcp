using OverlayCompanion.Models;
using OverlayCompanion.Services;
using System.ComponentModel;
using ModelContextProtocol.Server;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// MCP tool for taking screenshots
/// Implements the take_screenshot tool from MCP_SPECIFICATION.md
/// </summary>
[McpServerToolType]
public static class TakeScreenshotTool
{
    [McpServerTool, Description("Take a screenshot of the screen or a specific region")]
    public static async Task<string> TakeScreenshot(
        IScreenCaptureService screenCaptureService,
        IModeManager modeManager,
        [Description("X coordinate of the region to capture (optional)")] int? x = null,
        [Description("Y coordinate of the region to capture (optional)")] int? y = null,
        [Description("Width of the region to capture (optional)")] int? width = null,
        [Description("Height of the region to capture (optional)")] int? height = null)
    {
        // Check if action is allowed in current mode
        if (!modeManager.CanExecuteAction("take_screenshot"))
        {
            throw new InvalidOperationException($"Action 'take_screenshot' not allowed in {modeManager.CurrentMode} mode");
        }

        // Create region if coordinates provided
        ScreenRegion? region = null;
        if (x.HasValue && y.HasValue && width.HasValue && height.HasValue)
        {
            region = new ScreenRegion(x.Value, y.Value, width.Value, height.Value);
        }

        // Capture screenshot
        var screenshot = await screenCaptureService.CaptureScreenAsync(region, region == null);

        // Return JSON string response
        var response = new
        {
            image_base64 = screenshot.ToBase64(),
            width = screenshot.Width,
            height = screenshot.Height,
            region = region != null ? new
            {
                x = region.X,
                y = region.Y,
                width = region.Width,
                height = region.Height
            } : null,
            monitor_index = screenshot.MonitorIndex,
            display_scale = screenshot.DisplayScale,
            viewport_scroll = new { x = 0, y = 0 }
        };

        return System.Text.Json.JsonSerializer.Serialize(response);
    }
}