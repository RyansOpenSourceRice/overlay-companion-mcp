using OverlayCompanion.Services;
using System.ComponentModel;
using System.Text.Json;
using System.Diagnostics.CodeAnalysis;
using ModelContextProtocol.Server;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// Overlay inventory + bulk cleanup (Phase 2.5 A2/A3).
///
/// Created because models burned entire turn budgets guessing get_config keys
/// for overlay state, then refused cleanup citing stale "never remove what you
/// did not create" guidance while the user stared at a cluttered screen.
/// These tools make state queryable and cleanup one call away.
/// </summary>
[McpServerToolType]
public static class OverlaysQueryTool
{
    [McpServerTool, Description(
        "List overlays currently on screen. Returns id, type, color, bounds, owner actor, and age for each. " +
        "Use this (never config probing) to discover what annotations exist and which ids remove_overlay accepts.")]
    [RequiresUnreferencedCode("JSON serialization may require types that cannot be statically analyzed")]
    public static async Task<string> ListOverlays(
        IOverlayService overlayService,
        IModeManager modeManager)
    {
        modeManager.EnsureAllowed("list_overlays");
        var overlays = await overlayService.GetActiveOverlaysAsync();
        var items = overlays.Select(o => new
        {
            id = o.Id,
            actor = o.Actor,
            color = o.Color,
            x = o.Bounds.X,
            y = o.Bounds.Y,
            width = o.Bounds.Width,
            height = o.Bounds.Height,
            age_seconds = (long)(DateTime.UtcNow - o.CreatedAt).TotalSeconds
        });
        return JsonSerializer.Serialize(new { count = overlays.Length, overlays = items });
    }

    [McpServerTool, Description(
        "Count active overlays by owner and type (text vs non-text). Cheap; call before placing more annotations or when a user mentions clutter.")]
    [RequiresUnreferencedCode("JSON serialization may require types that cannot be statically analyzed")]
    public static async Task<string> GetOverlayStats(
        IOverlayService overlayService,
        IModeManager modeManager)
    {
        modeManager.EnsureAllowed("get_overlay_stats");
        var overlays = await overlayService.GetActiveOverlaysAsync();
        var byActor = overlays.GroupBy(o => string.IsNullOrWhiteSpace(o.Actor) ? "unknown" : o.Actor)
            .ToDictionary(g => g.Key, g => g.Count());
        var textCount = overlays.Count(o =>
            string.Equals(o.Template, "text", StringComparison.OrdinalIgnoreCase) ||
            !string.IsNullOrEmpty(o.Label));
        return JsonSerializer.Serialize(new
        {
            total = overlays.Length,
            text = textCount,
            non_text = overlays.Length - textCount,
            by_actor = byActor
        });
    }

    [McpServerTool, Description(
        "Bulk-remove overlays. scope='self' removes overlays owned by the CURRENT display owner (safe default). " +
        "scope='all' clears the whole canvas and requires assist mode. Returns ids removed.")]
    [RequiresUnreferencedCode("JSON serialization may require types that cannot be statically analyzed")]
    public static async Task<string> ClearOverlays(
        IOverlayService overlayService,
        IModeManager modeManager,
        IDisplayActorGate displayActor,
        [Description("'self' (overlays owned by the current canvas owner) or 'all' (entire canvas, assist mode required)")] string scope = "self")
    {
        if (!string.Equals(scope, "self", StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(scope, "all", StringComparison.OrdinalIgnoreCase))
        {
            throw new ModelContextProtocol.McpException(
                "scope must be 'self' or 'all'.");
        }

        // Identity derives from the canvas owner, never from arguments: a
        // caller cannot claim another actor's overlays for deletion.
        if (string.Equals(scope, "all", StringComparison.OrdinalIgnoreCase))
        {
            modeManager.EnsureAllowed("remove_overlay");
        }

        var callerKey = (await displayActor.GetActiveActorAsync()).ToKey();
        var overlays = await overlayService.GetActiveOverlaysAsync();
        var targets = overlays
            .Where(o => scope.Equals("all", StringComparison.OrdinalIgnoreCase)
                        || string.Equals(o.Actor, callerKey, StringComparison.OrdinalIgnoreCase))
            .Select(o => o.Id)
            .ToList();

        var removed = new List<string>();
        foreach (var id in targets)
        {
            if (await overlayService.RemoveOverlayAsync(id)) removed.Add(id);
        }
        return JsonSerializer.Serialize(new
        {
            ok = true,
            scope = scope.ToLowerInvariant(),
            caller = callerKey,
            removed_count = removed.Count,
            removed_ids = removed
        });
    }
}