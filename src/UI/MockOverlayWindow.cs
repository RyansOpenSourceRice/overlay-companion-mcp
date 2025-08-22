using OverlayCompanion.Models;
using OverlayCompanion.Services;
using System.Threading.Tasks;

namespace OverlayCompanion.UI;

/// <summary>
/// Mock overlay window implementation for headless mode
/// Provides logging and tracking without actual UI rendering
/// </summary>
public class MockOverlayWindow : IOverlayWindow
{
    private readonly OverlayElement _overlay;
    private bool _disposed = false;
    private bool _visible = false;

    public OverlayElement Overlay => _overlay;

    public MockOverlayWindow(OverlayElement overlay)
    {
        _overlay = overlay;
        Console.WriteLine($"MockOverlayWindow created: {overlay.Id} at ({overlay.Bounds.X}, {overlay.Bounds.Y}) size {overlay.Bounds.Width}x{overlay.Bounds.Height}");
    }

    public Task ShowAsync()
    {
        if (!_disposed)
        {
            _visible = true;
            Console.WriteLine($"MockOverlayWindow shown: {_overlay.Id} - Color: {_overlay.Color}, Label: {_overlay.Label ?? "none"}, ClickThrough: {_overlay.ClickThrough}");
            
            // Handle temporary overlays
            if (_overlay.TemporaryMs > 0)
            {
                _ = Task.Delay(_overlay.TemporaryMs).ContinueWith(_ => HideAsync());
            }
        }
        return Task.CompletedTask;
    }

    public Task HideAsync()
    {
        if (!_disposed && _visible)
        {
            _visible = false;
            Console.WriteLine($"MockOverlayWindow hidden: {_overlay.Id}");
        }
        return Task.CompletedTask;
    }

    public Task UpdatePositionAsync(ScreenRegion newBounds)
    {
        if (!_disposed)
        {
            var oldBounds = _overlay.Bounds;
            _overlay.Bounds = newBounds;
            Console.WriteLine($"MockOverlayWindow position updated: {_overlay.Id} from ({oldBounds.X}, {oldBounds.Y}) {oldBounds.Width}x{oldBounds.Height} to ({newBounds.X}, {newBounds.Y}) {newBounds.Width}x{newBounds.Height}");
        }
        return Task.CompletedTask;
    }

    public Task UpdateAppearanceAsync(string color, string? label)
    {
        if (!_disposed)
        {
            var oldColor = _overlay.Color;
            var oldLabel = _overlay.Label;
            _overlay.Color = color;
            _overlay.Label = label;
            Console.WriteLine($"MockOverlayWindow appearance updated: {_overlay.Id} color: {oldColor} -> {color}, label: {oldLabel ?? "none"} -> {label ?? "none"}");
        }
        return Task.CompletedTask;
    }

    public void Dispose()
    {
        if (!_disposed)
        {
            _disposed = true;
            if (_visible)
            {
                _visible = false;
            }
            Console.WriteLine($"MockOverlayWindow disposed: {_overlay.Id}");
        }
    }
}