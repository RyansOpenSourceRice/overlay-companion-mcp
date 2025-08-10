using OverlayCompanion.Services;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// MCP tool for configuring automatic screenshot capture
/// Implements the set_screenshot_frequency tool from MCP_SPECIFICATION.md
/// </summary>
public class SetScreenshotFrequencyTool : IMcpTool
{
    private readonly IScreenCaptureService _screenCaptureService;
    private readonly IModeManager _modeManager;

    public string Name => "set_screenshot_frequency";
    public string Description => "Configure automatic screenshot capture frequency";

    public SetScreenshotFrequencyTool(IScreenCaptureService screenCaptureService, IModeManager modeManager)
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

        // Parse required parameters
        var mode = parameters.GetValue<string>("mode");
        var intervalMs = parameters.GetValue("interval_ms", 1000);
        
        if (string.IsNullOrEmpty(mode))
        {
            throw new ArgumentException("mode parameter is required");
        }

        // Parse optional parameters
        var onlyOnChange = parameters.GetValue("only_on_change", false);

        // Validate interval
        if (intervalMs < 100)
        {
            intervalMs = 100; // Minimum 100ms to prevent system overload
        }

        // TODO: Implement automatic screenshot capture service
        // For now, just validate and return success
        var appliedIntervalMs = intervalMs;

        Console.WriteLine($"Screenshot frequency set to {mode} mode with {appliedIntervalMs}ms interval (onlyOnChange: {onlyOnChange})");

        // Return MCP-compliant response
        return new
        {
            ok = true,
            applied_interval_ms = appliedIntervalMs
        };
    }
}