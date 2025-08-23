using Gtk;
using static GLib.Functions;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using OverlayCompanion.Services;
using System;
using System.Threading.Tasks;

namespace OverlayCompanion.UI;

/// <summary>
/// GTK4-based main window implementation
/// Provides 4-tab interface (Screenshot, Overlay, Settings, MCP) with native GTK4 controls
/// </summary>
public class Gtk4MainWindow : IDisposable
{
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<Gtk4MainWindow>? _logger;
    private readonly IHostApplicationLifetime? _applicationLifetime;
    private readonly Gtk.Application? _gtkApplication;

    private Gtk.ApplicationWindow? _window;
    private Gtk.Notebook? _notebook;
    private bool _disposed = false;
    private bool _serverRunning = false;

    // Services
    private IScreenCaptureService? _screenCaptureService;
    private IOverlayService? _overlayService;
    private IModeManager? _modeManager;

    // UI Controls for different tabs
    private Gtk.Label? _serverStatusLabel;
    private Gtk.Button? _startStopButton;
    private Gtk.Entry? _portEntry;
    private Gtk.Entry? _hostEntry;
    private Gtk.TextView? _logTextView;
    private Gtk.ListBox? _toolsListBox;

    public static event System.Action? WindowShown;

    public Gtk4MainWindow(IServiceProvider serviceProvider, ILogger<Gtk4MainWindow>? logger, IHostApplicationLifetime? applicationLifetime, Gtk.Application? gtkApplication = null)
    {
        _serviceProvider = serviceProvider;
        _logger = logger;
        _applicationLifetime = applicationLifetime;
        _gtkApplication = gtkApplication;

        // Get services
        _screenCaptureService = _serviceProvider.GetService<IScreenCaptureService>();
        _overlayService = _serviceProvider.GetService<IOverlayService>();
        _modeManager = _serviceProvider.GetService<IModeManager>();

        InitializeWindow();
    }

    private void InitializeWindow()
    {
        // Use the provided GTK application instance, or fall back to the static instance
        var gtkApp = _gtkApplication ?? Gtk4Application.Instance;
        
        // Create main application window using the correct application instance
        _window = Gtk.ApplicationWindow.New(gtkApp);
        _window.SetTitle("Overlay Companion MCP Server");
        _window.SetDefaultSize(800, 600);

        // Create notebook (tabbed interface)
        _notebook = Notebook.New();
        _notebook.SetScrollable(true);

        // Create tabs
        CreateScreenshotTab();
        CreateOverlayTab();
        CreateSettingsTab();
        CreateMcpTab();

        // Set notebook as main content
        _window.SetChild(_notebook);

        // Handle window events
        _window.OnCloseRequest += OnCloseRequest;
        _window.OnShow += OnWindowShow;

        _logger?.LogInformation("GTK4 main window initialized");
    }

    private void CreateScreenshotTab()
    {
        var vbox = Box.New(Orientation.Vertical, 10);
        vbox.SetMarginTop(10);
        vbox.SetMarginBottom(10);
        vbox.SetMarginStart(10);
        vbox.SetMarginEnd(10);

        // Title
        var titleLabel = Label.New("Screenshot Capture");
        titleLabel.SetMarkup("<b>Screenshot Capture</b>");
        vbox.Append(titleLabel);

        // Screenshot controls
        var screenshotButton = Button.NewWithLabel("Take Screenshot");
        screenshotButton.OnClicked += OnTakeScreenshot;
        vbox.Append(screenshotButton);

        var regionButton = Button.NewWithLabel("Capture Region");
        regionButton.OnClicked += OnCaptureRegion;
        vbox.Append(regionButton);

        // Status
        var statusLabel = Label.New("Ready to capture screenshots");
        vbox.Append(statusLabel);

        // Add tab
        var tabLabel = Label.New("Screenshot");
        _notebook?.AppendPage(vbox, tabLabel);
    }

