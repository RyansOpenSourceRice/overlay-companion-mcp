using OverlayCompanion.Services;
using System.ComponentModel;
using ModelContextProtocol.Server;
using System.Diagnostics.CodeAnalysis;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// MCP tool for removing overlays
/// Implements the remove_overlay tool from MCP_SPECIFICATION.md
/// </summary>
[McpServerToolType]
public static class RemoveOverlayTool
{
    [McpServerTool, Description("Remove a specific overlay by ID")]
    [RequiresUnreferencedCode("JSON serialization may require types that cannot be statically analyzed")]
    public static async Task<string> RemoveOverlay(
        IOverlayService overlayService,
        IModeManager modeManager,
        [Description("ID of the overlay to remove")] string overlayId)
    {
        // Check if action is allowed in current mode
        if (!modeManager.CanExecuteAction("remove_overlay"))
        {
            throw new InvalidOperationException($"Action 'remove_overlay' not allowed in {modeManager.CurrentMode} mode");
        }

        if (string.IsNullOrEmpty(overlayId))
        {
            throw new ArgumentException("overlay_id parameter is required");
        }

        // Remove overlay
        var removed = await overlayService.RemoveOverlayAsync(overlayId);

        // Return JSON string response
        var response = new
        {
            removed = removed,
            not_found = !removed,
            overlay_id = overlayId
        };

        return System.Text.Json.JsonSerializer.Serialize(response);
    }
}
