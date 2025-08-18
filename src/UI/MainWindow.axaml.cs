using Avalonia.Controls;
using Avalonia.Interactivity;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using OverlayCompanion.Services;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace OverlayCompanion.UI;

public partial class MainWindow : Window
{
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<MainWindow> _logger;
    private readonly IHostApplicationLifetime _applicationLifetime;
    private bool _serverRunning = false;

    // UI Controls
    private TextBox? _portTextBox;
    private TextBox? _hostTextBox;
    private CheckBox? _autoStartCheckBox;
    private ComboBox? _defaultModeComboBox;
    private CheckBox? _requireConfirmationCheckBox;
    private CheckBox? _allowScreenshotsCheckBox;
    private CheckBox? _allowInputSimulationCheckBox;
    private CheckBox? _allowClipboardAccessCheckBox;
    private TextBlock? _serverStatusText;
    private TextBlock? _serverAddressText;
    private TextBlock? _activeModeText;
    private TextBlock? _connectedClientsText;
    private ListBox? _toolsListBox;
    private TextBox? _logTextBox;
    private ScrollViewer? _logScrollViewer;
    private CheckBox? _autoScrollCheckBox;
    private ComboBox? _logLevelComboBox;
    private Button? _startStopButton;
    private Button? _saveSettingsButton;
    private Button? _exitButton;
    private Button? _clearLogsButton;
    private ComboBox? _configFormatComboBox;
    private ComboBox? _transportTypeComboBox;
    private TextBox? _mcpConfigTextBox;
    private Button? _refreshConfigButton;
    private Button? _copyConfigButton;
    private Button? _saveConfigButton;
    private Button? _testConnectionButton;

    public MainWindow(IServiceProvider serviceProvider, ILogger<MainWindow> logger, IHostApplicationLifetime applicationLifetime)
    {
        _serviceProvider = serviceProvider;
        _logger = logger;
        _applicationLifetime = applicationLifetime;
        
        InitializeComponent();
        InitializeControls();
        LoadSettings();
        PopulateToolsList();
        
        _logger.LogInformation("Main window initialized");
    }

    private void InitializeControls()
    {
        // Get references to named controls
        _portTextBox = this.FindControl<TextBox>("PortTextBox");
        _hostTextBox = this.FindControl<TextBox>("HostTextBox");
        _autoStartCheckBox = this.FindControl<CheckBox>("AutoStartCheckBox");
        _defaultModeComboBox = this.FindControl<ComboBox>("DefaultModeComboBox");
        _requireConfirmationCheckBox = this.FindControl<CheckBox>("RequireConfirmationCheckBox");
        _allowScreenshotsCheckBox = this.FindControl<CheckBox>("AllowScreenshotsCheckBox");
        _allowInputSimulationCheckBox = this.FindControl<CheckBox>("AllowInputSimulationCheckBox");
        _allowClipboardAccessCheckBox = this.FindControl<CheckBox>("AllowClipboardAccessCheckBox");
        _serverStatusText = this.FindControl<TextBlock>("ServerStatusText");
        _serverAddressText = this.FindControl<TextBlock>("ServerAddressText");
        _activeModeText = this.FindControl<TextBlock>("ActiveModeText");
        _connectedClientsText = this.FindControl<TextBlock>("ConnectedClientsText");
        _toolsListBox = this.FindControl<ListBox>("ToolsListBox");
        _logTextBox = this.FindControl<TextBox>("LogTextBox");
        _logScrollViewer = this.FindControl<ScrollViewer>("LogScrollViewer");
        _autoScrollCheckBox = this.FindControl<CheckBox>("AutoScrollCheckBox");
        _logLevelComboBox = this.FindControl<ComboBox>("LogLevelComboBox");
        _startStopButton = this.FindControl<Button>("StartStopButton");
        _saveSettingsButton = this.FindControl<Button>("SaveSettingsButton");
        _exitButton = this.FindControl<Button>("ExitButton");
        _clearLogsButton = this.FindControl<Button>("ClearLogsButton");
        _configFormatComboBox = this.FindControl<ComboBox>("ConfigFormatComboBox");
        _transportTypeComboBox = this.FindControl<ComboBox>("TransportTypeComboBox");
        _mcpConfigTextBox = this.FindControl<TextBox>("McpConfigTextBox");
        _refreshConfigButton = this.FindControl<Button>("RefreshConfigButton");
        _copyConfigButton = this.FindControl<Button>("CopyConfigButton");
        _saveConfigButton = this.FindControl<Button>("SaveConfigButton");
        _testConnectionButton = this.FindControl<Button>("TestConnectionButton");

        // Wire up event handlers
        if (_startStopButton != null)
            _startStopButton.Click += OnStartStopClicked;
        if (_saveSettingsButton != null)
            _saveSettingsButton.Click += OnSaveSettingsClicked;
        if (_exitButton != null)
            _exitButton.Click += OnExitClicked;
        if (_clearLogsButton != null)
            _clearLogsButton.Click += OnClearLogsClicked;
        if (_refreshConfigButton != null)
            _refreshConfigButton.Click += OnRefreshConfigClicked;
        if (_copyConfigButton != null)
            _copyConfigButton.Click += OnCopyConfigClicked;
        if (_saveConfigButton != null)
            _saveConfigButton.Click += OnSaveConfigClicked;
        if (_testConnectionButton != null)
            _testConnectionButton.Click += OnTestConnectionClicked;
        if (_configFormatComboBox != null)
            _configFormatComboBox.SelectionChanged += OnConfigFormatChanged;
        if (_transportTypeComboBox != null)
            _transportTypeComboBox.SelectionChanged += OnTransportTypeChanged;
    }