    private void CreateOverlayTab()
    {
        var vbox = Box.New(Orientation.Vertical, 10);
        vbox.SetMarginTop(10);
        vbox.SetMarginBottom(10);
        vbox.SetMarginStart(10);
        vbox.SetMarginEnd(10);

        // Title
        var titleLabel = Label.New("Overlay Management");
        titleLabel.SetMarkup("<b>Overlay Management</b>");
        vbox.Append(titleLabel);

        // Overlay controls
        var testOverlayButton = Button.NewWithLabel("Test Click-Through Overlay");
        testOverlayButton.OnClicked += OnTestOverlay;
        vbox.Append(testOverlayButton);

        var clearOverlaysButton = Button.NewWithLabel("Clear All Overlays");
        clearOverlaysButton.OnClicked += OnClearOverlays;
        vbox.Append(clearOverlaysButton);

        // Click-through status
        var clickThroughLabel = Label.New("✓ GTK4 provides true OS-level click-through on Wayland");
        clickThroughLabel.SetMarkup("<span color='green'>✓ GTK4 provides true OS-level click-through on Wayland</span>");
        vbox.Append(clickThroughLabel);

        // Add tab
        var tabLabel = Label.New("Overlay");
        _notebook?.AppendPage(vbox, tabLabel);
    }

    private void CreateSettingsTab()
    {
        var vbox = Box.New(Orientation.Vertical, 10);
        vbox.SetMarginTop(10);
        vbox.SetMarginBottom(10);
        vbox.SetMarginStart(10);
        vbox.SetMarginEnd(10);

        // Title
        var titleLabel = Label.New("Server Settings");
        titleLabel.SetMarkup("<b>Server Settings</b>");
        vbox.Append(titleLabel);

        // Server controls
        var serverBox = Box.New(Orientation.Horizontal, 10);

        _startStopButton = Button.NewWithLabel("Start Server");
        _startStopButton.OnClicked += OnStartStopServer;
        serverBox.Append(_startStopButton);

        _serverStatusLabel = Label.New("Server Stopped");
        serverBox.Append(_serverStatusLabel);

        vbox.Append(serverBox);

        // Host/Port settings
        var hostBox = Box.New(Orientation.Horizontal, 10);
        hostBox.Append(Label.New("Host:"));
        _hostEntry = Entry.New();
        _hostEntry.SetText("localhost");
        hostBox.Append(_hostEntry);
        vbox.Append(hostBox);

        var portBox = Box.New(Orientation.Horizontal, 10);
        portBox.Append(Label.New("Port:"));
        _portEntry = Entry.New();
        _portEntry.SetText("3000");
        portBox.Append(_portEntry);
        vbox.Append(portBox);

        // Add tab
        var tabLabel = Label.New("Settings");
        _notebook?.AppendPage(vbox, tabLabel);
    }

    private void CreateMcpTab()
    {
        var vbox = Box.New(Orientation.Vertical, 10);
        vbox.SetMarginTop(10);
        vbox.SetMarginBottom(10);
        vbox.SetMarginStart(10);
        vbox.SetMarginEnd(10);

        // Title
        var titleLabel = Label.New("MCP Server Status");
        titleLabel.SetMarkup("<b>MCP Server Status</b>");
        vbox.Append(titleLabel);

        // Configuration button
        var configButton = Button.NewWithLabel("📋 Copy Configuration JSON");
        configButton.OnClicked += OnShowConfiguration;
        vbox.Append(configButton);

        // Tools list
        var toolsLabel = Label.New("Available MCP Tools:");
        vbox.Append(toolsLabel);

        _toolsListBox = ListBox.New();
        var scrolledWindow = ScrolledWindow.New();
        scrolledWindow.SetChild(_toolsListBox);
        scrolledWindow.SetSizeRequest(-1, 200);
        vbox.Append(scrolledWindow);

        // Populate tools list
        PopulateToolsList();

        // Log area
        var logLabel = Label.New("Server Logs:");
        vbox.Append(logLabel);

        _logTextView = TextView.New();
        _logTextView.SetEditable(false);
        var logScrolled = ScrolledWindow.New();
        logScrolled.SetChild(_logTextView);
        logScrolled.SetSizeRequest(-1, 150);
        vbox.Append(logScrolled);

        // Add tab
        var tabLabel = Label.New("MCP");
        _notebook?.AppendPage(vbox, tabLabel);
    }

