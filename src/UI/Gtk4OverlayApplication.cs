using Gtk;
using Gio;
using static Gtk.Functions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using System;

namespace OverlayCompanion.UI;

/// <summary>
/// GTK4 application with GUI for MCP server configuration
/// Replaces Avalonia application with native GTK4 implementation
/// </summary>
public class Gtk4OverlayApplication : IDisposable
{
    public static event System.Action? WindowShown;
    public IServiceProvider? ServiceProvider { get; set; }
    public static IServiceProvider? GlobalServiceProvider { get; set; }

    private Gtk.Application? _application;
    private Gtk4MainWindow? _mainWindow;
    private bool _disposed = false;

    public Gtk.Application? Application => _application;

    public Gtk4OverlayApplication()
    {
        // Initialize GTK4 application
        _application = Gtk.Application.New("com.overlaycompanion.mcp", ApplicationFlags.FlagsNone);

        // Set up application events
        _application.OnActivate += OnActivate;
        _application.OnStartup += OnStartup;
        _application.OnShutdown += OnShutdown;
    }

    private void OnStartup(object sender, EventArgs e)
    {
        Console.WriteLine("GTK4 application starting up...");
    }

    private void OnActivate(object sender, EventArgs e)
    {
        if (_mainWindow == null && ServiceProvider != null)
        {
            try
            {
                // Create main window with dependency injection
                var logger = ServiceProvider.GetService<ILogger<Gtk4MainWindow>>();
                var lifetime = ServiceProvider.GetService<IHostApplicationLifetime>();

                // Pass the application instance to the main window
                _mainWindow = new Gtk4MainWindow(ServiceProvider, logger, lifetime, _application);

                // Subscribe to window shown event
                Gtk4MainWindow.WindowShown += () => WindowShown?.Invoke();

                // Show the window
                _mainWindow.Show();

                Console.WriteLine("GTK4 main window created and shown");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"ERROR: Failed to create GTK4 main window: {ex.Message}");
                Console.WriteLine($"Stack trace: {ex.StackTrace}");
                throw;
            }
        }
        else if (_mainWindow != null)
        {
            // Window already exists, just show it
            _mainWindow.Show();
        }
        else
        {
            Console.WriteLine("WARNING: Cannot create main window - ServiceProvider is null");
        }
    }

    private void OnShutdown(object sender, EventArgs e)
    {
        Console.WriteLine("GTK4 application shutting down...");
        _mainWindow?.Dispose();
        _mainWindow = null;
    }

    public void Run(string[] args)
    {
        if (_application != null)
        {
            try
            {
                Console.WriteLine("Starting GTK4 application...");
                _application.Run(args.Length, args);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"ERROR: GTK4 application failed to run: {ex.Message}");
                throw;
            }
        }
    }

    public void Quit()
    {
        _application?.Quit();
    }

    public void Dispose()
    {
        if (!_disposed)
        {
            _disposed = true;

            _mainWindow?.Dispose();
            _mainWindow = null;

            // Note: Don't dispose _application as it's managed by GTK
            _application = null;
        }
    }
}

/// <summary>
/// Static helper for GTK4 application management
/// Provides thread-safe access to the GTK4 application instance
/// </summary>
public static class Gtk4ApplicationManager
{
    private static Gtk4OverlayApplication? _instance;
    private static readonly object _lock = new object();
    private static bool _initialized = false;

    public static void Initialize()
    {
        lock (_lock)
        {
            if (!_initialized)
            {
                // Initialize GTK
                Init();
                _initialized = true;
                Console.WriteLine("GTK4 initialized successfully");
            }
        }
    }

    public static Gtk4OverlayApplication GetOrCreateApplication()
    {
        lock (_lock)
        {
            if (_instance == null)
            {
                if (!_initialized)
                {
                    Initialize();
                }
                _instance = new Gtk4OverlayApplication();
            }
            return _instance;
        }
    }

    public static void SetServiceProvider(IServiceProvider serviceProvider)
    {
        lock (_lock)
        {
            var app = GetOrCreateApplication();
            app.ServiceProvider = serviceProvider;
            Gtk4OverlayApplication.GlobalServiceProvider = serviceProvider;
        }
    }

    public static void RunApplication(string[] args)
    {
        var app = GetOrCreateApplication();
        app.Run(args);
    }

    public static void QuitApplication()
    {
        lock (_lock)
        {
            _instance?.Quit();
            _instance?.Dispose();
            _instance = null;
        }
    }
}
