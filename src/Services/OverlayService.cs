using OverlayCompanion.Models;
using OverlayCompanion.UI;
using System;
using System.Collections.Concurrent;
using System.Threading.Tasks;

namespace OverlayCompanion.Services;

/// <summary>
/// Interface for overlay management
/// Adapted from GraphicalJobApplicationGuidanceSystem overlay system
/// </summary>
public interface IOverlayService
{
    Task<string> DrawOverlayAsync(ScreenRegion bounds, string color = "Yellow", string? label = null, int temporaryMs = 0);
    Task<string> DrawOverlayAsync(OverlayElement overlay);
    Task<bool> RemoveOverlayAsync(string overlayId);
    Task<string[]> DrawBatchOverlaysAsync(OverlayElement[] overlays, bool oneAtATime = false);
    Task ClearAllOverlaysAsync();
    Task<OverlayElement[]> GetActiveOverlaysAsync();
    event EventHandler<OverlayElement>? OverlayCreated;
    event EventHandler<string>? OverlayRemoved;
}

/// <summary>
/// Overlay management service
/// Extracted and generalized from GraphicalJobApplicationGuidanceSystem
/// Removed job-specific context, added MCP-compatible features
/// </summary>
public class OverlayService : IOverlayService
{
    private readonly ConcurrentDictionary<string, OverlayElement> _activeOverlays = new();
    private readonly ConcurrentDictionary<string, IOverlayWindow> _overlayWindows = new();

    public event EventHandler<OverlayElement>? OverlayCreated;
    public event EventHandler<string>? OverlayRemoved;

    public async Task<string> DrawOverlayAsync(ScreenRegion bounds, string color = "Yellow", string? label = null, int temporaryMs = 0)
    {
        var overlay = new OverlayElement
        {
            Bounds = bounds,
            Color = color,
            Label = label,
            TemporaryMs = temporaryMs
        };

        // Create and show overlay window
        var window = CreateOverlayWindow(overlay);
        await window.ShowAsync();

        // Store references
        _activeOverlays[overlay.Id] = overlay;
        _overlayWindows[overlay.Id] = window;

        // Set up automatic removal if temporary
        if (temporaryMs > 0)
        {
            _ = Task.Delay(temporaryMs).ContinueWith(async _ =>
            {
                await RemoveOverlayAsync(overlay.Id);
            });
        }

        OverlayCreated?.Invoke(this, overlay);
        return overlay.Id;
    }

    public async Task<string> DrawOverlayAsync(OverlayElement overlay)
    {
        return await DrawOverlayAsync(overlay.Bounds, overlay.Color, overlay.Label, overlay.TemporaryMs);
    }

    public async Task<bool> RemoveOverlayAsync(string overlayId)
    {
        if (!_activeOverlays.TryRemove(overlayId, out var overlay))
            return false;

        if (_overlayWindows.TryRemove(overlayId, out var window))
        {
            await window.HideAsync();
            window.Dispose();
        }

        OverlayRemoved?.Invoke(this, overlayId);
        return true;
    }

    public async Task<string[]> DrawBatchOverlaysAsync(OverlayElement[] overlays, bool oneAtATime = false)
    {
        var overlayIds = new List<string>();

        if (oneAtATime)
        {
            // Show overlays sequentially with delay
            foreach (var overlay in overlays)
            {
                var id = await DrawOverlayAsync(overlay.Bounds, overlay.Color, overlay.Label, overlay.TemporaryMs);
                overlayIds.Add(id);

                // Small delay between overlays
                await Task.Delay(100);
            }
        }
        else
        {
            // Show all overlays simultaneously
            var tasks = overlays.Select(overlay =>
                DrawOverlayAsync(overlay.Bounds, overlay.Color, overlay.Label, overlay.TemporaryMs));

            var ids = await Task.WhenAll(tasks);
            overlayIds.AddRange(ids);
        }

        return overlayIds.ToArray();
    }

    public async Task ClearAllOverlaysAsync()
    {
        var overlayIds = _activeOverlays.Keys.ToArray();

        var tasks = overlayIds.Select(RemoveOverlayAsync);
        await Task.WhenAll(tasks);
    }

    public async Task<OverlayElement[]> GetActiveOverlaysAsync()
    {
        return _activeOverlays.Values.ToArray();
    }

    private IOverlayWindow CreateOverlayWindow(OverlayElement overlay)
    {
        // Use real Avalonia UI overlay windows
        return new AvaloniaOverlayWindow(overlay);
    }
}

/// <summary>
/// Interface for overlay window implementation
/// Abstraction to support different UI frameworks
/// </summary>
public interface IOverlayWindow : IDisposable
{
    Task ShowAsync();
    Task HideAsync();
    Task UpdatePositionAsync(ScreenRegion bounds);
    Task UpdateAppearanceAsync(string color, string? label);
}

/// <summary>
/// Mock overlay window for testing
/// Real implementation would use Avalonia, WPF, or other UI framework
/// </summary>
internal class MockOverlayWindow : IOverlayWindow
{
    private readonly OverlayElement _overlay;
    private bool _isVisible;

    public MockOverlayWindow(OverlayElement overlay)
    {
        _overlay = overlay;
    }

    public async Task ShowAsync()
    {
        _isVisible = true;
        // TODO: Implement actual window creation and display
        await Task.CompletedTask;
    }

    public async Task HideAsync()
    {
        _isVisible = false;
        // TODO: Implement actual window hiding
        await Task.CompletedTask;
    }

    public async Task UpdatePositionAsync(ScreenRegion bounds)
    {
        _overlay.Bounds = bounds;
        // TODO: Implement actual position update
        await Task.CompletedTask;
    }

    public async Task UpdateAppearanceAsync(string color, string? label)
    {
        _overlay.Color = color;
        _overlay.Label = label;
        // TODO: Implement actual appearance update
        await Task.CompletedTask;
    }

    public void Dispose()
    {
        // TODO: Implement actual cleanup
    }
}