using Microsoft.Extensions.Logging;
using ModelContextProtocol.Server;
using OverlayCompanion.Models;
using OverlayCompanion.Services;
using System.ComponentModel;
using System.Diagnostics.CodeAnalysis;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// MCP tool for creating overlays with KasmVNC integration
/// Implements the create_overlay tool with multi-monitor support
/// </summary>
[McpServerToolType]
public static class CreateOverlayTool
{
    [McpServerTool, Description("Create a visual overlay on the screen with KasmVNC integration for multi-monitor support")]
    [RequiresUnreferencedCode("JSON serialization may require types that cannot be statically analyzed")]
    public static async Task<object> CreateOverlay(
        IOverlayService overlayService,
        IKasmVNCService kasmvncService,
        ILogger<object> logger,
        [Description("X coordinate of the overlay")] int x,
        [Description("Y coordinate of the overlay")] int y,
        [Description("Width of the overlay")] int width,
        [Description("Height of the overlay")] int height,
        [Description("Color of the overlay (hex format, e.g., #FF0000)")] string color = "#ff0000",
        [Description("Opacity of the overlay (0.0 to 1.0)")] double opacity = 0.5,
        [Description("Optional label text for the overlay")] string? label = null,
        [Description("Whether the overlay should be click-through")] bool clickThrough = true,
        [Description("Monitor index to display overlay on (0 = primary)")] int monitorIndex = 0,
        [Description("Auto-remove overlay after this many milliseconds (optional)")] int? temporaryMs = null)
    {
        try
        {
            logger.LogInformation("Creating overlay at ({X}, {Y}) with size {Width}x{Height}", 
                x, y, width, height);

            // Get available displays for validation and response
            var displays = await kasmvncService.GetDisplaysAsync();

            // Validate monitor index
            if (monitorIndex >= displays.Length)
            {
                logger.LogWarning("Invalid monitor index {Index}, using primary display", monitorIndex);
                monitorIndex = 0;
            }

            // Create overlay locally
            var overlay = new OverlayElement
            {
                Bounds = new ScreenRegion(x, y, width, height),
                Color = color,
                Opacity = opacity,
                Label = label,
                ClickThrough = clickThrough,
                MonitorIndex = monitorIndex,
                TemporaryMs = temporaryMs ?? 0
            };

            var overlayId = await overlayService.DrawOverlayAsync(overlay);
            logger.LogDebug("Created local overlay with ID: {OverlayId}", overlayId);

            // Send to KasmVNC for web display synchronization
            var kasmvncConnected = await kasmvncService.IsConnectedAsync();
            if (!kasmvncConnected)
            {
                logger.LogInformation("KasmVNC not connected, attempting to connect...");
                kasmvncConnected = await kasmvncService.ConnectAsync();
            }

            if (kasmvncConnected)
            {
                var overlayCommand = new OverlayCommand
                {
                    Type = "create",
                    Id = overlayId,
                    X = x,
                    Y = y,
                    Width = width,
                    Height = height,
                    Color = color,
                    Opacity = opacity,
                    MonitorIndex = monitorIndex,
                    ClickThrough = clickThrough
                };

                await kasmvncService.SendOverlayCommandAsync(overlayCommand);
                logger.LogDebug("Sent overlay command to KasmVNC for overlay {OverlayId}", overlayId);
            }
            else
            {
                logger.LogWarning("Could not connect to KasmVNC - overlay created locally only");
            }

            return new
            {
                overlayId = overlayId,
                success = true,
                kasmvncSync = kasmvncConnected,
                availableDisplays = displays
            };
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error creating overlay");
            return new
            {
                success = false,
                error = ex.Message,
                availableDisplays = await kasmvncService.GetDisplaysAsync()
            };
        }
    }
}