    private void LoadSettings()
    {
        // Load settings from configuration or defaults
        if (_portTextBox != null) _portTextBox.Text = "3000";
        if (_hostTextBox != null) _hostTextBox.Text = "localhost";
        if (_autoStartCheckBox != null) _autoStartCheckBox.IsChecked = true;
        if (_defaultModeComboBox != null) _defaultModeComboBox.SelectedIndex = 0; // Passive
        if (_requireConfirmationCheckBox != null) _requireConfirmationCheckBox.IsChecked = true;
        if (_allowScreenshotsCheckBox != null) _allowScreenshotsCheckBox.IsChecked = true;
        if (_allowInputSimulationCheckBox != null) _allowInputSimulationCheckBox.IsChecked = false;
        if (_allowClipboardAccessCheckBox != null) _allowClipboardAccessCheckBox.IsChecked = false;

        UpdateServerStatus();
        UpdateMcpConfiguration();
    }

    private void PopulateToolsList()
    {
        if (_toolsListBox == null) return;

        var tools = new List<string>
        {
            "take_screenshot - Capture screen regions",
            "draw_overlay - Draw overlay boxes",
            "remove_overlay - Remove overlay boxes",
            "click_at - Simulate mouse clicks",
            "type_text - Simulate keyboard input",
            "set_mode - Change operational mode",
            "get_clipboard - Read clipboard content",
            "set_clipboard - Write clipboard content",
            "batch_overlay - Draw multiple overlays",
            "set_screenshot_frequency - Configure screenshot timing",
            "subscribe_events - Subscribe to UI events",
            "unsubscribe_events - Unsubscribe from events"
        };

        _toolsListBox.ItemsSource = tools;
    }

    private void UpdateServerStatus()
    {
        if (_serverStatusText != null)
        {
            _serverStatusText.Text = _serverRunning ? "Running" : "Stopped";
            _serverStatusText.Foreground = _serverRunning ? 
                Avalonia.Media.Brushes.Green : Avalonia.Media.Brushes.Red;
        }

        if (_serverAddressText != null)
        {
            _serverAddressText.Text = _serverRunning ? 
                $"http://{_hostTextBox?.Text ?? "localhost"}:{_portTextBox?.Text ?? "3000"}" : 
                "Not running";
        }

        if (_startStopButton != null)
        {
            _startStopButton.Content = _serverRunning ? "Stop Server" : "Start Server";
        }
    }

