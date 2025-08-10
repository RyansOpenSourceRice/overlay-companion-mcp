using OverlayCompanion.Models;
using OverlayCompanion.Services;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// MCP tool for drawing overlays
/// Implements the draw_overlay tool from MCP_SPECIFICATION.md
/// </summary>
public class DrawOverlayTool : IMcpTool
{
    private readonly IOverlayService _overlayService;
    private readonly IModeManager _modeManager;

    public string Name => "draw_overlay";
    public string Description => "Draw an overlay box on the screen";

    public DrawOverlayTool(IOverlayService overlayService, IModeManager modeManager)
    {
        _overlayService = overlayService;
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
        var width = parameters.GetValue("width", 50);
        var height = parameters.GetValue("height", 50);

        // Parse optional parameters
        var color = parameters.GetValue("color", "Yellow");
        var label = parameters.GetValue<string?>("label", null);
        var temporaryMs = parameters.GetValue("temporary_ms", 0);

        // Create screen region
        var bounds = new ScreenRegion(x, y, width, height);

        // Draw overlay
        var overlayId = await _overlayService.DrawOverlayAsync(bounds, color, label, temporaryMs);

        // Determine monitor index (simplified for now)
        var monitorIndex = 0; // TODO: Implement proper monitor detection

        // Return MCP-compliant response
        return new
        {
            overlay_id = overlayId,
            bounds = new
            {
                x = bounds.X,
                y = bounds.Y,
                width = bounds.Width,
                height = bounds.Height
            },
            monitor_index = monitorIndex
        };
    }
}