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
    private UpdateService? _updateService;

    // Threading and cancellation
    private CancellationTokenSource? _updateCancellationTokenSource;
    private bool _updateInProgress = false;
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
        _updateService = _serviceProvider.GetService<UpdateService>();

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

        // Update section (only show if running as AppImage)
        if (_updateService?.IsRunningAsAppImage() == true)
        {
            var separator = Separator.New(Orientation.Horizontal);
            vbox.Append(separator);

            var updateLabel = Label.New("AppImage Updates");
            updateLabel.SetMarkup("<b>AppImage Updates</b>");
            vbox.Append(updateLabel);

            var updateBox = Box.New(Orientation.Horizontal, 10);

            var checkUpdateButton = Button.NewWithLabel("🔄 Check for Updates");
            checkUpdateButton.OnClicked += OnCheckForUpdates;
            updateBox.Append(checkUpdateButton);

            var updateButton = Button.NewWithLabel("⬆️ Update AppImage");
            updateButton.OnClicked += OnUpdateAppImage;
            updateButton.SetSensitive(_updateService.IsAppImageUpdateAvailable());
            updateBox.Append(updateButton);

            vbox.Append(updateBox);

            var updateStatusLabel = Label.New("Click 'Check for Updates' to see if a newer version is available");
            updateStatusLabel.SetWrap(true);
            vbox.Append(updateStatusLabel);
        }

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
            // Control MCP only: "click_at - Simulate mouse click",
            // Control MCP only: "type_text - Simulate keyboard input",
            "get_clipboard - Get clipboard content",
            "set_clipboard - Set clipboard content",
            "get_display_info - Get monitor information",
            "set_mode - Change operation mode",
            "batch_overlay - Draw multiple overlays",
            "confirm_action - Request user confirmation",
            "get_overlay_capabilities - Discover overlay features"
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
                // Center the demo overlay on the primary monitor and make it larger for easier testing
                var tempMs = 5000;
                var demoColor = "#AA0000"; // red-ish; opacity handled separately
                var overlayW = 640;
                var overlayH = 360;

                // Hide the control window while demonstrating click-through, then restore
                GLib.Functions.IdleAdd(0, () => { _window?.SetVisible(false); return false; });

                // Run overlay creation asynchronously but don't block the UI
                _ = Task.Run(async () =>
                {
                    try
                    {
                        int x = 100, y = 100;
                        try
                        {
                            var mon = await _screenCaptureService!.GetMonitorInfoAsync(0) ;
                            if (mon != null)
                            {
                                // Fill the entire primary monitor for a clear demo of click-through
                                x = mon.X;
                                y = mon.Y;
                                overlayW = mon.Width;
                                overlayH = mon.Height;
                            }
                        }
                        catch { }

                        var bounds = new Models.ScreenRegion(x, y, overlayW, overlayH);

                        var overlay = new Models.OverlayElement
                        {
                            Bounds = bounds,
                            Color = demoColor,
                            Label = "GTK4 Click-Through Test",
                            TemporaryMs = tempMs,
                            ClickThrough = true,
                            Opacity = 0.5
                        };
                        var overlayId = await _overlayService!.DrawOverlayAsync(overlay);
                        _logger?.LogInformation($"Test overlay created: {overlayId}");
                        Console.WriteLine($"✓ Test overlay requested: {overlayId} at ({bounds.X}, {bounds.Y}) size {bounds.Width}x{bounds.Height}");
                    }
                    catch (Exception ex)
                    {
                        _logger?.LogError(ex, "Failed to create test overlay");
                        Console.WriteLine($"❌ Failed to create test overlay: {ex.Message}");
                    }
                    finally
                    {
                        try
                        {
                            await Task.Delay(tempMs + 250);
                            GLib.Functions.IdleAdd(0, () => { _window?.SetVisible(true); return false; });
                        }
                        catch { }
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

    private async void OnCheckForUpdates(object sender, EventArgs e)
    {
        // Prevent multiple concurrent update checks
        if (_updateInProgress)
        {
            _logger?.LogInformation("Update check already in progress, ignoring request");
            return;
        }

        var button = sender as Button;

        try
        {
            if (_updateService == null)
            {
                _logger?.LogWarning("Update service not available");
                ShowUpdateDialog("Error", "Update service is not available.");
                return;
            }

            // Set up cancellation and UI state
            _updateInProgress = true;
            _updateCancellationTokenSource?.Cancel();
            _updateCancellationTokenSource = new CancellationTokenSource(TimeSpan.FromSeconds(30)); // 30 second timeout

            // Update UI on main thread
            GLib.Functions.IdleAdd(0, () =>
            {
                button?.SetLabel("🔄 Checking...");
                button?.SetSensitive(false);
                return false; // Don't repeat
            });

            _logger?.LogInformation("Starting update check...");

            // Perform update check on background thread
            UpdateInfo? updateInfo = null;
            string? errorMessage = null;

            await Task.Run(async () =>
            {
                try
                {
                    updateInfo = await _updateService.CheckForUpdatesAsync(_updateCancellationTokenSource.Token).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    _logger?.LogWarning("Update check was cancelled due to timeout");
                    errorMessage = "Update check timed out. Please try again.";
                }
                catch (Exception ex)
                {
                    _logger?.LogError(ex, "Update check failed with exception");
                    errorMessage = $"Update check failed: {ex.Message}";
                }
            }, _updateCancellationTokenSource.Token).ConfigureAwait(false);

            // Check if operation was cancelled
            if (_updateCancellationTokenSource.Token.IsCancellationRequested)
            {
                _logger?.LogWarning("Update check was cancelled");
                return;
            }

            // Update UI on main thread
            GLib.Functions.IdleAdd(0, () =>
            {
                try
                {
                    if (errorMessage != null)
                    {
                        ShowUpdateDialog("Update Check Failed", errorMessage);
                    }
                    else if (updateInfo == null)
                    {
                        ShowUpdateDialog("Update Check Failed", "Could not check for updates. Please check your internet connection or try again later.");
                    }
                    else if (updateInfo.UpdateAvailable)
                    {
                        ShowUpdateDialog("Update Available",
                            $"A new version is available!\n\n" +
                            $"Current Version: {updateInfo.CurrentVersion}\n" +
                            $"Latest Version: {updateInfo.LatestVersion}\n\n" +
                            $"Click 'Update AppImage' to install the latest version.");
                    }
                    else
                    {
                        ShowUpdateDialog("Up to Date",
                            $"You are running the latest version ({updateInfo.CurrentVersion}).");
                    }
                }
                catch (Exception ex)
                {
                    _logger?.LogError(ex, "Failed to show update dialog");
                }
                return false; // Don't repeat
            });
        }
        catch (OperationCanceledException)
        {
            _logger?.LogInformation("Update check was cancelled");
            GLib.Functions.IdleAdd(0, () =>
            {
                ShowUpdateDialog("Cancelled", "Update check was cancelled due to timeout.");
                return false;
            });
        }
        catch (Exception ex)
        {
            _logger?.LogError(ex, "Failed to check for updates");
            GLib.Functions.IdleAdd(0, () =>
            {
                ShowUpdateDialog("Error", $"An error occurred while checking for updates: {ex.Message}");
                return false;
            });
        }
        finally
        {
            // Always restore UI state on main thread
            _updateInProgress = false;
            GLib.Functions.IdleAdd(0, () =>
            {
                button?.SetLabel("🔄 Check for Updates");
                button?.SetSensitive(true);
                return false; // Don't repeat
            });
        }
    }

    private async void OnUpdateAppImage(object sender, EventArgs e)
    {
        // Prevent multiple concurrent updates
        if (_updateInProgress)
        {
            _logger?.LogInformation("Update already in progress, ignoring request");
            return;
        }

        var button = sender as Button;

        try
        {
            if (_updateService == null)
            {
                _logger?.LogWarning("Update service not available");
                ShowUpdateDialog("Error", "Update service is not available.");
                return;
            }

            // Set up cancellation and UI state
            _updateInProgress = true;
            _updateCancellationTokenSource?.Cancel();
            _updateCancellationTokenSource = new CancellationTokenSource(TimeSpan.FromMinutes(10)); // 10 minute timeout for updates

            // Update UI on main thread
            GLib.Functions.IdleAdd(0, () =>
            {
                button?.SetLabel("⬆️ Updating...");
                button?.SetSensitive(false);
                return false;
            });

            _logger?.LogInformation("Starting AppImage update...");

            // Check AppImageUpdate availability first
            if (!_updateService.IsAppImageUpdateAvailable())
            {
                GLib.Functions.IdleAdd(0, () =>
                {
                    ShowUpdateDialog("AppImageUpdate Required",
                        "AppImageUpdate is not installed. Please install it first:\n\n" +
                        "For Fedora: Download from https://github.com/AppImage/AppImageUpdate/releases\n" +
                        "For Ubuntu/Debian: sudo apt install appimageupdate\n\n" +
                        "Or use the built-in update checker instead.");
                    return false;
                });
                return;
            }

            // Perform update on background thread
            var success = await Task.Run(async () =>
            {
                try
                {
                    return await _updateService.UpdateAppImageAsync().ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    _logger?.LogWarning("AppImage update was cancelled due to timeout");
                    return false;
                }
            }, _updateCancellationTokenSource.Token).ConfigureAwait(false);

            // Check if operation was cancelled
            if (_updateCancellationTokenSource.Token.IsCancellationRequested)
            {
                _logger?.LogWarning("AppImage update was cancelled");
                return;
            }

            // Update UI on main thread
            GLib.Functions.IdleAdd(0, () =>
            {
                try
                {
                    if (success)
                    {
                        ShowUpdateDialog("Update Complete",
                            "AppImage updated successfully!\n\n" +
                            "Please restart the application to use the new version.");
                    }
                    else
                    {
                        ShowUpdateDialog("Update Failed",
                            "Failed to update AppImage. Please check the logs for more details or try updating manually.");
                    }
                }
                catch (Exception ex)
                {
                    _logger?.LogError(ex, "Failed to show update result dialog");
                }
                return false;
            });
        }
        catch (OperationCanceledException)
        {
            _logger?.LogInformation("AppImage update was cancelled");
            GLib.Functions.IdleAdd(0, () =>
            {
                ShowUpdateDialog("Cancelled", "AppImage update was cancelled due to timeout.");
                return false;
            });
        }
        catch (Exception ex)
        {
            _logger?.LogError(ex, "Failed to update AppImage");
            GLib.Functions.IdleAdd(0, () =>
            {
                ShowUpdateDialog("Error", $"An error occurred while updating the AppImage: {ex.Message}");
                return false;
            });
        }
        finally
        {
            // Always restore UI state on main thread
            _updateInProgress = false;
            GLib.Functions.IdleAdd(0, () =>
            {
                button?.SetLabel("⬆️ Update AppImage");
                button?.SetSensitive(true);
                return false;
            });
        }
    }

    private void ShowUpdateDialog(string title, string message)
    {
        try
        {
            var dialog = Dialog.New();
            dialog.SetTitle(title);
            dialog.SetTransientFor(_window);
            dialog.SetModal(true);
            dialog.SetDefaultSize(400, 200);

            var vbox = Box.New(Orientation.Vertical, 10);
            vbox.SetMarginTop(20);
            vbox.SetMarginBottom(20);
            vbox.SetMarginStart(20);
            vbox.SetMarginEnd(20);

            var messageLabel = Label.New(message);
            messageLabel.SetWrap(true);
            messageLabel.SetJustify(Justification.Left);
            vbox.Append(messageLabel);

            var buttonBox = Box.New(Orientation.Horizontal, 10);
            buttonBox.SetHalign(Align.End);

            var okButton = Button.NewWithLabel("OK");
            okButton.OnClicked += (s, args) => dialog.Close();
            buttonBox.Append(okButton);

            vbox.Append(buttonBox);
            dialog.SetChild(vbox);
            dialog.Show();
        }
        catch (Exception ex)
        {
            _logger?.LogError(ex, "Failed to show update dialog");
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

            // Cancel any ongoing update operations
            _updateCancellationTokenSource?.Cancel();
            _updateCancellationTokenSource?.Dispose();
            _updateCancellationTokenSource = null;

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