    private async void OnStartStopClicked(object? sender, RoutedEventArgs e)
    {
        try
        {
            if (_serverRunning)
            {
                await StopServer();
            }
            else
            {
                await StartServer();
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error starting/stopping server");
            LogMessage($"Error: {ex.Message}");
        }
    }

    private async Task StartServer()
    {
        LogMessage("Starting MCP server...");
        
        // Validate port
        if (!int.TryParse(_portTextBox?.Text, out int port) || port < 1 || port > 65535)
        {
            LogMessage("Error: Invalid port number");
            return;
        }

        // TODO: Actually start the MCP server with the configured settings
        // For now, simulate starting
        await Task.Delay(1000);
        
        _serverRunning = true;
        UpdateServerStatus();
        LogMessage($"MCP server started on {_hostTextBox?.Text}:{port}");
    }

    private async Task StopServer()
    {
        LogMessage("Stopping MCP server...");
        
        // TODO: Actually stop the MCP server
        // For now, simulate stopping
        await Task.Delay(500);
        
        _serverRunning = false;
        UpdateServerStatus();
        LogMessage("MCP server stopped");
    }

    private void OnSaveSettingsClicked(object? sender, RoutedEventArgs e)
    {
        try
        {
            // TODO: Save settings to configuration file
            LogMessage("Settings saved");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error saving settings");
            LogMessage($"Error saving settings: {ex.Message}");
        }
    }

    private void OnExitClicked(object? sender, RoutedEventArgs e)
    {
        _applicationLifetime.StopApplication();
    }

    private void OnClearLogsClicked(object? sender, RoutedEventArgs e)
    {
        if (_logTextBox != null)
        {
            _logTextBox.Text = "";
        }
    }

    private void LogMessage(string message)
    {
        if (_logTextBox == null) return;

        var timestamp = DateTime.Now.ToString("HH:mm:ss");
        var logEntry = $"[{timestamp}] {message}\n";
        
        _logTextBox.Text += logEntry;

        // Auto-scroll if enabled
        if (_autoScrollCheckBox?.IsChecked == true && _logScrollViewer != null)
        {
            _logScrollViewer.ScrollToEnd();
        }
    }

    protected override void OnClosed(EventArgs e)
    {
        if (_serverRunning)
        {
            // Stop server before closing
            _ = Task.Run(StopServer);
        }
        
        base.OnClosed(e);
    }

    #region MCP Configuration Methods

    private void UpdateMcpConfiguration()
    {
        if (_mcpConfigTextBox == null || _configFormatComboBox == null || _transportTypeComboBox == null) return;

        var host = _hostTextBox?.Text ?? "localhost";
        var port = _portTextBox?.Text ?? "3000";
        var selectedFormat = _configFormatComboBox.SelectedIndex;
        var selectedTransport = _transportTypeComboBox.SelectedIndex; // 0 = stdio, 1 = http

        string config = selectedFormat switch
        {
            0 => GenerateJanAiConfig(host, port, selectedTransport),
            1 => GenerateClaudeDesktopConfig(host, port, selectedTransport),
            2 => GenerateRawJsonConfig(host, port, selectedTransport),
            3 => GenerateEnvironmentVariables(host, port, selectedTransport),
            _ => GenerateJanAiConfig(host, port, selectedTransport)
        };

        _mcpConfigTextBox.Text = config;
    }

    private string GenerateJanAiConfig(string host, string port, int transportType)
    {
        if (transportType == 1) // HTTP bridge (segmented deployment)
        {
            return $@"{{
  ""mcpServers"": {{
    ""overlay-companion-bridge"": {{
      ""command"": ""http"",
      ""args"": [
        ""http://{host}:{port}/mcp""
      ],
      ""env"": {{}},
      ""description"": ""Overlay Companion MCP - Segmented deployment via HTTP bridge"",
      ""disabled"": false
    }}
  }}
}}

Instructions for Jan.ai (HTTP Bridge - Segmented Deployment):
1. Start the HTTP bridge with: dotnet run --http
2. Copy the above JSON configuration
3. Open Jan.ai settings
4. Navigate to 'Extensions' > 'Model Context Protocol'
5. Click 'Add MCP Server'
6. Paste the configuration
7. Save and restart Jan.ai

Architecture: Jan.ai → HTTP → Bridge → stdio → MCP Server
Benefits: System segmentation, network isolation, remote deployment
Use Case: Risk-averse deployments, enterprise environments";
        }
        else // stdio transport (default, direct)
        {
            var executablePath = System.Reflection.Assembly.GetExecutingAssembly().Location;
            var projectPath = System.IO.Path.GetDirectoryName(executablePath);
            
            return $@"{{
  ""mcpServers"": {{
    ""overlay-companion"": {{
      ""command"": ""dotnet"",
      ""args"": [
        ""run"",
        ""--project"",
        ""{projectPath}/OverlayCompanion.csproj""
      ],
      ""env"": {{}},
      ""description"": ""Overlay Companion MCP - Direct stdio transport"",
      ""disabled"": false
    }}
  }}
}}

