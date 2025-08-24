using System;
using System.Reflection;
using System.Runtime.InteropServices;

namespace OverlayCompanion.UI;

/// <summary>
/// Optional runtime interop with gtk-layer-shell for robust Wayland overlays.
/// If the library is present and Wayland is active, we configure overlay windows
/// as layer surfaces on the overlay layer, anchored to all edges with no keyboard
/// interactivity and exclusive zone 0. Falls back silently if unavailable.
/// </summary>
internal static class LayerShellInterop
{
    // Enum values copied from gtk-layer-shell headers
    private const int GTK_LAYER_SHELL_LAYER_BACKGROUND = 0;
    private const int GTK_LAYER_SHELL_LAYER_BOTTOM = 1;
    private const int GTK_LAYER_SHELL_LAYER_TOP = 2;
    private const int GTK_LAYER_SHELL_LAYER_OVERLAY = 3;

    private const int GTK_LAYER_SHELL_EDGE_LEFT = 0;
    private const int GTK_LAYER_SHELL_EDGE_RIGHT = 1;
    private const int GTK_LAYER_SHELL_EDGE_TOP = 2;
    private const int GTK_LAYER_SHELL_EDGE_BOTTOM = 3;

    // Keyboard mode introduced in 0.6; NONE=0
    private const int GTK_LAYER_SHELL_KEYBOARD_MODE_NONE = 0;

    private static bool _attemptedLoad = false;
    private static bool _isLoaded = false;
    private static IntPtr _lib = IntPtr.Zero;

    // Delegates
    private delegate bool gtk_layer_is_supported_t();
    private delegate void gtk_layer_init_for_window_t(IntPtr window);
    private delegate void gtk_layer_set_layer_t(IntPtr window, int layer);
    private delegate void gtk_layer_set_keyboard_mode_t(IntPtr window, int mode);
    private delegate void gtk_layer_set_keyboard_interactivity_t(IntPtr window, bool interactivity);
    private delegate void gtk_layer_set_exclusive_zone_t(IntPtr window, int zone);
    private delegate void gtk_layer_set_anchor_t(IntPtr window, int edge, bool anchorToEdge);
    private delegate void gtk_layer_set_monitor_t(IntPtr window, IntPtr monitor);

    // Function pointers
    private static gtk_layer_is_supported_t? _isSupported;
    private static gtk_layer_init_for_window_t? _initForWindow;
    private static gtk_layer_set_layer_t? _setLayer;
    private static gtk_layer_set_keyboard_mode_t? _setKeyboardMode; // optional
    private static gtk_layer_set_keyboard_interactivity_t? _setKeyboardInteractivity; // fallback
    private static gtk_layer_set_exclusive_zone_t? _setExclusiveZone;
    private static gtk_layer_set_anchor_t? _setAnchor;
    private static gtk_layer_set_monitor_t? _setMonitor;

    public static bool IsAvailable
    {
        get
        {
            EnsureLoaded();
            return _isLoaded;
        }
    }

    public static void EnsureLoaded()
    {
        if (_attemptedLoad) return;
        _attemptedLoad = true;

        try
        {
            // Only attempt on Wayland
            if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("WAYLAND_DISPLAY")))
            {
                _isLoaded = false;
                return;
            }

            string[] candidates = new[]
            {
                "libgtk-layer-shell.so.0",
                "libgtk-layer-shell.so"
            };

            foreach (var name in candidates)
            {
                if (NativeLibrary.TryLoad(name, out _lib))
                {
                    break;
                }
            }

            if (_lib == IntPtr.Zero)
            {
                _isLoaded = false;
                return;
            }

            // Resolve symbols (some are optional based on library version)
            _isSupported = GetExport<gtk_layer_is_supported_t>("gtk_layer_is_supported");
            _initForWindow = GetExport<gtk_layer_init_for_window_t>("gtk_layer_init_for_window");
            _setLayer = GetExport<gtk_layer_set_layer_t>("gtk_layer_set_layer");
            _setKeyboardMode = GetExport<gtk_layer_set_keyboard_mode_t>("gtk_layer_set_keyboard_mode");
            _setKeyboardInteractivity = GetExport<gtk_layer_set_keyboard_interactivity_t>("gtk_layer_set_keyboard_interactivity");
            _setExclusiveZone = GetExport<gtk_layer_set_exclusive_zone_t>("gtk_layer_set_exclusive_zone");
            _setAnchor = GetExport<gtk_layer_set_anchor_t>("gtk_layer_set_anchor");
            _setMonitor = GetExport<gtk_layer_set_monitor_t>("gtk_layer_set_monitor");

            _isLoaded = _initForWindow != null && _setLayer != null && _setExclusiveZone != null && _setAnchor != null;
        }
        catch
        {
            _isLoaded = false;
        }
    }

    private static T? GetExport<T>(string symbol) where T : class
    {
        try
        {
            if (_lib != IntPtr.Zero && NativeLibrary.TryGetExport(_lib, symbol, out var proc))
            {
                return Marshal.GetDelegateForFunctionPointer(proc, typeof(T)) as T;
            }
        }
        catch {}
        return null;
    }

    private static IntPtr GetHandle(object obj)
    {
        if (obj == null) return IntPtr.Zero;
        var t = obj.GetType();
        // Common: Handle
        var p = t.GetProperty("Handle", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
        if (p != null)
        {
            var v = p.GetValue(obj);
            if (v is IntPtr ip) return ip;
        }
        // Sometimes named UnsafeHandle
        p = t.GetProperty("UnsafeHandle", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
        if (p != null)
        {
            var v = p.GetValue(obj);
            if (v is IntPtr ip) return ip;
        }
        return IntPtr.Zero;
    }

    /// <summary>
    /// Configure the given Gtk.Window as a layer-shell overlay surface.
    /// Returns true if configuration succeeded, else false.
    /// </summary>
    public static bool TryConfigureOverlay(object gtkWindowObj, object? gdkMonitorObj, string? ns = null)
    {
        EnsureLoaded();
        if (!_isLoaded || _initForWindow == null || _setLayer == null || _setExclusiveZone == null || _setAnchor == null)
            return false;

        try
        {
            if (_isSupported != null && !_isSupported())
                return false;

            var win = GetHandle(gtkWindowObj);
            if (win == IntPtr.Zero)
                return false;

            _initForWindow(win);
            _setLayer(win, GTK_LAYER_SHELL_LAYER_OVERLAY);

            // No keyboard
            if (_setKeyboardMode != null)
            {
                _setKeyboardMode(win, GTK_LAYER_SHELL_KEYBOARD_MODE_NONE);
            }
            else if (_setKeyboardInteractivity != null)
            {
                _setKeyboardInteractivity(win, false);
            }

            // No reserved screen space, pass-through visuals
            _setExclusiveZone(win, 0);

            // Anchor to all edges to cover full output
            _setAnchor(win, GTK_LAYER_SHELL_EDGE_TOP, true);
            _setAnchor(win, GTK_LAYER_SHELL_EDGE_BOTTOM, true);
            _setAnchor(win, GTK_LAYER_SHELL_EDGE_LEFT, true);
            _setAnchor(win, GTK_LAYER_SHELL_EDGE_RIGHT, true);

            // Optional: select monitor
            if (gdkMonitorObj != null && _setMonitor != null)
            {
                var mon = GetHandle(gdkMonitorObj);
                if (mon != IntPtr.Zero)
                {
                    _setMonitor(win, mon);
                }
            }

            return true;
        }
        catch
        {
            return false;
        }
    }
}
