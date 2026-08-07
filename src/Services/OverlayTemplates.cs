using System.Text.Json;
using System.Text.Json.Serialization;

namespace OverlayCompanion.Services;

/// <summary>
/// Canonical registry of overlay templates and the parameter schema each exposes.
/// The AI names a template plus a small parameter set (text="yada", color="red",
/// x=43, y=32, size=23) instead of re-emitting geometry/SVG on every call.
/// </summary>
public static class OverlayTemplates
{
    public static readonly TemplateDef[] Definitions =
    {
        new("text",
            OverlayCompanion.Models.OverlayTemplateKind.Text,
            "Single- or multi-line text/annotation with optional background box. " +
            "Supports centered-in-box layout via width/align/valign.",
            "text (string), x (int), y (int), size (int), color (string), " +
            "align ('left'|'center'|'right'), valign ('top'|'middle'|'bottom'), " +
            "background (bool), bg_color (string), width (int), bold (bool)"),
        new("button",
            OverlayCompanion.Models.OverlayTemplateKind.Button,
            "A drawn button hint with centered text (rendering only - never an input tool).",
            "text (string), x (int), y (int), width (int), height (int), " +
            "size (int), color (string), bg_color (string)"),
        new("region",
            OverlayCompanion.Models.OverlayTemplateKind.Region,
            "A titled boundary box naming a screen area.",
            "text (string), x (int), y (int), width (int), height (int), " +
            "color (string)"),
        new("rectangle",
            OverlayCompanion.Models.OverlayTemplateKind.Rectangle,
            "A rectangle outline/fill.",
            "x (int), y (int), width (int), height (int), color (string), opacity (0..1), text (string optional)"),
        new("circle",
            OverlayCompanion.Models.OverlayTemplateKind.Circle,
            "A circle at x,y with radius.",
            "x (int), y (int), radius (int), color (string), opacity (0..1), text (string optional)"),
        new("highlight",
            OverlayCompanion.Models.OverlayTemplateKind.Highlight,
            "A pulsing highlight region.",
            "x (int), y (int), width (int), height (int), color (string), opacity (0..1), text (string optional)"),
        new("arrow",
            OverlayCompanion.Models.OverlayTemplateKind.Arrow,
            "An arrow from startX,startY to endX,endY.",
            "startX (int), startY (int), endX (int), endY (int), color (string), text (string optional)"),
        new("svg",
            OverlayCompanion.Models.OverlayTemplateKind.Svg,
            "Raw SVG string passthrough rendered by the web layer.",
            "svg (string), x (int), y (int), width (int optional), height (int optional)"),
        new("object",
            OverlayCompanion.Models.OverlayTemplateKind.Object,
            "Opaque object passthrough consumed by a host renderer hook.",
            "object (object), x (int), y (int)"),
    };

    private static readonly Dictionary<string, TemplateDef> ByName =
        Definitions.ToDictionary(d => d.Name, d => d);

    public static bool TryResolve(string name, out TemplateDef def) => ByName.TryGetValue(name.ToLowerInvariant(), out def!);

    public static string JsonCatalog()
    {
        var defs = Definitions.Select(d => new
        {
            name = d.Name,
            kind = d.Kind.ToString().ToLowerInvariant(),
            description = d.Description,
            params_ = d.Parameters
        });
        return JsonSerializer.Serialize(defs, Options);
    }

    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = false
    };
}

public class TemplateDef
{
    public TemplateDef(string name, OverlayCompanion.Models.OverlayTemplateKind kind, string description, string parameters)
    {
        Name = name;
        Kind = kind;
        Description = description;
        Parameters = parameters;
    }

    public string Name { get; }
    public OverlayCompanion.Models.OverlayTemplateKind Kind { get; }
    public string Description { get; }
    public string Parameters { get; }

    [JsonIgnore]
    public bool IsTextLike => Kind is OverlayCompanion.Models.OverlayTemplateKind.Text
        or OverlayCompanion.Models.OverlayTemplateKind.Button
        or OverlayCompanion.Models.OverlayTemplateKind.Region;
}
