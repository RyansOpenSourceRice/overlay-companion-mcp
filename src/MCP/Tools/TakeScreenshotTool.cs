using OverlayCompanion.Models;
using OverlayCompanion.Services;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// MCP tool for taking screenshots
/// Implements the take_screenshot tool from MCP_SPECIFICATION.md
/// </summary>
public class TakeScreenshotTool : IMcpTool
{
    private readonly IScreenCaptureService _screenCaptureService;
    private readonly IModeManager _modeManager;

    public string Name => "take_screenshot";
    public string Description => "Take a screenshot of the screen or a specific region";

    public TakeScreenshotTool(IScreenCaptureService screenCaptureService, IModeManager modeManager)
    {
        _screenCaptureService = screenCaptureService;
        _modeManager = modeManager;
    }

    public async Task<object> ExecuteAsync(Dictionary<string, object> parameters)
    {
        // Check if action is allowed in current mode
        if (!_modeManager.CanExecuteAction(Name))
        {
            throw new InvalidOperationException($"Action '{Name}' not allowed in {_modeManager.CurrentMode} mode");
        }

        // Parse parameters
        var fullScreen = parameters.GetValue("full_screen", true);
        var scale = parameters.GetValue("scale", 1.0);
        var waitForStableMs = parameters.GetValue("wait_for_stable_ms", 0);

        ScreenRegion? region = null;
        if (parameters.HasValue("region"))
        {
            var regionData = parameters.GetValue<Dictionary<string, object>>("region");
            if (regionData != null)
            {
                region = new ScreenRegion(
                    regionData.GetValue("x", 0),
                    regionData.GetValue("y", 0),
                    regionData.GetValue("width", 0),
                    regionData.GetValue("height", 0)
                );
            }
        }

        // Wait for stable screen if requested
        if (waitForStableMs > 0)
        {
            await Task.Delay(waitForStableMs);
        }

        // Capture screenshot
        var screenshot = await _screenCaptureService.CaptureScreenAsync(region, fullScreen);

        // Apply scaling if requested
        if (scale != 1.0)
        {
            // TODO: Implement image scaling
            // For now, just adjust the reported dimensions
            screenshot.Width = (int)(screenshot.Width * scale);
            screenshot.Height = (int)(screenshot.Height * scale);
        }

        // Return MCP-compliant response
        return new
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
            viewport_scroll = new { x = 0, y = 0 } // TODO: Implement viewport scroll detection
        };
    }
}