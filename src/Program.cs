using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Hosting;
using ModelContextProtocol.Server;
using OverlayCompanion.Services;
using OverlayCompanion.MCP.Tools;
using OverlayCompanion.UI;
using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using System.IO;
using OverlayCompanion.Web;

namespace OverlayCompanion;

/// <summary>
/// Main entry point for the Overlay Companion MCP Server
/// Uses the official ModelContextProtocol SDK
/// </summary>
public class Program
{
    private static bool _gtk4Initialized = false;
    private static readonly object _gtk4Lock = new object();
    [RequiresUnreferencedCode("MCP server uses reflection-based tool discovery and JSON serialization; trimming may remove required members.")]
    public static async Task Main(string[] args)
    {
        // Enable smoke-test hooks if requested
        if (args.Contains("--smoke-test") || Environment.GetEnvironmentVariable("OC_SMOKE_TEST") == "1")
        {
            ConfigureSmokeTestHooks();
        }

        // HTTP transport is now the primary and default transport
        // STDIO transport is deprecated and only available for legacy compatibility
        bool useStdioTransport = args.Contains("--stdio") || args.Contains("--legacy");

        if (useStdioTransport)
        {
            Console.WriteLine("WARNING: STDIO transport is deprecated. Use HTTP transport (default) for better performance and features.");
            await RunStdioMcpServer(args);
        }
        else
        {
            await RunWithHttpTransport(args);
        }
    }

    [RequiresUnreferencedCode("Calls Microsoft.Extensions.DependencyInjection.McpServerBuilderExtensions.WithToolsFromAssembly(Assembly, JsonSerializerOptions)")]
    private static async Task RunStdioMcpServer(string[] args)
    {
        var builder = Host.CreateApplicationBuilder(args);

        // Configure logging to stderr for MCP compatibility
        builder.Logging.AddConsole(consoleLogOptions =>
        {
            // Configure all logs to go to stderr for MCP protocol compliance
            consoleLogOptions.LogToStandardErrorThreshold = LogLevel.Trace;
        });
        builder.Logging.SetMinimumLevel(LogLevel.Information);

        // Register core services
        builder.Services.AddSingleton<IScreenCaptureService, ScreenCaptureService>();
        builder.Services.AddSingleton<IOverlayService, OverlayService>();
        builder.Services.AddSingleton<IInputMonitorService, InputMonitorService>();
        builder.Services.AddSingleton<IModeManager, ModeManager>();
        builder.Services.AddSingleton<ISessionStopService, SessionStopService>();

        // Add MCP server with official SDK using stdio transport (standard for MCP servers)
        builder.Services
            .AddMcpServer()
            .WithStdioServerTransport()
            .WithToolsFromAssembly();

        var host = builder.Build();

        var logger = host.Services.GetRequiredService<ILogger<Program>>();
        logger.LogWarning("Starting Overlay Companion MCP Server (DEPRECATED stdio transport)...");
        logger.LogWarning("STDIO transport is deprecated. Please use HTTP transport (default) for better performance and features.");
        logger.LogInformation("Server will listen for stdio MCP connections from Jan.ai or other MCP clients");

        try
        {
            // Start MCP host and (optionally) Avalonia GUI concurrently
            bool smoke = args.Contains("--smoke-test") || Environment.GetEnvironmentVariable("OC_SMOKE_TEST") == "1";
            bool headless = smoke || args.Contains("--no-gui") || Environment.GetEnvironmentVariable("HEADLESS") == "1";
            var hostTask = host.RunAsync();
            Task? gtk4Task = null;
            if (!headless)
            {
                gtk4Task = Task.Run(() => StartGtk4App(host.Services));
            }

            // Wait appropriately: if GUI started, tie process lifetime to GUI
            if (gtk4Task is not null)
            {
                await gtk4Task;
            }
            else
            {
                await hostTask;
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "An error occurred while running the MCP server");
            throw;
        }
    }

    [RequiresUnreferencedCode("Calls Microsoft.Extensions.DependencyInjection.McpServerBuilderExtensions.WithToolsFromAssembly(Assembly, JsonSerializerOptions)")]
    private static async Task RunWithHttpTransport(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);