Instructions for Jan.ai (stdio - Direct Transport):
1. Copy the above JSON configuration
2. Open Jan.ai settings
3. Navigate to 'Extensions' > 'Model Context Protocol'
4. Click 'Add MCP Server'
5. Paste the configuration
6. Save and restart Jan.ai

Architecture: Jan.ai → stdio → MCP Server (direct)
Benefits: Minimal latency, standard MCP transport
Use Case: Direct integration, development, testing";
        }
    }

    private string GenerateClaudeDesktopConfig(string host, string port, int transportType)
    {
        // Get the current executable path for stdio transport
        var executablePath = System.Reflection.Assembly.GetExecutingAssembly().Location;
        var projectPath = System.IO.Path.GetDirectoryName(executablePath);
        
        return $@"{{
  ""mcpServers"": {{
    ""overlay-companion"": {{
      ""command"": ""dotnet"",
      ""args"": [
        ""run"",
        ""--project"",
        ""{projectPath}/OverlayCompanion.csproj""
      ],
      ""env"": {{}}
    }}
  }}
}}

Instructions for Claude Desktop:
1. Copy the above JSON configuration
2. Open Claude Desktop settings
3. Find the MCP servers configuration file:
   - Windows: %APPDATA%\\Claude\\claude_desktop_config.json
   - macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
   - Linux: ~/.config/claude/claude_desktop_config.json
4. Add the configuration to the file
5. Restart Claude Desktop

