using OverlayCompanion.Models;
using OverlayCompanion.Services;
using System.ComponentModel;
using System.Text.Json;
using System.Diagnostics.CodeAnalysis;
using Microsoft.Extensions.Logging;
using ModelContextProtocol.Server;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// MCP tool for drawing overlays from a named template plus a small parameter set,
/// so the AI references (text="yada", color="red", x=43, y=32, size=23) instead of
/// re-emitting SVG/geometry on every call. Supports raw SVG and opaque object passthrough.
/// </summary>
[McpServerToolType]
public static class TemplateOverlayTool
{
    [McpServerTool, Description(
        "Draw an overlay from a named template with a small parameter set. " +
        "Template must be one of: text, button, region, rectangle, circle, highlight, arrow, svg, object. " +
        "Use GetOverlayCapabilities to list templates and their params. " +
        "Example: text with params text='yada', color='red', x=43, y=32, size=23. " +
        "Render-only overlay; never an input tool.")]
    [RequiresUnreferencedCode("JSON serialization may require types that cannot be statically analyzed")]
    public static async Task<string> TemplateOverlay(
        IOverlayService overlayService,
        IModeManager modeManager,
        IScreenCaptureService screenCaptureService,
        IKasmVNCService kasmvncService,
        IDisplayActorGate displayActor,
        ILogger<object> logger,
        [Description("Template name: text, button, region, rectangle, circle, highlight, arrow, svg, object")] string template,
        [Description("Template parameters as a JSON object, e.g. {\"text\":\"yada\",\"color\":\"red\",\"x\":43,\"y\":32,\"size\":23}")] string? templateParams = null,
        [Description("Raw SVG string (only for template=\"svg\")")] string? svg = null,
        [Description("Opaque object (JSON) to pass through (only for template=\"object\")")] string? objectData = null,
        [Description("Monitor index to draw overlay on (0 = primary)")] int monitorIndex = 0,
        [Description("Unique identifier for the overlay")] string? id = null,
        [Description("Display actor issuing this call: 'interior' (in-app assistant) or 'exterior' (external MCP agent). Must match the active display owner.")] string actor = "exterior")
    {
        // Check if action is allowed in current mode
        modeManager.EnsureAllowed("draw_overlay");

        // Display-ownership gate: reject if a different agent holds the canvas.
        var caller = actor.ToActor();
        if (!await displayActor.CanWriteAsync(caller))
        {
            var active = await displayActor.GetActiveActorAsync();
            throw new ModelContextProtocol.McpException(
                $"Display is owned by the '{active.ToKey()}' agent. Switch ownership (or use the other agent) before drawing overlays.");
        }

        if (string.IsNullOrWhiteSpace(template) || !OverlayTemplates.TryResolve(template, out var def))
        {
            throw new ArgumentException($"Unknown template '{template}'. Valid templates: {string.Join(", ", OverlayTemplates.Definitions.Select(d => d.Name))}");
        }

        var @params = ParseParams(templateParams);
        var monitor = await screenCaptureService.GetMonitorInfoAsync(monitorIndex) ?? throw new ArgumentException($"Monitor {monitorIndex} not found");

        // Resolve template fields (forgiving: defaults for anything missing).
        var x = ParamInt(@params, "x", 0) + monitor.X;
        var y = ParamInt(@params, "y", 0) + monitor.Y;
        var width = ParamInt(@params, "width", ParamInt(@params, "endX", 0) - ParamInt(@params, "startX", 0));
        var height = ParamInt(@params, "height", ParamInt(@params, "endY", 0) - ParamInt(@params, "startY", 0));
        var color = ParamString(@params, "color", def.Kind is OverlayTemplateKind.Highlight ? "#ffff00" : "#ff0000");
        double opacity = ParamDouble(@params, "opacity", def.Kind is OverlayTemplateKind.Highlight or OverlayTemplateKind.Arrow ? 0.8 : 0.5);
        var text = ParamString(@params, "text", null) ?? ParamString(@params, "label", null);

        // SVG / object passthrough.
        if (def.Kind == OverlayTemplateKind.Svg && string.IsNullOrWhiteSpace(svg))
        {
            svg = ParamString(@params, "svg", null);
        }
        if (string.IsNullOrWhiteSpace(svg)) svg = null;

        JsonElement? objectPayload = null;
        if (def.Kind == OverlayTemplateKind.Object)
        {
            objectPayload = NormalizeObject(objectData, @params);
        }

        // Resolve accessible name from text (or template name) for semantics/CI.
        var accessibleName = text ?? (def.IsTextLike ? def.Name : id);

        var overlay = new OverlayElement
        {
            Id = id ?? Guid.NewGuid().ToString(),
            Bounds = ResolveBounds(def.Kind, x, y, width, height, @params),
            Color = color,
            Label = text,
            TemporaryMs = opacity < 1.0 ? 5000 : 0,
            ClickThrough = true,
            Opacity = Math.Clamp(opacity, 0.0, 1.0),
            MonitorIndex = monitorIndex,
            Template = def.Name,
            TemplateKind = def.Kind,
            TemplateParams = @params,
            Svg = svg,
            AccessibleName = accessibleName,
            Actor = caller.ToKey()
        };

        var overlayId = await overlayService.DrawOverlayAsync(overlay);

        // Mirror to KasmVNC web display when available.
        bool kasmvncSynced = false;
        try
        {
            if (await kasmvncService.IsConnectedAsync() ||
                (await kasmvncService.ConnectAsync()))
            {
                var cmd = new OverlayCommand
                {
                    Type = "create",
                    Id = overlayId,
                    X = overlay.Bounds.X,
                    Y = overlay.Bounds.Y,
                    Width = overlay.Bounds.Width,
                    Height = overlay.Bounds.Height,
                    Color = overlay.Color,
                    Opacity = overlay.Opacity,
                    MonitorIndex = monitorIndex,
                    ClickThrough = true,
                    Template = def.Name,
                    TemplateParams = @params,
                    Svg = svg,
                    AccessibleName = accessibleName,
                    ObjectData = objectPayload,
                    Actor = caller.ToKey()
                };
                await kasmvncService.SendOverlayCommandAsync(cmd);
                kasmvncSynced = true;
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "KasmVNC sync skipped for template overlay {OverlayId}", overlayId);
        }

        var response = new
        {
            success = true,
            overlay_id = overlayId,
            template = def.Name,
            bounds = new { x = overlay.Bounds.X, y = overlay.Bounds.Y, width = overlay.Bounds.Width, height = overlay.Bounds.Height },
            color,
            opacity,
            text,
            accessible_name = accessibleName,
            monitor_index = monitorIndex,
            monitor_name = monitor.Name,
            kasmvnc_synced = kasmvncSynced
        };

        return JsonSerializer.Serialize(response);
    }