        // Configure logging
        builder.Logging.AddConsole();
        builder.Logging.SetMinimumLevel(LogLevel.Information);

        // Register core services
        builder.Services.AddSingleton<IScreenCaptureService, ScreenCaptureService>();
        builder.Services.AddSingleton<IOverlayService, OverlayService>();
        builder.Services.AddSingleton<IInputMonitorService, InputMonitorService>();
        builder.Services.AddSingleton<IModeManager, ModeManager>();
        builder.Services.AddSingleton<ISessionStopService, SessionStopService>();
        builder.Services.AddSingleton<UpdateService>();
        builder.Services.AddSingleton<IOverlayEventBroadcaster, OverlayEventBroadcaster>();
        builder.Services.AddHttpClient();

        // Add MCP server with native HTTP transport using official SDK
        builder.Services
            .AddMcpServer()
            .WithHttpTransport()  // Native HTTP transport with streaming support
            .WithToolsFromAssembly();

        // Configure CORS for web integration
        builder.Services.AddCors(options =>
        {
            options.AddDefaultPolicy(policy =>
            {
                policy.AllowAnyOrigin()
                      .AllowAnyMethod()
                      .AllowAnyHeader();
            });
        });

        // Configure web server
        builder.WebHost.ConfigureKestrel(options =>
        {
            options.ListenAnyIP(3000);
        });

        var app = builder.Build();

        var logger = app.Services.GetRequiredService<ILogger<Program>>();
        logger.LogInformation("Starting Overlay Companion with Native HTTP Transport (Primary)...");
        logger.LogInformation("HTTP transport provides multi-client support, streaming, web integration, and image handling");
        logger.LogInformation("HTTP Transport listening on http://0.0.0.0:3000/mcp");

        // Enable CORS
        app.UseCors();

        // WebSocket for overlay events
        app.MapOverlayWebSockets();

        // Serve static web client
        app.MapGet("/", async context =>
        {
            context.Response.ContentType = "text/html";
            await context.Response.SendFileAsync(Path.Combine(AppContext.BaseDirectory, "wwwroot", "index.html"));
        });

        // Map MCP endpoints (native HTTP transport with streaming support)
        app.MapMcp();  // This registers the /mcp endpoint with full MCP protocol support

        // Add configuration endpoints for better UX
        app.MapGet("/setup", () => Results.Content(GetConfigurationWebUI(), "text/html"));
        app.MapGet("/config", () => Results.Json(GetMcpConfiguration()));
        app.MapGet("/config/json", () => Results.Content(GetMcpConfigurationJson(), "application/json"));
        app.MapGet("/config/stdio", () => Results.Json(GetMcpConfigurationStdio()));