    private void PopulateToolsList()
    {
        if (_toolsListBox == null) return;

        var tools = new[]
        {
            "take_screenshot - Capture screen or region",
            "draw_overlay - Draw overlay on screen",
            "remove_overlay - Remove specific overlay",
            "clear_overlays - Clear all overlays",
            "click_at - Simulate mouse click",
            "type_text - Simulate keyboard input",
            "get_clipboard - Get clipboard content",
            "set_clipboard - Set clipboard content",
            "get_display_info - Get monitor information",
            "set_mode - Change operation mode",
            "batch_overlay - Draw multiple overlays",
            "confirm_action - Request user confirmation"
        };

        foreach (var tool in tools)
        {
            var row = ListBoxRow.New();
            var label = Label.New(tool);
            label.SetXalign(0.0f); // Left align
            row.SetChild(label);
            _toolsListBox.Append(row);
        }
    }

    // Event handlers
    private void OnWindowShow(object sender, EventArgs e)
    {
        _logger?.LogInformation("GTK4 main window shown");
        WindowShown?.Invoke();
    }

    private bool OnCloseRequest(object sender, EventArgs e)
    {
        _logger?.LogInformation("GTK4 main window close requested");
        _applicationLifetime?.StopApplication();
        return false; // Allow close
    }

    private void OnTakeScreenshot(object sender, EventArgs e)
    {
        _ = Task.Run(async () =>
        {
            try
            {
                if (_screenCaptureService != null)
                {
                    var screenshot = await _screenCaptureService.CaptureScreenAsync();
                    _logger?.LogInformation($"Screenshot captured: {screenshot.Width}x{screenshot.Height}");

                    // Update UI on main thread
                    GLib.Functions.IdleAdd(0, () =>
                    {
                        // Could show a notification or update status
                        return false;
                    });
                }
            }
            catch (Exception ex)
            {
                _logger?.LogError(ex, "Failed to capture screenshot");
            }
        });
    }

    private void OnCaptureRegion(object sender, EventArgs e)
    {
        _logger?.LogInformation("Region capture requested (not implemented yet)");
    }

    private void OnTestOverlay(object sender, EventArgs e)
    {
        try
        {
            if (_overlayService != null)
            {
                // Create overlay on main thread since GTK operations need to be on main thread
                var bounds = new Models.ScreenRegion(100, 100, 200, 100);
                
                // Run overlay creation asynchronously but don't block the UI
                _ = Task.Run(async () =>
                {
                    try
                    {
                        var overlayId = await _overlayService.DrawOverlayAsync(bounds, "Red", "GTK4 Click-Through Test", 5000, true);
                        _logger?.LogInformation($"Test overlay created: {overlayId}");
                        Console.WriteLine($"✓ Test overlay requested: {overlayId} at ({bounds.X}, {bounds.Y}) size {bounds.Width}x{bounds.Height}");
                    }
                    catch (Exception ex)
                    {
                        _logger?.LogError(ex, "Failed to create test overlay");
                        Console.WriteLine($"❌ Failed to create test overlay: {ex.Message}");
                    }
                });
            }
            else
            {
                _logger?.LogWarning("Overlay service not available");
                Console.WriteLine("⚠️ Overlay service not available");
            }
        }
        catch (Exception ex)
        {
            _logger?.LogError(ex, "Failed to initiate test overlay");
            Console.WriteLine($"❌ Failed to initiate test overlay: {ex.Message}");
        }
    }

    private void OnClearOverlays(object sender, EventArgs e)
    {
        _ = Task.Run(async () =>
        {
            try
            {
                if (_overlayService != null)
                {
                    await _overlayService.ClearAllOverlaysAsync();
                    _logger?.LogInformation("All overlays cleared");
                }
            }
            catch (Exception ex)
            {
                _logger?.LogError(ex, "Failed to clear overlays");
            }
        });
    }

