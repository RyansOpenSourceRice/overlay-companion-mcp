using Gtk;
using Gdk;
using Cairo;
using OverlayCompanion.Models;
using OverlayCompanion.Services;
using System.Threading.Tasks;

namespace OverlayCompanion.UI;

/// <summary>
/// GTK4-based overlay window implementation with true OS-level click-through
/// Provides transparent, click-through overlay windows for screen annotation
/// </summary>
public class Gtk4OverlayWindow : IOverlayWindow
{
    private readonly OverlayElement _overlay;
    private ApplicationWindow? _window;
    private DrawingArea? _drawingArea;
    private bool _disposed = false;

    public OverlayElement Overlay => _overlay;

    public Gtk4OverlayWindow(OverlayElement overlay)
    {
        _overlay = overlay;
        InitializeWindow();
    }

    private void InitializeWindow()
    {
        // Create application window
        _window = Gtk.ApplicationWindow.New(Gtk4Application.Instance);

        // Configure window properties
        _window.SetTitle($"Overlay {_overlay.Id}");
        _window.SetDefaultSize((int)_overlay.Bounds.Width, (int)_overlay.Bounds.Height);
        _window.SetResizable(false);
        _window.SetDecorated(false);

        // Position window
        // Note: GTK4 doesn't have direct positioning, but we can use surface positioning
        _window.SetModal(false);

        // Create drawing area for custom rendering
        _drawingArea = DrawingArea.New();
        _drawingArea.SetSizeRequest((int)_overlay.Bounds.Width, (int)_overlay.Bounds.Height);

        // Set up drawing callback
        _drawingArea.SetDrawFunc(OnDraw);

        // Add drawing area to window
        _window.SetChild(_drawingArea);

        // Configure transparency and click-through after window is realized
        _window.OnRealize += OnWindowRealized;
    }

    private void OnWindowRealized(object sender, EventArgs e)
    {
        if (_window == null) return;

        // Get the native surface
        var surface = _window.GetSurface();
        if (surface != null)
        {
            // Enable transparency
            // GTK4 handles transparency automatically with proper CSS

            // Enable click-through by setting empty input region
            if (_overlay.ClickThrough)
            {
                surface.SetInputRegion(null!);
                Console.WriteLine($"✓ Click-through enabled for overlay {_overlay.Id}");
            }

            // Position the window
            // Note: GTK4 positioning is handled by the compositor
            // We may need to use layer shell protocols for precise positioning
        }
    }

    private void OnDraw(Gtk.DrawingArea area, Cairo.Context cr, int width, int height)
    {
        // Parse color
        var color = ParseColor(_overlay.Color);

        // Set source color with transparency
        cr.SetSourceRgba(color.Red, color.Green, color.Blue, color.Alpha);

        // Draw rectangle
        cr.Rectangle(0, 0, width, height);
        cr.Fill();

        // Draw label if present
        if (!string.IsNullOrEmpty(_overlay.Label))
        {
            // Set text color (contrasting)
            cr.SetSourceRgba(1.0, 1.0, 1.0, 1.0); // White text

            // Simple text rendering (could be enhanced with Pango)
            cr.MoveTo(10, 20);
            cr.ShowText(_overlay.Label);
        }

        // Draw border (approximate using stroke with default width)
        cr.SetSourceRgba(color.Red, color.Green, color.Blue, 1.0);
        cr.Rectangle(0, 0, width, height);
        cr.Stroke();
    }

    private (double Red, double Green, double Blue, double Alpha) ParseColor(string colorName)

    {
        // Simple color parsing - could be enhanced
        return colorName.ToLowerInvariant() switch
        {
            "red" => (1.0, 0.0, 0.0, 0.3),
            "green" => (0.0, 1.0, 0.0, 0.3),
            "blue" => (0.0, 0.0, 1.0, 0.3),
            "yellow" => (1.0, 1.0, 0.0, 0.3),
            "orange" => (1.0, 0.5, 0.0, 0.3),
            "purple" => (1.0, 0.0, 1.0, 0.3),
            "cyan" => (0.0, 1.0, 1.0, 0.3),
            _ => (1.0, 1.0, 0.0, 0.3) // Default to yellow
        };
    }

    public Task ShowAsync()
    {
        if (_window != null && !_disposed)
        {
            _window.SetVisible(true);

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
        if (_window != null && !_disposed)
        {
            _window.SetVisible(false);
        }
        return Task.CompletedTask;
    }

    public Task UpdatePositionAsync(ScreenRegion newBounds)
    {
        if (_window != null && !_disposed)
        {
            _overlay.Bounds = newBounds;
            _window.SetDefaultSize((int)newBounds.Width, (int)newBounds.Height);
            _drawingArea?.SetSizeRequest((int)newBounds.Width, (int)newBounds.Height);

            // Force redraw
            _drawingArea?.QueueDraw();
        }
        return Task.CompletedTask;
    }

    public Task UpdateAppearanceAsync(string color, string? label)
    {
        if (_window != null && !_disposed)
        {
            _overlay.Color = color;
            _overlay.Label = label;

            // Force redraw with new appearance
            _drawingArea?.QueueDraw();
        }
        return Task.CompletedTask;
    }

    public void Dispose()
    {
        if (!_disposed)
        {
            _disposed = true;

            if (_window != null)
            {
                _window.Close();
                _window = null;
            }

            _drawingArea = null;
        }
    }
}

/// <summary>
/// GTK4 Application singleton for managing the GTK application instance
/// </summary>
public static class Gtk4Application
{
    private static Gtk.Application? _instance;
    private static readonly object _lock = new object();

    public static Gtk.Application Instance
    {
        get
        {
            lock (_lock)
            {
                if (_instance == null)
                {
                    _instance = Gtk.Application.New("com.overlaycompanion.mcp", Gio.ApplicationFlags.FlagsNone);
                }
                return _instance;
            }
        }
    }

    public static void Initialize()
    {
        lock (_lock)
        {
            if (_instance == null)
            {
                _instance = Gtk.Application.New("com.overlaycompanion.mcp", Gio.ApplicationFlags.FlagsNone);
            }
        }
    }

    public static void Run()
    {
        Instance.Run(0, null);
    }
}
