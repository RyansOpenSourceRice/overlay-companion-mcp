using OverlayCompanion.Models;
using OverlayCompanion.Services;
using System.ComponentModel;
using System.Text.Json;
using ModelContextProtocol.Server;
using System.Diagnostics.CodeAnalysis;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// MCP tool for drawing multiple overlays at once
/// Implements the batch_overlay tool from MCP_SPECIFICATION.md
/// </summary>
[McpServerToolType]
public static class BatchOverlayTool
{
    [McpServerTool, Description("Draw multiple overlays at once")]
    [RequiresUnreferencedCode("JSON serialization may require types that cannot be statically analyzed")]
    public static async Task<string> BatchOverlay(
        IOverlayService overlayService,
        IModeManager modeManager,
        [Description("JSON array of overlay definitions with x, y, width, height, color, opacity (0..1), label, temporary_ms, click_through, monitor_index")] string overlays,
        [Description("Draw overlays one at a time with delays")] bool oneAtATime = false)
    {
        // Check if action is allowed in current mode
        if (!modeManager.CanExecuteAction("batch_overlay"))
        {
            throw new InvalidOperationException($"Action 'batch_overlay' not allowed in {modeManager.CurrentMode} mode");
        }

        if (string.IsNullOrEmpty(overlays))
        {
            throw new ArgumentException("overlays parameter is required and must not be empty");
        }

        // Parse JSON array of overlay definitions
        JsonElement overlaysArray;
        try
        {
            overlaysArray = JsonSerializer.Deserialize<JsonElement>(overlays);
        }
        catch (JsonException ex)
        {
            throw new ArgumentException($"Invalid JSON in overlays parameter: {ex.Message}");
        }

        if (overlaysArray.ValueKind != JsonValueKind.Array)
        {
            throw new ArgumentException("overlays parameter must be a JSON array");
        }

        // Convert overlay data to OverlayElement objects
        var overlayElements = new List<OverlayElement>();

        foreach (var overlayData in overlaysArray.EnumerateArray())
        {
            if (overlayData.ValueKind == JsonValueKind.Object)
            {
                var x = overlayData.TryGetProperty("x", out var px) ? px.GetInt32() : 0;
                var y = overlayData.TryGetProperty("y", out var py) ? py.GetInt32() : 0;
                var width = overlayData.TryGetProperty("width", out var pw) ? pw.GetInt32() : 50;
                var height = overlayData.TryGetProperty("height", out var ph) ? ph.GetInt32() : 50;
                var color = overlayData.TryGetProperty("color", out var pc) ? (pc.GetString() ?? "#FFFF00") : "#FFFF00";
                var label = overlayData.TryGetProperty("label", out var pl) ? pl.GetString() : null;
                var tempMs = overlayData.TryGetProperty("temporary_ms", out var pt) ? pt.GetInt32() : 0;
                var clickThrough = overlayData.TryGetProperty("click_through", out var pct) ? pct.GetBoolean() : true;
                var opacity = overlayData.TryGetProperty("opacity", out var po) ? po.GetDouble() : 0.5;
                var monitorIndex = overlayData.TryGetProperty("monitor_index", out var pmi) ? pmi.GetInt32() : 0;

                var overlay = new OverlayElement
                {
                    Bounds = new ScreenRegion(x, y, width, height),
                    Color = color,
                    Label = label,
                    TemporaryMs = tempMs,
                    ClickThrough = clickThrough,
                    Opacity = Math.Clamp(opacity, 0.0, 1.0),
                    MonitorIndex = monitorIndex
                };

                overlayElements.Add(overlay);
            }
        }

        if (overlayElements.Count == 0)
        {
            throw new ArgumentException("No valid overlay definitions found in overlays parameter");
        }

        // Draw overlays
        var overlayIds = await overlayService.DrawBatchOverlaysAsync(overlayElements.ToArray(), oneAtATime);

        // Return JSON string response
        var response = new
        {
            overlay_ids = overlayIds,
            count = overlayElements.Count,
            one_at_a_time = oneAtATime
        };

        return JsonSerializer.Serialize(response);
    }
}
