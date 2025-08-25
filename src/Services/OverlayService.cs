using OverlayCompanion.Models;
using OverlayCompanion.UI;
using System;
using System.Collections.Concurrent;
using System.Threading.Tasks;
using System.Linq;

namespace OverlayCompanion.Services;

/// <summary>
/// Interface for overlay management
/// Adapted from GraphicalJobApplicationGuidanceSystem overlay system
/// </summary>
public interface IOverlayService
{
    Task<string> DrawOverlayAsync(ScreenRegion bounds, string color = "Yellow", string? label = null, int temporaryMs = 0, bool clickThrough = true);
    Task<string> DrawOverlayAsync(OverlayElement overlay);
    Task<bool> RemoveOverlayAsync(string overlayId);
    Task<string[]> DrawBatchOverlaysAsync(OverlayElement[] overlays, bool oneAtATime = false);
    Task ClearAllOverlaysAsync();
    Task<OverlayElement[]> GetActiveOverlaysAsync();
    Task<bool> UpdateOverlayPositionAsync(string overlayId, ScreenRegion newBounds);
    event EventHandler<OverlayElement>? OverlayCreated;
    event EventHandler<string>? OverlayRemoved;
    event EventHandler<OverlayElement>? OverlayUpdated;
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
    public event EventHandler<OverlayElement>? OverlayUpdated;

    public async Task<string> DrawOverlayAsync(ScreenRegion bounds, string color = "Yellow", string? label = null, int temporaryMs = 0, bool clickThrough = true)
    {
        var overlay = new OverlayElement
        {
            Bounds = bounds,
            Color = color,
            Label = label,
            TemporaryMs = temporaryMs,
            ClickThrough = clickThrough
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
        // Use the provided overlay object directly to preserve all properties (id, click-through, opacity, etc.)
        var window = CreateOverlayWindow(overlay);
        await window.ShowAsync();

        _activeOverlays[overlay.Id] = overlay;
        _overlayWindows[overlay.Id] = window;

        if (overlay.TemporaryMs > 0)
        {
            _ = Task.Delay(overlay.TemporaryMs).ContinueWith(async _ =>
            {
                await RemoveOverlayAsync(overlay.Id);
            });
        }

        OverlayCreated?.Invoke(this, overlay);
        return overlay.Id;
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
                var id = await DrawOverlayAsync(overlay);
                overlayIds.Add(id);

                // Small delay between overlays
                await Task.Delay(100);
            }
        }
        else
        {
            // Show all overlays simultaneously
            var tasks = overlays.Select(overlay => DrawOverlayAsync(overlay));

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

    public async Task<bool> UpdateOverlayPositionAsync(string overlayId, ScreenRegion newBounds)
    {
        if (!_activeOverlays.TryGetValue(overlayId, out var overlay))
        {
            return false;
        }

        // Update the overlay element bounds
        overlay.Bounds = newBounds;

        // Update the overlay window position if it exists
        if (_overlayWindows.TryGetValue(overlayId, out var window))
        {
            await window.UpdatePositionAsync(newBounds);
        }

        OverlayUpdated?.Invoke(this, overlay);
        return true;
    }

    private IOverlayWindow CreateOverlayWindow(OverlayElement overlay)
    {
        // Check if running in headless mode
        bool headless = Environment.GetEnvironmentVariable("HEADLESS") == "1";

        if (headless)
        {
            // Use mock overlay window for headless mode
            return new MockOverlayWindow(overlay);
        }
        else
        {
            // Use GTK4 overlay windows with true click-through support
            return new Gtk4OverlayWindow(overlay);
        }
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