        try
        {
            // Start HTTP transport and (optionally) GTK4 GUI concurrently
            bool smoke = args.Contains("--smoke-test") || Environment.GetEnvironmentVariable("OC_SMOKE_TEST") == "1";
            bool headless = smoke || args.Contains("--no-gui") || Environment.GetEnvironmentVariable("HEADLESS") == "1";
            var webAppTask = app.RunAsync();
            Task? gtk4Task = null;
            if (!headless)
            {
                gtk4Task = Task.Run(() => StartGtk4App(app.Services));
            }

            // In smoke test mode, create ready file after HTTP server starts and exit after delay
            if (smoke && headless)
            {
                // Wait a moment for HTTP server to fully start
                await Task.Delay(2000);

                // Create ready file to signal successful startup
                var readyFile = Environment.GetEnvironmentVariable("OC_WINDOW_READY_FILE");
                if (!string.IsNullOrEmpty(readyFile))
                {
                    try
                    {
                        var dir = Path.GetDirectoryName(readyFile)!;
                        if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
                        File.WriteAllText(readyFile, DateTime.UtcNow.ToString("o"));
                        logger.LogInformation("Smoke test: Created ready file at {ReadyFile}", readyFile);
                    }
                    catch (Exception ex)
                    {
                        logger.LogWarning(ex, "Smoke test: Failed to create ready file at {ReadyFile}", readyFile);
                    }
                }

                // Exit after a short delay to complete smoke test
                await Task.Delay(3000);
                logger.LogInformation("Smoke test completed successfully");
                return;
            }

            if (gtk4Task is not null)
            {
                await gtk4Task;
            }
            else
            {
                await webAppTask;
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "An error occurred while running the HTTP transport");
            throw;
        }
    }

    // Smoke-test hooks: when SMOKE_TEST is enabled, start GUI and write a ready file when window shows
    private static void ConfigureSmokeTestHooks()
    {
        var readyFile = Environment.GetEnvironmentVariable("OC_WINDOW_READY_FILE");
        if (string.IsNullOrEmpty(readyFile)) return;
        try
        {
            var dir = Path.GetDirectoryName(readyFile)!;
            if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
        }
        catch { /* best-effort */ }

        Gtk4OverlayApplication.WindowShown += () =>
        {
            try
            {
                File.WriteAllText(readyFile!, DateTime.UtcNow.ToString("o"));
            }
            catch { /* ignore */ }
        };
    }


    private static void StartGtk4App(IServiceProvider services)
    {
        lock (_gtk4Lock)
        {
            if (_gtk4Initialized)
            {
                Console.WriteLine("WARNING: GTK4 already initialized, skipping duplicate initialization.");
                return;
            }
            _gtk4Initialized = true;

            try
            {
                // Initialize GTK4 application manager
                Gtk4ApplicationManager.Initialize();

                // Set service provider for dependency injection
                Gtk4ApplicationManager.SetServiceProvider(services);

                // Run the GTK4 application
                Gtk4ApplicationManager.RunApplication(Array.Empty<string>());
            }
            catch (Exception ex)
            {
                Console.WriteLine($"ERROR: Failed to start GTK4 application: {ex.Message}");
                Console.WriteLine($"Stack trace: {ex.StackTrace}");
                _gtk4Initialized = false; // Reset flag on failure
                throw;
            }
        }
    }

    /// <summary>
    /// Get MCP configuration for HTTP transport (recommended)
    /// </summary>
    private static object GetMcpConfiguration()
    {
        return new
        {
            mcpServers = new
            {
                overlay_companion = new
                {
                    url = "http://localhost:3000/mcp",
                    description = "AI-assisted screen interaction with overlay functionality for multi-monitor setups",
                    tags = new[] { "screen-capture", "overlay", "automation", "multi-monitor", "gtk4", "linux" },
                    provider = "Overlay Companion",
                    provider_url = "https://github.com/RyansOpenSauceRice/overlay-companion-mcp"
                }
            }
        };
    }

    /// <summary>
    /// Get MCP configuration for STDIO transport (legacy)
    /// </summary>
    private static object GetMcpConfigurationStdio()
    {
        var executablePath = Environment.ProcessPath ?? "/path/to/overlay-companion-mcp";
        return new
        {
            mcpServers = new
            {
                overlay_companion = new
                {
                    command = executablePath,
                    args = new[] { "--stdio" }
                }
            }
        };
    }

    /// <summary>
    /// Get formatted JSON string for MCP configuration
    /// </summary>
    public static string GetMcpConfigurationJson()
    {
        return JsonSerializer.Serialize(GetMcpConfiguration(), new JsonSerializerOptions 
        { 
            WriteIndented = true 
        });
    }

    /// <summary>
    /// Get HTML web UI for configuration management
    /// </summary>
    private static string GetConfigurationWebUI()
    {
        return """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Overlay Companion MCP - Configuration</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background: #f5f5f5;
        }
        .container {
            background: white;
            border-radius: 8px;
            padding: 30px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            margin-bottom: 10px;
        }
        .subtitle {
            color: #666;
            margin-bottom: 30px;
        }
        .config-section {
            margin-bottom: 30px;
            padding: 20px;
            border: 1px solid #e0e0e0;
            border-radius: 6px;
            background: #fafafa;
        }
        .config-title {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 10px;
            color: #333;
        }
        .config-description {
            color: #666;
            margin-bottom: 15px;
        }
        pre {
            background: #2d3748;
            color: #e2e8f0;
            padding: 15px;
            border-radius: 4px;
            overflow-x: auto;
            font-size: 14px;
            line-height: 1.4;
        }
        .copy-btn {
            background: #4299e1;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            margin-top: 10px;
        }
        .copy-btn:hover {
            background: #3182ce;
        }
        .copy-btn.copied {
            background: #38a169;
        }
        .status {
            margin-top: 20px;
            padding: 15px;
            border-radius: 4px;
            background: #e6fffa;
            border: 1px solid #81e6d9;
            color: #234e52;
        }
        .warning {
            background: #fef5e7;
            border-color: #f6ad55;
            color: #744210;
        }
        .endpoints {
            margin-top: 30px;
        }
        .endpoint {
            margin: 10px 0;
            padding: 10px;
            background: #f7fafc;
            border-radius: 4px;
            border-left: 4px solid #4299e1;
        }
        .endpoint code {
            background: #2d3748;
            color: #e2e8f0;
            padding: 2px 6px;
            border-radius: 3px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎯 Overlay Companion MCP</h1>
        <p class="subtitle">AI-assisted screen interaction with overlay functionality</p>
        
        <div class="status">
            <strong>✅ Server Running</strong><br>
            HTTP transport is active on <code>http://localhost:3000/mcp</code>
        </div>

        <div class="config-section">
            <div class="config-title">🚀 HTTP Transport (Recommended)</div>
            <div class="config-description">
                Modern HTTP-based transport with multi-client support, streaming, and web integration.
                Use this configuration for Cherry Studio and other MCP clients.
            </div>
            <pre id="http-config"></pre>
            <button class="copy-btn" onclick="copyConfig('http')">📋 Copy HTTP Configuration</button>
        </div>

        <div class="config-section">
            <div class="config-title">📟 STDIO Transport (Legacy)</div>
            <div class="config-description">
                Legacy STDIO-based transport for compatibility with older MCP clients.
                Only use if HTTP transport is not supported.
            </div>
            <pre id="stdio-config"></pre>
            <button class="copy-btn" onclick="copyConfig('stdio')">📋 Copy STDIO Configuration</button>
        </div>

        <div class="endpoints">
            <h3>📡 Available Endpoints</h3>
            <div class="endpoint">
                <strong>MCP Protocol:</strong> <code>POST /mcp</code> - Main MCP server endpoint
            </div>
            <div class="endpoint">
                <strong>Configuration UI:</strong> <code>GET /setup</code> - This page
            </div>
            <div class="endpoint">
                <strong>HTTP Config JSON:</strong> <code>GET /config</code> - HTTP transport configuration
            </div>
            <div class="endpoint">
                <strong>STDIO Config JSON:</strong> <code>GET /config/stdio</code> - STDIO transport configuration
            </div>
        </div>

        <div class="status warning">
            <strong>⚠️ Transport Detection Issue</strong><br>
            If your MCP client shows this as "STDIO" instead of "HTTP" after importing, 
            try using the HTTP configuration above or check your client's HTTP transport support.
        </div>
    </div>

    <script>
        // Load configurations
        fetch('/config')
            .then(r => r.json())
            .then(data => {
                document.getElementById('http-config').textContent = JSON.stringify(data, null, 2);
            });

        fetch('/config/stdio')
            .then(r => r.json())
            .then(data => {
                document.getElementById('stdio-config').textContent = JSON.stringify(data, null, 2);
            });

        // Copy functionality
        function copyConfig(type) {
            const elementId = type === 'http' ? 'http-config' : 'stdio-config';
            const text = document.getElementById(elementId).textContent;
            
            navigator.clipboard.writeText(text).then(() => {
                const btn = event.target;
                const originalText = btn.textContent;
                btn.textContent = '✅ Copied!';
                btn.classList.add('copied');
                
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.classList.remove('copied');
                }, 2000);
            }).catch(err => {
                console.error('Failed to copy:', err);
                alert('Failed to copy to clipboard. Please copy manually.');
            });
        }
    </script>
</body>
</html>
""";
    }
}
