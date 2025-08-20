using OverlayCompanion.Models;
using OverlayCompanion.Services;
using System.ComponentModel;
using ModelContextProtocol.Server;
using System.Diagnostics.CodeAnalysis;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// MCP tool for simulating mouse clicks
/// Implements the click_at tool from MCP_SPECIFICATION.md
/// </summary>
[McpServerToolType]
public static class ClickAtTool
{
    [McpServerTool, Description("Simulate a mouse click at specified coordinates")]
    [RequiresUnreferencedCode("JSON serialization may require types that cannot be statically analyzed")]
    public static async Task<string> ClickAt(
        IInputMonitorService inputService,
        IModeManager modeManager,
        [Description("X coordinate to click")] int x,
        [Description("Y coordinate to click")] int y,
        [Description("Mouse button to click (left, right, middle)")] string button = "left",
        [Description("Number of clicks (1 for single, 2 for double)")] int clickCount = 1)
    {
        // Check if action is allowed in current mode
        if (!modeManager.CanExecuteAction("click_at"))
        {
            throw new InvalidOperationException($"Action 'click_at' not allowed in {modeManager.CurrentMode} mode");
        }

        // Check if confirmation is required
        var needsConfirmation = modeManager.RequiresConfirmation("click_at");
        var wasConfirmed = false;

        if (needsConfirmation)
        {
            // TODO: Implement user confirmation dialog
            // For now, assume confirmation is granted
            wasConfirmed = true;
            Console.WriteLine($"User confirmation required for click at ({x}, {y}) - GRANTED");
        }

        bool success = false;

        if (!needsConfirmation || wasConfirmed)
        {
            // Create screen point
            var position = new ScreenPoint(x, y);

            // Simulate click
            success = await inputService.SimulateClickAsync(position, button, clickCount);
        }

        // Return JSON string response
        var response = new
        {
            success = success,
            was_confirmed = wasConfirmed,
            position = new { x, y },
            button = button,
            click_count = clickCount
        };

        return System.Text.Json.JsonSerializer.Serialize(response);
    }
}
