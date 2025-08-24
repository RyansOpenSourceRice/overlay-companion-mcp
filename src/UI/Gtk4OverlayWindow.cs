using Gtk;
using System.Runtime.InteropServices;
using OverlayCompanion.UI;

using Gdk;
using Cairo;
using OverlayCompanion.Models;
using OverlayCompanion.Services;
using System;
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

    private bool _isLayerShell = false;
    private int _monitorOffsetX = 0;
    private int _monitorOffsetY = 0;

    public OverlayElement Overlay => _overlay;

    public Gtk4OverlayWindow(OverlayElement overlay)
    {
        _overlay = overlay;
        InitializeWindow();
    }

    private void InitializeWindow()
    {
        // Use the existing GTK application instance instead of creating a new one
        Gtk.Application? app = null;
        if (Gtk4OverlayApplication.GlobalServiceProvider != null)
        {
            app = (Gtk4OverlayApplication.GlobalServiceProvider.GetService(typeof(Gtk4OverlayApplication)) as Gtk4OverlayApplication)?.Application;
        }
        
        if (app == null)
        {
            // Fallback to singleton instance
            app = Gtk4Application.Instance;
        }

        // Create application window
        _window = Gtk.ApplicationWindow.New(app);

        // Configure window properties for overlay
        _window.SetTitle($"Overlay {_overlay.Id}");
        _window.SetResizable(false);
        _window.SetDecorated(false);
        _window.SetModal(false);
        
        // Wayland-first: use gtk-layer-shell overlay layer if available; otherwise fullscreen toplevel
        bool usedLayerShell = false;
        try
        {
            object? monitorObj = null;
            _monitorOffsetX = 0;
            _monitorOffsetY = 0;
            try
            {
                var display = Gdk.Display.GetDefault();
                if (display != null)
                {
                    // Use reflection to avoid hard dependency on specific GIR bindings
                    var mGetMonitors = display.GetType().GetMethod("GetMonitors");
                    var monitors = mGetMonitors != null ? mGetMonitors.Invoke(display, null) : null;
                    if (monitors != null)
                    {
                        var lmType = monitors.GetType();
                        var mGetNItems = lmType.GetMethod("GetNItems");
                        var mGetItem = lmType.GetMethod("GetItem", new[] { typeof(uint) });
                        if (mGetNItems != null && mGetItem != null)
                        {
                            var nObj = mGetNItems.Invoke(monitors, null);
                            if (nObj is uint count && _overlay.MonitorIndex >= 0 && (uint)_overlay.MonitorIndex < count)
                            {
                                monitorObj = mGetItem.Invoke(monitors, new object[] { (uint)_overlay.MonitorIndex });
                                try
                                {
                                    // Read logical monitor geometry via reflection to compute offset
                                    var monType = monitorObj?.GetType();
                                    var mGetGeometry = monType?.GetMethod("GetGeometry");
                                    if (mGetGeometry != null)
                                    {
                                        var rect = mGetGeometry.Invoke(monitorObj, null);
                                        if (rect != null)
                                        {
                                            var rt = rect.GetType();
                                            var pX = rt.GetProperty("X");
                                            var pY = rt.GetProperty("Y");
                                            var pW = rt.GetProperty("Width");
                                            var pH = rt.GetProperty("Height");
                                            if (pX != null && pY != null)
                                            {
                                                _monitorOffsetX = (int)(pX.GetValue(rect) ?? 0);
                                                _monitorOffsetY = (int)(pY.GetValue(rect) ?? 0);
                                            }
                                        }
                                    }
                                }
                                catch { }
                            }
                        }
                    }
                }
            }
            catch { }

            if (LayerShellInterop.IsAvailable && _window != null)
            {
                usedLayerShell = LayerShellInterop.TryConfigureOverlay(_window, monitorObj);
                _isLayerShell = usedLayerShell;
            }
        }
        catch { }

        if (!usedLayerShell)
        {
            // Fallback: fullscreen normal toplevel
            _window?.Fullscreen();
        }

        // Create drawing area for custom rendering - covers full screen
        _drawingArea = DrawingArea.New();
        // Don't set size request - let it fill the fullscreen window
        _drawingArea.SetHexpand(true);
        _drawingArea.SetVexpand(true);

        // Set up drawing callback
        _drawingArea.SetDrawFunc(OnDraw);

        // Add drawing area to window
        if (_window != null)
        {
            _window.SetChild(_drawingArea);
        }

        // Configure transparency and click-through after window is realized
        if (_window != null)
        {
            _window.OnRealize += OnWindowRealized;
        }

        // Apply CSS for transparency and positioning
        ApplyOverlayStyles();
    }

    private void ApplyOverlayStyles()
    {
        if (_window == null) return;

        // Create CSS provider for overlay styling
        var cssProvider = Gtk.CssProvider.New();
        var css = $@"
            window.overlay {{
                background-color: transparent;
                border: none;
            }}
            
            drawingarea.overlay {{
                background-color: transparent;
            }}
        ";

        try
        {
            cssProvider.LoadFromData(css, -1);
            
            // Apply CSS to window
            var styleContext = _window.GetStyleContext();
            styleContext.AddProvider(cssProvider, 800); // GTK_STYLE_PROVIDER_PRIORITY_APPLICATION
            styleContext.AddClass("overlay");

            // Apply CSS to drawing area
            if (_drawingArea != null)
            {
                var drawingStyleContext = _drawingArea.GetStyleContext();
                drawingStyleContext.AddProvider(cssProvider, 800); // GTK_STYLE_PROVIDER_PRIORITY_APPLICATION
                drawingStyleContext.AddClass("overlay");
            }

            Console.WriteLine($"✓ CSS styles applied to overlay {_overlay.Id}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"⚠️ Failed to apply CSS styles to overlay {_overlay.Id}: {ex.Message}");
        }
    }

    private void OnWindowRealized(object sender, EventArgs e)
    {
        if (_window == null) return;

        try
        {
            ApplyClickThrough();
            Console.WriteLine($"✓ Overlay window {_overlay.Id} realized and configured");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"⚠️ Failed to configure overlay {_overlay.Id}: {ex.Message}");
        }
    }
    private void ApplyClickThrough()
    {
        if (_window == null) return;
        try
        {
            var surface = _window.GetSurface();
            if (surface == null) return;
            if (_overlay.ClickThrough)
            {
                try
                {
                    // Preferred: create an empty Cairo region (true pass-through)
                    var emptyRegion = Cairo.Region.Create();
                    surface.SetInputRegion(emptyRegion);
                }
                catch
                {
                    try
                    {
                        // Fallback: 0x0 rectangle region
                        var rect = new Cairo.RectangleInt { X = 0, Y = 0, Width = 0, Height = 0 };
                        var emptyRectRegion = Cairo.Region.CreateRectangle(rect);
                        surface.SetInputRegion(emptyRectRegion);
                    }
                    catch { /* ignore if not available in runtime */ }
                }
                Console.WriteLine($"✓ Click-through enabled (empty input region) for overlay {_overlay.Id}");
            }
        }
        catch (Exception rex)
        {
            Console.WriteLine($"⚠️ Failed to set empty input region for click-through: {rex.Message}");
        }
    }


    private void OnDraw(Gtk.DrawingArea area, Cairo.Context cr, int width, int height)
    {
        // Clear the entire drawing area with transparent background
        cr.SetSourceRgba(0.0, 0.0, 0.0, 0.0);
        cr.Paint();

        // Parse color
        var color = ParseColor(_overlay.Color);

        // Draw overlay rectangle at the specified position
        var overlayX = _overlay.Bounds.X;
        var overlayY = _overlay.Bounds.Y;
        // Under layer-shell each window covers a single monitor. Coordinates should be monitor-relative.
        if (_isLayerShell)
        {
            overlayX -= _monitorOffsetX;
            overlayY -= _monitorOffsetY;
        }
        var overlayWidth = _overlay.Bounds.Width;
        var overlayHeight = _overlay.Bounds.Height;

        // Set source color with transparency (use overlay-specified opacity if provided)
        var alpha = Math.Clamp(_overlay.Opacity, 0.0, 1.0);
        cr.SetSourceRgba(color.Red, color.Green, color.Blue, alpha);

        // Draw rectangle at the correct position
        cr.Rectangle(overlayX, overlayY, overlayWidth, overlayHeight);
        cr.Fill();

        // Draw label if present
        if (!string.IsNullOrEmpty(_overlay.Label))
        {
            // Set text color (contrasting)
            cr.SetSourceRgba(1.0, 1.0, 1.0, 1.0); // White text

            // Position text within the overlay rectangle
            cr.MoveTo(overlayX + 10, overlayY + 20);
            cr.ShowText(_overlay.Label);
        }

        // Draw border
        cr.SetSourceRgba(color.Red, color.Green, color.Blue, 1.0);
        cr.Rectangle(overlayX, overlayY, overlayWidth, overlayHeight);
        cr.Stroke();
    }

    private (double Red, double Green, double Blue, double Alpha) ParseColor(string colorName)
    {
        try
        {
            if (!string.IsNullOrWhiteSpace(colorName))
            {
                var s = colorName.Trim();
                if (s.StartsWith("#")) s = s[1..];
                if (s.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) s = s[2..];
                if (s.Length == 6 || s.Length == 8)
                {
                    var r = Convert.ToInt32(s.Substring(0, 2), 16) / 255.0;
                    var g = Convert.ToInt32(s.Substring(2, 2), 16) / 255.0;
                    var b = Convert.ToInt32(s.Substring(4, 2), 16) / 255.0;
                    var a = s.Length == 8 ? Convert.ToInt32(s.Substring(6, 2), 16) / 255.0 : _overlay.Opacity;
                    return (r, g, b, a);
                }
                if (s.Length == 3)
                {
                    var r = Convert.ToInt32(new string(s[0], 2), 16) / 255.0;
                    var g = Convert.ToInt32(new string(s[1], 2), 16) / 255.0;
                    var b = Convert.ToInt32(new string(s[2], 2), 16) / 255.0;
                    return (r, g, b, _overlay.Opacity);
                }
            }
        }
        catch
        {
            // fall through to named colors
        }

        // Named colors fallback
        return colorName.ToLowerInvariant() switch
        {
            "red" => (1.0, 0.0, 0.0, _overlay.Opacity),
            "green" => (0.0, 1.0, 0.0, _overlay.Opacity),
            "blue" => (0.0, 0.0, 1.0, _overlay.Opacity),
            "yellow" => (1.0, 1.0, 0.0, _overlay.Opacity),
            "orange" => (1.0, 0.5, 0.0, _overlay.Opacity),
            "purple" => (1.0, 0.0, 1.0, _overlay.Opacity),
            "cyan" => (0.0, 1.0, 1.0, _overlay.Opacity),
            _ => (1.0, 1.0, 0.0, _overlay.Opacity) // Default to yellow
        };
    }

    public Task ShowAsync()
    {
        if (_window != null && !_disposed)
        {
            // Ensure we're on the main thread for GTK operations
            GLib.Functions.IdleAdd(0, () =>
            {
                try
                {
                    _window.SetVisible(true);
                    _window.Present();
                    Console.WriteLine($"✓ Overlay {_overlay.Id} shown at ({_overlay.Bounds.X}, {_overlay.Bounds.Y}) size {_overlay.Bounds.Width}x{_overlay.Bounds.Height}");
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"⚠️ Failed to show overlay {_overlay.Id}: {ex.Message}");
                }
                return false; // Remove from idle queue
            });

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
            // Ensure we're on the main thread for GTK operations
            GLib.Functions.IdleAdd(0, () =>
            {
                try
                {
                    _window.SetVisible(false);
                    Console.WriteLine($"✓ Overlay {_overlay.Id} hidden");
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"⚠️ Failed to hide overlay {_overlay.Id}: {ex.Message}");
                }
                return false; // Remove from idle queue
            });
        }
        return Task.CompletedTask;
    }

    public Task UpdatePositionAsync(ScreenRegion newBounds)
    {
        if (_window != null && !_disposed)
        {
            // Ensure we're on the main thread for GTK operations
            GLib.Functions.IdleAdd(0, () =>
            {
                try
                {
                    _overlay.Bounds = newBounds;
                    // No need to resize window since it's fullscreen
                    // Just force redraw to show overlay at new position
                    _drawingArea?.QueueDraw();
                    Console.WriteLine($"✓ Overlay {_overlay.Id} position updated to ({newBounds.X}, {newBounds.Y}) size {newBounds.Width}x{newBounds.Height}");
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"⚠️ Failed to update overlay {_overlay.Id} position: {ex.Message}");
                }
                return false; // Remove from idle queue
            });
        }
        return Task.CompletedTask;
    }

    public Task UpdateAppearanceAsync(string color, string? label)
    {
        if (_window != null && !_disposed)
        {
            // Ensure we're on the main thread for GTK operations
            GLib.Functions.IdleAdd(0, () =>
            {
                try
                {
                    _overlay.Color = color;
                    _overlay.Label = label;

                    // Force redraw with new appearance
                    _drawingArea?.QueueDraw();
                    Console.WriteLine($"✓ Overlay {_overlay.Id} appearance updated to {color}");
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"⚠️ Failed to update overlay {_overlay.Id} appearance: {ex.Message}");
                }
                return false; // Remove from idle queue
            });
        }
        return Task.CompletedTask;
    }

    public void Dispose()
    {
        if (!_disposed)
        {
            _disposed = true;

            // Ensure we're on the main thread for GTK operations
            GLib.Functions.IdleAdd(0, () =>
            {
                try
                {
                    if (_window != null)
                    {
                        _window.Close();
                        _window = null;
                        Console.WriteLine($"✓ Overlay {_overlay.Id} disposed");
                    }

                    _drawingArea = null;
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"⚠️ Failed to dispose overlay {_overlay.Id}: {ex.Message}");
                }
                return false; // Remove from idle queue
            });
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
