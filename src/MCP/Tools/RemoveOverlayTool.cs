using OverlayCompanion.Services;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// MCP tool for removing overlays
/// Implements the remove_overlay tool from MCP_SPECIFICATION.md
/// </summary>
public class RemoveOverlayTool : IMcpTool
{
    private readonly IOverlayService _overlayService;
    private readonly IModeManager _modeManager;

    public string Name => "remove_overlay";
    public string Description => "Remove a specific overlay by ID";

    public RemoveOverlayTool(IOverlayService overlayService, IModeManager modeManager)
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
        var overlayId = parameters.GetValue<string>("overlay_id");
        
        if (string.IsNullOrEmpty(overlayId))
        {
            throw new ArgumentException("overlay_id parameter is required");
        }

        // Remove overlay
        var removed = await _overlayService.RemoveOverlayAsync(overlayId);

        // Return MCP-compliant response
        return new
        {
            removed = removed,
            not_found = !removed
        };
    }
}