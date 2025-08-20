using ModelContextProtocol.Server;
using OverlayCompanion.Models;
using OverlayCompanion.Services;
using System.ComponentModel;
using System.Diagnostics.CodeAnalysis;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// Tool for repositioning overlay elements relative to screen elements
/// </summary>
[McpServerToolType]
public static class ReAnchorElementTool
{
    [McpServerTool]
    [Description("Reposition an overlay element relative to a screen element or coordinate")]
    [RequiresUnreferencedCode("JSON serialization may require types that cannot be statically analyzed")]
    public static async Task<string> ReAnchorElement(
        IOverlayService overlayService,
        IModeManager modeManager,
        IScreenCaptureService screenCaptureService,
        [Description("ID of the overlay element to reposition")] string overlay_id,
        [Description("New X coordinate or offset")] int x,
        [Description("New Y coordinate or offset")] int y,
        [Description("Anchor mode: 'absolute' for screen coordinates, 'relative' for offset from current position")] string anchor_mode = "absolute",
        [Description("Monitor index to anchor to (0 = primary)")] int monitor_index = 0)
    {
        // Check if action is allowed in current mode
        if (!modeManager.CanExecuteAction("re_anchor_element"))
        {
            throw new InvalidOperationException($"Action 're_anchor_element' not allowed in {modeManager.CurrentMode} mode");
        }

        // Validate monitor index
        var monitor = await screenCaptureService.GetMonitorInfoAsync(monitor_index);
        if (monitor == null)
        {
            throw new ArgumentException($"Monitor {monitor_index} not found");
        }

        // Get current overlay information
        var overlays = await overlayService.GetActiveOverlaysAsync();
        var targetOverlay = overlays.FirstOrDefault(o => o.Id == overlay_id);
        
        if (targetOverlay == null)
        {
            throw new ArgumentException($"Overlay with ID '{overlay_id}' not found");
        }

        // Calculate new position based on anchor mode
        int newX, newY;
        
        switch (anchor_mode.ToLowerInvariant())
        {
            case "absolute":
                // Absolute coordinates relative to the specified monitor
                newX = monitor.X + x;
                newY = monitor.Y + y;
                break;
                
            case "relative":
                // Relative offset from current position
                newX = targetOverlay.Bounds.X + x;
                newY = targetOverlay.Bounds.Y + y;
                break;
                
            default:
                throw new ArgumentException($"Invalid anchor_mode '{anchor_mode}'. Must be 'absolute' or 'relative'");
        }

        // Ensure the new position is within the target monitor bounds
        newX = Math.Max(monitor.X, Math.Min(newX, monitor.X + monitor.Width - targetOverlay.Bounds.Width));
        newY = Math.Max(monitor.Y, Math.Min(newY, monitor.Y + monitor.Height - targetOverlay.Bounds.Height));

        // Create new bounds with updated position
        var newBounds = new ScreenRegion(newX, newY, targetOverlay.Bounds.Width, targetOverlay.Bounds.Height);

        // Update the overlay position
        var success = await overlayService.UpdateOverlayPositionAsync(overlay_id, newBounds);
        
        if (!success)
        {
            throw new InvalidOperationException($"Failed to reposition overlay '{overlay_id}'");
        }

        // Return response with updated position information
        var response = new
        {
            overlay_id = overlay_id,
            anchor_mode = anchor_mode,
            old_position = new
            {
                x = targetOverlay.Bounds.X,
                y = targetOverlay.Bounds.Y
            },
            new_position = new
            {
                x = newX,
                y = newY
            },
            bounds = new
            {
                x = newX,
                y = newY,
                width = targetOverlay.Bounds.Width,
                height = targetOverlay.Bounds.Height
            },
            monitor_index = monitor_index,
            monitor_name = monitor.Name,
            monitor_bounds = new
            {
                x = monitor.X,
                y = monitor.Y,
                width = monitor.Width,
                height = monitor.Height
            },
            clamped = newX != (anchor_mode == "absolute" ? monitor.X + x : targetOverlay.Bounds.X + x) ||
                     newY != (anchor_mode == "absolute" ? monitor.Y + y : targetOverlay.Bounds.Y + y)
        };

        return System.Text.Json.JsonSerializer.Serialize(response);
    }
}