Note: This uses stdio transport (standard for MCP servers)";
    }

    private string GenerateRawJsonConfig(string host, string port, int transportType)
    {
        return $@"{{
  ""name"": ""overlay-companion-mcp"",
  ""version"": ""1.0.0"",
  ""description"": ""Overlay Companion MCP Server - Screen interaction toolkit"",
  ""connection"": {{
    ""type"": ""stdio"",
    ""command"": ""dotnet"",
    ""args"": [
      ""run"",
      ""--project"",
      ""/workspace/project/overlay-companion-mcp/src/OverlayCompanion.csproj""
    ],
    ""env"": {{}}
  }},
  ""capabilities"": {{
    ""tools"": [
      ""take_screenshot"",
      ""draw_overlay"",
      ""remove_overlay"",
      ""click_at"",
      ""type_text"",
      ""set_mode"",
      ""get_clipboard"",
      ""set_clipboard"",
      ""batch_overlay"",
      ""set_screenshot_frequency"",
      ""subscribe_events"",
      ""unsubscribe_events""
    ]
  }},
  ""security"": {{
    ""require_confirmation"": {(_requireConfirmationCheckBox?.IsChecked == true ? "true" : "false")},
    ""allow_screenshots"": {(_allowScreenshotsCheckBox?.IsChecked == true ? "true" : "false")},
    ""allow_input_simulation"": {(_allowInputSimulationCheckBox?.IsChecked == true ? "true" : "false")},
    ""allow_clipboard_access"": {(_allowClipboardAccessCheckBox?.IsChecked == true ? "true" : "false")}
  }}
}}";
    }

    private string GenerateEnvironmentVariables(string host, string port, int transportType)
    {
        return $@"# Environment Variables for MCP Client Configuration
export MCP_SERVER_OVERLAY_COMPANION_COMMAND=""dotnet""
export MCP_SERVER_OVERLAY_COMPANION_ARGS=""run --project /workspace/project/overlay-companion-mcp/src/OverlayCompanion.csproj""
export MCP_SERVER_OVERLAY_COMPANION_NAME=""overlay-companion""
export MCP_SERVER_OVERLAY_COMPANION_DESCRIPTION=""Screen interaction toolkit""

# Security Settings
export MCP_OVERLAY_REQUIRE_CONFIRMATION=""{(_requireConfirmationCheckBox?.IsChecked == true ? "true" : "false")}""
export MCP_OVERLAY_ALLOW_SCREENSHOTS=""{(_allowScreenshotsCheckBox?.IsChecked == true ? "true" : "false")}""
export MCP_OVERLAY_ALLOW_INPUT_SIMULATION=""{(_allowInputSimulationCheckBox?.IsChecked == true ? "true" : "false")}""
export MCP_OVERLAY_ALLOW_CLIPBOARD_ACCESS=""{(_allowClipboardAccessCheckBox?.IsChecked == true ? "true" : "false")}""

# Note: MCP servers use stdio transport, not HTTP
# curl -X POST $MCP_SERVER_OVERLAY_COMPANION_URL \
#   -H ""Content-Type: application/json"" \
#   -d '{{""method"": ""tools/list"", ""params"": {{}}}}'";
    }

    private void OnConfigFormatChanged(object? sender, Avalonia.Controls.SelectionChangedEventArgs e)
    {
        UpdateMcpConfiguration();
    }

    private void OnTransportTypeChanged(object? sender, Avalonia.Controls.SelectionChangedEventArgs e)
    {
        UpdateMcpConfiguration();
    }

    private void OnRefreshConfigClicked(object? sender, RoutedEventArgs e)
    {
        UpdateMcpConfiguration();
        LogMessage("MCP configuration refreshed");
    }

    private async void OnCopyConfigClicked(object? sender, RoutedEventArgs e)
    {
        try
        {
            if (_mcpConfigTextBox?.Text != null)
            {
                var clipboard = TopLevel.GetTopLevel(this)?.Clipboard;
                if (clipboard != null)
                {
                    await clipboard.SetTextAsync(_mcpConfigTextBox.Text);
                    LogMessage("MCP configuration copied to clipboard");
                }
            }
        }
        catch (Exception ex)
        {
            _logger?.LogError(ex, "Error copying configuration to clipboard");
            LogMessage($"Error copying to clipboard: {ex.Message}");
        }
    }

    private async void OnSaveConfigClicked(object? sender, RoutedEventArgs e)
    {
        try
        {
            var saveDialog = new Avalonia.Controls.SaveFileDialog
            {
                Title = "Save MCP Configuration",
                DefaultExtension = "json",
                Filters = new List<Avalonia.Controls.FileDialogFilter>
                {
                    new() { Name = "JSON Files", Extensions = new List<string> { "json" } },
                    new() { Name = "Text Files", Extensions = new List<string> { "txt" } },
                    new() { Name = "All Files", Extensions = new List<string> { "*" } }
                }
            };

            var result = await saveDialog.ShowAsync(this);
            if (result != null && _mcpConfigTextBox?.Text != null)
            {
                await System.IO.File.WriteAllTextAsync(result, _mcpConfigTextBox.Text);
                LogMessage($"MCP configuration saved to: {result}");
            }
        }
        catch (Exception ex)
        {
            _logger?.LogError(ex, "Error saving configuration file");
            LogMessage($"Error saving configuration: {ex.Message}");
        }
    }

    private async void OnTestConnectionClicked(object? sender, RoutedEventArgs e)
    {
        try
        {
            var host = _hostTextBox?.Text ?? "localhost";
            var port = _portTextBox?.Text ?? "3000";
            var url = $"http://{host}:{port}/mcp";

            LogMessage($"Testing connection to {url}...");

            using var httpClient = new System.Net.Http.HttpClient();
            httpClient.Timeout = TimeSpan.FromSeconds(5);

            var response = await httpClient.GetAsync(url);
            if (response.IsSuccessStatusCode)
            {
                LogMessage("✓ Connection test successful - MCP server is reachable");
            }
            else
            {
                LogMessage($"✗ Connection test failed - HTTP {response.StatusCode}");
            }
        }
        catch (Exception ex)
        {
            LogMessage($"✗ Connection test failed: {ex.Message}");
        }
    }

    #endregion
}