    private static Dictionary<string, JsonElement> ParseParams(string? templateParams)
    {
        var result = new Dictionary<string, JsonElement>();
        if (string.IsNullOrWhiteSpace(templateParams)) return result;
        try
        {
            using var doc = JsonDocument.Parse(templateParams);
            if (doc.RootElement.ValueKind == JsonValueKind.Object)
            {
                foreach (var prop in doc.RootElement.EnumerateObject())
                {
                    result[prop.Name.ToLowerInvariant()] = prop.Value.Clone();
                }
            }
        }
        catch (JsonException) { }
        return result;
    }

    private static int ParamInt(Dictionary<string, JsonElement> p, string key, int fallback)
        => p.TryGetValue(key, out var e) && e.ValueKind is JsonValueKind.Number && e.TryGetInt32(out var v) ? v : fallback;

    private static double ParamDouble(Dictionary<string, JsonElement> p, string key, double fallback)
        => p.TryGetValue(key, out var e) && e.ValueKind is JsonValueKind.Number && e.TryGetDouble(out var v) ? v : fallback;

    private static string? ParamString(Dictionary<string, JsonElement> p, string key, string? fallback)
        => p.TryGetValue(key, out var e) && e.ValueKind == JsonValueKind.String ? e.GetString() : fallback;

    private static ScreenRegion ResolveBounds(OverlayTemplateKind kind, int x, int y, int width, int height, Dictionary<string, JsonElement> p)
    {
        switch (kind)
        {
            case OverlayTemplateKind.Circle:
                var r = Math.Max(0, ParamInt(p, "radius", 50));
                return new ScreenRegion(x - r, y - r, r * 2, r * 2);
            case OverlayTemplateKind.Arrow:
                var sx = ParamInt(p, "startX", 0);
                var sy = ParamInt(p, "startY", 0);
                var ex = ParamInt(p, "endX", sx + 100);
                var ey = ParamInt(p, "endY", sy + 100);
                var aw = Math.Abs(ex - sx);
                var ah = Math.Abs(ey - sy);
                return new ScreenRegion(Math.Min(sx, ex), Math.Min(sy, ey), aw == 0 ? 100 : aw, ah == 0 ? 100 : ah);
            case OverlayTemplateKind.Text:
            case OverlayTemplateKind.Button:
            case OverlayTemplateKind.Region:
                var w = width > 0 ? width : (textGuessWidth(p) > 0 ? textGuessWidth(p) : 120);
                var h = height > 0 ? height : ParamInt(p, "height", ParamInt(p, "size", 14) + 16);
                return new ScreenRegion(x, y, w, h);
            default:
                return new ScreenRegion(x, y, width > 0 ? width : 50, height > 0 ? height : 50);
        }
    }

    private static int textGuessWidth(Dictionary<string, JsonElement> p)
    {
        var text = ParamString(p, "text", null);
        var size = ParamInt(p, "size", 14);
        return text is null ? 120 : Math.Max(40, text.Length * (int)(size * 0.6));
    }

    private static JsonElement? NormalizeObject(string? objectData, Dictionary<string, JsonElement> p)
    {
        if (!string.IsNullOrWhiteSpace(objectData))
        {
            try
            {
                using var doc = JsonDocument.Parse(objectData);
                return doc.RootElement.Clone();
            }
            catch (JsonException) { }
        }
        return p.TryGetValue("object", out var e) ? e.Clone() : null;
    }
}
