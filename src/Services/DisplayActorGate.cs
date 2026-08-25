using Microsoft.Extensions.Logging;

namespace OverlayCompanion.Services;

/// <summary>
/// Identifies which agent may currently draw overlays on the shared canvas.
/// Prevents two agents (the in-app "interior" chat assistant and an external
/// MCP-connected "exterior" agent) from simultaneously owning the same display.
///
/// The active actor is held in-memory (default Exterior). With libSQL as the
/// database, the management server owns `general.activeActor` in app_config;
/// this gate is the MCP server's single-process view and stays per-instance
/// rather than reaching out-of-process for the setting.
/// </summary>
public enum DisplayActor
{
    /// <summary>The built-in in-app chat assistant (interior agent).</summary>
    Interior,
    /// <summary>An external MCP-connected agent (exterior agent).</summary>
    Exterior,
}

public static class DisplayActorExtensions
{
    public static string ToKey(this DisplayActor actor)
        => actor == DisplayActor.Interior ? "interior" : "exterior";

    public static DisplayActor ToActor(this string key)
        => string.Equals(key, "interior", System.StringComparison.OrdinalIgnoreCase)
            ? DisplayActor.Interior
            : DisplayActor.Exterior;
}

public interface IDisplayActorGate
{
    /// <summary>The actor that currently owns overlay-write authority.</summary>
    Task<DisplayActor> GetActiveActorAsync(System.Threading.CancellationToken ct = default);

    /// <summary>Switch ownership; releases overlays authored by the losing actor.</summary>
    Task<DisplayActor> SetActiveActorAsync(DisplayActor actor, System.Threading.CancellationToken ct = default);

    /// <summary>True if the given caller is the current owner and may write overlays.</summary>
    Task<bool> CanWriteAsync(DisplayActor caller, System.Threading.CancellationToken ct = default);

    /// <summary>Raised when ownership changes, with the newly active actor.</summary>
    event System.EventHandler<DisplayActor>? ActorChanged;
}

public class DisplayActorGate : IDisplayActorGate
{
    private readonly IOverlayService _overlays;
    private readonly Microsoft.Extensions.Logging.ILogger<DisplayActorGate> _logger;
    private DisplayActor _activeActor = DisplayActor.Exterior;

    public DisplayActorGate(
        IOverlayService overlays,
        Microsoft.Extensions.Logging.ILogger<DisplayActorGate> logger)
    {
        _overlays = overlays;
        _logger = logger;
    }

    public event System.EventHandler<DisplayActor>? ActorChanged;

    public Task<DisplayActor> GetActiveActorAsync(System.Threading.CancellationToken ct = default)
        => Task.FromResult(_activeActor);

    public async Task<DisplayActor> SetActiveActorAsync(DisplayActor actor, System.Threading.CancellationToken ct = default)
    {
        var previous = _activeActor;
        if (previous == actor) return previous;

        if (!IsSettingSafe(actor.ToKey()))
        {
            throw new InvalidOperationException("Invalid display actor.");
        }
        _activeActor = actor;

        // Release overlays not authored by the new owner so the two never share.
        var active = await _overlays.GetActiveOverlaysAsync();
        var toRelease = active
            .Where(o => !IsOwnedBy(o, actor))
            .Select(o => o.Id)
            .ToArray();
        foreach (var id in toRelease)
        {
            await _overlays.RemoveOverlayAsync(id);
        }
        if (toRelease.Length > 0)
        {
            _logger.LogInformation("Actor switch -> {Actor} released {Count} overlays of the other actor", actor.ToKey(), toRelease.Length);
        }

        ActorChanged?.Invoke(this, actor);
        return actor;
    }

    public async Task<bool> CanWriteAsync(DisplayActor caller, System.Threading.CancellationToken ct = default)
    {
        var active = await GetActiveActorAsync(ct);
        return caller == active;
    }

    private static bool IsSettingSafe(string value)
        => value is "interior" or "exterior";

    private static bool IsOwnedBy(OverlayCompanion.Models.OverlayElement o, DisplayActor actor)
    {
        // Overlays authored while an actor was active carry that actor; ones
        // recorded before actor tracking existed default to the new owner to
        // avoid clobbering. (Actor is recorded on OverlayElement.Actor.)
        if (string.IsNullOrEmpty(o.Actor)) return true;
        return string.Equals(o.Actor, actor.ToKey(), System.StringComparison.OrdinalIgnoreCase);
    }
}