    private void OnStartStopServer(object sender, EventArgs e)
    {
        _serverRunning = !_serverRunning;

        if (_startStopButton != null && _serverStatusLabel != null)
        {
            if (_serverRunning)
            {
                _startStopButton.SetLabel("Stop Server");
                _serverStatusLabel.SetText("Server Running");
                _serverStatusLabel.SetMarkup("<span color='green'>Server Running</span>");
            }
            else
            {
                _startStopButton.SetLabel("Start Server");
                _serverStatusLabel.SetText("Server Stopped");
                _serverStatusLabel.SetMarkup("<span color='red'>Server Stopped</span>");
            }
        }

        _logger?.LogInformation($"Server {(_serverRunning ? "started" : "stopped")}");
    }

    private void OnShowConfiguration(object sender, EventArgs e)
    {
        try
        {
            // Get the configuration JSON from Program.cs helper method
            var configJson = OverlayCompanion.Program.GetMcpConfigurationJson();
            
            // Create a dialog to show the configuration
            var dialog = new Gtk.Dialog();
            dialog.SetTitle("MCP Configuration for Cherry Studio");
            dialog.SetDefaultSize(600, 400);
            dialog.SetModal(true);
            dialog.SetTransientFor(_window);

            // Create content area
            var vbox = Box.New(Orientation.Vertical, 10);
            vbox.SetMarginTop(10);
            vbox.SetMarginBottom(10);
            vbox.SetMarginStart(10);
            vbox.SetMarginEnd(10);

            // Title
            var titleLabel = Label.New("Copy this configuration to Cherry Studio:");
            titleLabel.SetMarkup("<b>Copy this configuration to Cherry Studio:</b>");
            vbox.Append(titleLabel);

            // Instructions
            var instructionsLabel = Label.New("1. Copy the JSON below\n2. Open Cherry Studio\n3. Go to MCP Server settings\n4. Paste the configuration");
            instructionsLabel.SetXalign(0.0f);
            vbox.Append(instructionsLabel);

            // JSON text view
            var textView = TextView.New();
            var buffer = textView.GetBuffer();
            buffer.SetText(configJson, -1);
            textView.SetEditable(false);
            textView.SetMonospace(true);

            var scrolled = ScrolledWindow.New();
            scrolled.SetChild(textView);
            scrolled.SetSizeRequest(550, 250);
            vbox.Append(scrolled);

            // Buttons
            var buttonBox = Box.New(Orientation.Horizontal, 10);
            buttonBox.SetHalign(Align.End);

            var copyButton = Button.NewWithLabel("📋 Copy to Clipboard");
            copyButton.OnClicked += (s, args) =>
            {
                try
                {
                    // Copy to clipboard using GDK
                    var display = _window?.GetDisplay();
                    if (display != null)
                    {
                        var clipboard = display.GetClipboard();
                        clipboard.SetText(configJson);
                        
                        // Show success message
                        copyButton.SetLabel("✅ Copied!");
                        GLib.Functions.TimeoutAdd(0, 2000, () =>
                        {
                            copyButton.SetLabel("📋 Copy to Clipboard");
                            return false;
                        });
                    }
                }
                catch (Exception ex)
                {
                    _logger?.LogError(ex, "Failed to copy to clipboard");
                    copyButton.SetLabel("❌ Copy Failed");
                    GLib.Functions.TimeoutAdd(0, 2000, () =>
                    {
                        copyButton.SetLabel("📋 Copy to Clipboard");
                        return false;
                    });
                }
            };

            var closeButton = Button.NewWithLabel("Close");
            closeButton.OnClicked += (s, args) => dialog.Close();

            buttonBox.Append(copyButton);
            buttonBox.Append(closeButton);
            vbox.Append(buttonBox);

            // Set the dialog content
            dialog.SetChild(vbox);
            dialog.Show();
        }
        catch (Exception ex)
        {
            _logger?.LogError(ex, "Failed to show configuration dialog");
        }
    }

    public void Show()
    {
        _window?.SetVisible(true);
    }

    public void Hide()
    {
        _window?.SetVisible(false);
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

            _notebook = null;
            _serverStatusLabel = null;
            _startStopButton = null;
            _portEntry = null;
            _hostEntry = null;
            _logTextView = null;
            _toolsListBox = null;
        }
    }
}
