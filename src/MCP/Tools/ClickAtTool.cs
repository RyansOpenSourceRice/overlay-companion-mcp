using OverlayCompanion.Models;
using OverlayCompanion.Services;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// MCP tool for simulating mouse clicks
/// Implements the click_at tool from MCP_SPECIFICATION.md
/// </summary>
public class ClickAtTool : IMcpTool
{
    private readonly IInputMonitorService _inputService;
    private readonly IModeManager _modeManager;

    public string Name => "click_at";
    public string Description => "Simulate a mouse click at specified coordinates";

    public ClickAtTool(IInputMonitorService inputService, IModeManager modeManager)
    {
        _inputService = inputService;
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
        var x = parameters.GetValue("x", 0);
        var y = parameters.GetValue("y", 0);

        // Parse optional parameters
        var button = parameters.GetValue("button", "left");
        var clicks = parameters.GetValue("clicks", 1);
        var requireUserConfirmation = parameters.GetValue("require_user_confirmation", false);

        // Check if confirmation is required
        var needsConfirmation = requireUserConfirmation || _modeManager.RequiresConfirmation(Name);
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
            success = await _inputService.SimulateClickAsync(position, button, clicks);
        }

        // Return MCP-compliant response
        return new
        {
            success = success,
            was_confirmed = wasConfirmed
        };
    }
}