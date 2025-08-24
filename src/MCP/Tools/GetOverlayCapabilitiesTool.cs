using System.ComponentModel;
using ModelContextProtocol.Server;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// Reports overlay capabilities so MCP clients (AIs) can introspect supported features
/// </summary>
[McpServerToolType]
public static class GetOverlayCapabilitiesTool
{
    [McpServerTool, Description("Get overlay engine capabilities: opacity, color formats, click-through, compositor")]
    public static string GetOverlayCapabilities()
    {
        var compositor = Environment.GetEnvironmentVariable("WAYLAND_DISPLAY") != null ? "wayland" : "unknown";

        var payload = new
        {
            compositor,
            supports_click_through = true,
            supports_opacity = true,
            opacity_range = new { min = 0.0, max = 1.0, default_value = 0.5 },
            color_formats = new[] { "#RRGGBB", "#RRGGBBAA", "#RGB", "0xRRGGBB", "named (fallback)" },
            layering = new { uses_layer_shell = OverlayCompanion.UI.LayerShellInterop.IsAvailable, notes = "overlay layer with anchors and keyboard=NONE when available; fallback to fullscreen toplevel" }
        };

        return System.Text.Json.JsonSerializer.Serialize(payload);
    }
}
