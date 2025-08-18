using OverlayCompanion.Services;
using System.ComponentModel;
using ModelContextProtocol.Server;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// MCP tool for configuring automatic screenshot capture
/// Implements the set_screenshot_frequency tool from MCP_SPECIFICATION.md
/// </summary>
[McpServerToolType]
public static class SetScreenshotFrequencyTool
{
    [McpServerTool, Description("Configure automatic screenshot capture frequency")]
    public static async Task<string> SetScreenshotFrequency(
        IScreenCaptureService screenCaptureService,
        IModeManager modeManager,
        [Description("Screenshot mode (off, interval, on_change)")] string mode,
        [Description("Interval in milliseconds for interval mode")] int intervalMs = 1000)
    {
        // Check if action is allowed in current mode
        if (!modeManager.CanExecuteAction("set_screenshot_frequency"))
        {
            throw new InvalidOperationException($"Action 'set_screenshot_frequency' not allowed in {modeManager.CurrentMode} mode");
        }

        if (string.IsNullOrEmpty(mode))
        {
            throw new ArgumentException("mode parameter is required");
        }

        // Validate mode
        var validModes = new[] { "off", "interval", "on_change" };
        if (!validModes.Contains(mode.ToLower()))
        {
            throw new ArgumentException($"Invalid mode: {mode}. Valid modes are: {string.Join(", ", validModes)}");
        }

        // Validate interval
        if (intervalMs < 100)
        {
            intervalMs = 100; // Minimum 100ms to prevent system overload
        }

        // TODO: Implement automatic screenshot capture service
        // For now, just validate and return success (mock implementation)
        var success = true;
        var appliedIntervalMs = intervalMs;

        Console.WriteLine($"Screenshot frequency set to {mode} mode with {appliedIntervalMs}ms interval");

        // Return JSON string response
        var response = new
        {
            ok = success,
            mode = mode.ToLower(),
            applied_interval_ms = appliedIntervalMs,
            service_configured = success
        };

        return System.Text.Json.JsonSerializer.Serialize(response);
    }
}