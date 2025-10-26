using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Hosting;
using ModelContextProtocol.Server;
using OverlayCompanion.Services;
using OverlayCompanion.MCP.Tools;

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
    // Web-only: desktop GUI removed
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
        bool forceHttp = args.Contains("--http") || string.Equals(Environment.GetEnvironmentVariable("MCP_TRANSPORT"), "http", StringComparison.OrdinalIgnoreCase);
        bool useStdioTransport = !forceHttp && (args.Contains("--stdio") || args.Contains("--legacy")
            || string.Equals(Environment.GetEnvironmentVariable("MCP_TRANSPORT"), "stdio", StringComparison.OrdinalIgnoreCase)
            || Console.IsInputRedirected);

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
        builder.Services.AddSingleton<ISettingsService, SettingsService>();
        builder.Services.AddSingleton<IClipboardBridgeService, ClipboardBridgeService>();
        builder.Services.AddSingleton<IConnectionManagementService, ConnectionManagementService>();

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
            // Web-only: no desktop GUI; just run host
            var hostTask = host.RunAsync();
            await hostTask;
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
        builder.Services.AddSingleton<ISettingsService, SettingsService>();
        builder.Services.AddSingleton<IClipboardBridgeService, ClipboardBridgeService>();
        builder.Services.AddSingleton<IConnectionManagementService, ConnectionManagementService>();
        builder.Services.AddSingleton<UpdateService>();
        builder.Services.AddSingleton<IOverlayEventBroadcaster, OverlayEventBroadcaster>();
        builder.Services.AddHttpClient();

        // Register KasmVNC integration service
        builder.Services.Configure<KasmVNCOptions>(options =>
        {
            options.BaseUrl = Environment.GetEnvironmentVariable("KASMVNC_URL") ?? "http://kasmvnc:6901";
            options.WebSocketUrl = Environment.GetEnvironmentVariable("KASMVNC_WS_URL") ?? "ws://kasmvnc:6901/websockify";
            options.ApiUrl = Environment.GetEnvironmentVariable("KASMVNC_API_URL") ?? "http://kasmvnc:6902";
            options.AdminPort = int.Parse(Environment.GetEnvironmentVariable("KASMVNC_ADMIN_PORT") ?? "3000");
        });
        builder.Services.AddSingleton<IKasmVNCService, KasmVNCService>();

        // Add MCP server with native HTTP transport using official SDK
        builder.Services
            .AddMcpServer()
            .WithHttpTransport()  // Native HTTP transport with streaming support
            .WithToolsFromAssembly();

        // Configure CORS for web integration (tighten when secret + allowed origins provided)
        var secretSet = !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("OC_OVERLAY_WS_SECRET"));
        var allowedOriginsEnv = Environment.GetEnvironmentVariable("OC_ALLOWED_ORIGINS");
        var allowedOrigins = (allowedOriginsEnv ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        builder.Services.AddCors(options =>
        {
            options.AddDefaultPolicy(policy =>
            {
                if (secretSet && allowedOrigins.Length > 0)
                {
                    policy.WithOrigins(allowedOrigins)
                          .AllowAnyMethod()
                          .AllowAnyHeader();
                }
                else
                {
                    policy.AllowAnyOrigin()
                          .AllowAnyMethod()
                          .AllowAnyHeader();
                }
            });
        });

        // Overlay WS hub and token service
        builder.Services.AddSingleton<OverlayWebSocketHub>();
        builder.Services.AddSingleton<OverlayTokenService>();

        // Configure web server (allow overriding port via environment)
        var port = 3000;
        var portEnv = Environment.GetEnvironmentVariable("PORT") ?? Environment.GetEnvironmentVariable("OC_PORT");
        if (int.TryParse(portEnv, out var p) && p > 0) port = p;

        builder.WebHost.ConfigureKestrel(options =>
        {
            options.ListenAnyIP(port);
        });

        var app = builder.Build();

        var logger = app.Services.GetRequiredService<ILogger<Program>>();
        logger.LogInformation("Starting Overlay Companion with Native HTTP Transport (Primary)...");
        logger.LogInformation("HTTP transport provides multi-client support, streaming, web integration, and image handling");
        logger.LogInformation("HTTP Transport listening on http://0.0.0.0:{Port}/ (root)", port);

        app.UseWebSockets();

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

        // Simple test endpoint for CI/manual verification
        app.MapPost("/api/test-overlay", async (IOverlayService overlaySvc) =>
        {
            var bounds = new OverlayCompanion.Models.ScreenRegion(50, 50, 200, 120);
            var overlay = new OverlayCompanion.Models.OverlayElement
            {
                Bounds = bounds,
                Color = "#ff0000",
                Opacity = 0.4,
                Label = "test",
                TemporaryMs = 1500,
                ClickThrough = true
            };
            var id = await overlaySvc.DrawOverlayAsync(overlay);
            return Results.Json(new { ok = true, overlay_id = id });
        });

        // Map MCP endpoints (native HTTP transport with streaming support)
        // Preferred root path "/" for MCP per current policy
        app.MapMcp("/");
        // Backward-compatible alias at /mcp to avoid client confusion
        app.MapMcp("/mcp");

        // Add configuration endpoints for better UX
        app.MapGet("/setup", () => Results.Content(GetConfigurationWebUI(), "text/html"));
        app.MapGet("/config", () => Results.Json(GetMcpConfiguration()));

        // Clipboard bridge settings API endpoints
        app.MapGet("/api/settings/clipboard-bridge", async (ISettingsService settingsService) =>
        {
            var settings = await settingsService.GetClipboardBridgeSettingsAsync();
            return Results.Json(settings);
        });

        app.MapPost("/api/settings/clipboard-bridge", async (ClipboardBridgeSettings settings, ISettingsService settingsService) =>
        {
            await settingsService.SetClipboardBridgeSettingsAsync(settings);
            return Results.Json(new { success = true, message = "Clipboard bridge settings updated successfully" });
        });

        app.MapGet("/api/settings/clipboard-bridge/test", async (IClipboardBridgeService clipboardBridge) =>
        {
            var isAvailable = await clipboardBridge.IsAvailableAsync();
            return Results.Json(new
            {
                available = isAvailable,
                status = isAvailable ? "connected" : "disconnected",
                message = isAvailable ? "VM clipboard bridge is responding" : "VM clipboard bridge is not available"
            });
        });

        // Health check endpoint with KasmVNC integration status
        app.MapGet("/health", async (IKasmVNCService kasmvnc, IOverlayService overlay, IOverlayEventBroadcaster broadcaster) =>
        {
            var kasmvncConnected = await kasmvnc.IsConnectedAsync();
            var sessionStatus = kasmvncConnected ? await kasmvnc.GetSessionStatusAsync() : "disconnected";
            var activeOverlays = await overlay.GetActiveOverlaysAsync();

            var health = new
            {
                status = "healthy",
                timestamp = DateTime.UtcNow,
                uptime = Environment.TickCount64 / 1000.0, // seconds
                services = new
                {
                    mcp_server = "running",
                    overlay_service = "running",
                    kasmvnc_connection = kasmvncConnected,
                    kasmvnc_session = sessionStatus,
                    websocket_clients = broadcaster.ClientCount,
                    active_overlays = activeOverlays.Count()
                },
                capabilities = new
                {
                    multi_monitor = true,
                    overlay_system = true,
                    click_through = true,
                    kasmvnc_integration = kasmvncConnected,
                    websocket_streaming = true
                }
            };

            return Results.Json(health);
        });
        // WebSocket endpoint for overlay events
        app.MapGet("/ws/overlays", async (HttpContext context) =>
        {
            if (!context.WebSockets.IsWebSocketRequest)
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                return;
            }

            // Optional token + origin protection
            var tokenSvc = context.RequestServices.GetRequiredService<OverlayTokenService>();
            var token = context.Request.Query["token"].FirstOrDefault() ?? context.Request.Headers["X-Overlay-Token"].FirstOrDefault();
            if (tokenSvc.IsProtectionEnabled && !tokenSvc.ValidateToken(token, "viewer"))
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return;
            }
            // Enforce Origin/Referer when secret is set and OC_ALLOWED_ORIGINS provided
            if (tokenSvc.IsProtectionEnabled && (allowedOrigins?.Length ?? 0) > 0)
            {
                var origin = context.Request.Headers["Origin"].ToString();
                var referer = context.Request.Headers["Referer"].ToString();
                bool allowed = (!string.IsNullOrEmpty(origin) && allowedOrigins.Contains(origin))
                               || (!string.IsNullOrEmpty(referer) && allowedOrigins.Any(o => referer.StartsWith(o)));
                if (!allowed)
                {
                    context.Response.StatusCode = StatusCodes.Status403Forbidden;
                    return;
                }
            }

            using var socket = await context.WebSockets.AcceptWebSocketAsync();
            var hub = context.RequestServices.GetRequiredService<OverlayWebSocketHub>();
            var cts = new CancellationTokenSource();
            await hub.HandleClientAsync(socket, cts.Token);
        });

        // Token mint endpoint (dev aid): returns short-lived token if OC_OVERLAY_WS_SECRET is set
        app.MapGet("/overlay/token", (OverlayTokenService tokenSvc) =>
        {
            if (!tokenSvc.IsProtectionEnabled) return Results.Json(new { token = "", protection = false });
            var token = tokenSvc.GenerateToken("viewer");
            return Results.Json(new { token, protection = true });
        });
        // Serve static web UI at root
        app.MapGet("/", async context =>
        {
            context.Response.ContentType = "text/html; charset=utf-8";
            await context.Response.SendFileAsync(Path.Combine(AppContext.BaseDirectory, "wwwroot", "index.html"));
        });

        app.MapGet("/config/json", () => Results.Content(GetMcpConfigurationJson(), "application/json"));
        app.MapGet("/config/stdio", () => Results.Json(GetMcpConfigurationStdio()));

        try
        {
            // Web-only: no desktop GUI; just run web app
            bool smoke = args.Contains("--smoke-test") || Environment.GetEnvironmentVariable("OC_SMOKE_TEST") == "1";
            var webAppTask = app.RunAsync();

            // In smoke test mode, create ready file after HTTP server starts and exit after delay
            if (smoke)
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

            await webAppTask;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "An error occurred while running the HTTP transport");
            throw;
        }
    }

    // Smoke-test hooks: write readiness file if requested (web-only)
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

        try { File.WriteAllText(readyFile!, DateTime.UtcNow.ToString("o")); } catch { }
    }


    // Web-only: StartGtk4App removed


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
                    url = "http://localhost:3000/",
                    description = "AI-assisted screen interaction with overlay functionality for multi-monitor setups",
                    tags = new[] { "screen-capture", "overlay", "automation", "multi-monitor", "web", "http", "sse" },
                    provider = "Overlay Companion",
                    provider_url = "https://github.com/RyansOpenSourceRice/overlay-companion-mcp"
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
            HTTP transport is active on <code>http://localhost:3000/</code>
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

        <div class="config-section">
            <div class="config-title">📋 VM Clipboard Bridge Settings</div>
            <div class="config-description">
                Configure the optional VM clipboard bridge for cross-system clipboard synchronization.
                When enabled, clipboard operations will use the VM bridge with automatic fallback to local clipboard.
            </div>

            <div style="margin-bottom: 15px;">
                <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
                    <input type="checkbox" id="clipboard-enabled" onchange="updateClipboardSettings()">
                    <strong>Enable VM Clipboard Bridge</strong>
                </label>
            </div>

            <div id="clipboard-settings" style="display: none;">
                <div style="margin-bottom: 10px;">
                    <label style="display: block; margin-bottom: 5px;"><strong>Base URL:</strong></label>
                    <input type="text" id="clipboard-base-url" value="http://localhost:8765"
                           style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;"
                           onchange="updateClipboardSettings()">
                </div>

                <div style="margin-bottom: 10px;">
                    <label style="display: block; margin-bottom: 5px;"><strong>API Key:</strong></label>
                    <input type="text" id="clipboard-api-key" value="overlay-companion-mcp"
                           style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;"
                           onchange="updateClipboardSettings()">
                </div>

                <div style="margin-bottom: 10px;">
                    <label style="display: block; margin-bottom: 5px;"><strong>Timeout (seconds):</strong></label>
                    <input type="number" id="clipboard-timeout" value="5" min="1" max="30"
                           style="width: 100px; padding: 8px; border: 1px solid #ddd; border-radius: 4px;"
                           onchange="updateClipboardSettings()">
                </div>

                <div style="margin-bottom: 15px;">
                    <label style="display: flex; align-items: center; gap: 8px;">
                        <input type="checkbox" id="clipboard-fallback" checked onchange="updateClipboardSettings()">
                        <strong>Fallback to Local Clipboard</strong>
                    </label>
                </div>

                <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                    <button onclick="testClipboardBridge()" style="padding: 8px 16px; background: #007acc; color: white; border: none; border-radius: 4px; cursor: pointer;">
                        🔍 Test Connection
                    </button>
                    <button onclick="saveClipboardSettings()" style="padding: 8px 16px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer;">
                        💾 Save Settings
                    </button>
                </div>

                <div id="clipboard-status" style="padding: 10px; border-radius: 4px; margin-bottom: 10px; display: none;"></div>
            </div>
        </div>

        <div class="endpoints">
            <h3>📡 Available Endpoints</h3>
            <div class="endpoint">
                <strong>MCP Protocol:</strong> <code>POST /</code> - Main MCP server endpoint (Accept: application/json, text/event-stream)
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

        // Clipboard bridge configuration functions
        function loadClipboardSettings() {
            fetch('/api/settings/clipboard-bridge')
                .then(r => r.json())
                .then(settings => {
                    document.getElementById('clipboard-enabled').checked = settings.enabled;
                    document.getElementById('clipboard-base-url').value = settings.baseUrl;
                    document.getElementById('clipboard-api-key').value = settings.apiKey;
                    document.getElementById('clipboard-timeout').value = settings.timeoutSeconds;
                    document.getElementById('clipboard-fallback').checked = settings.fallbackToLocal;
                    updateClipboardSettings();
                })
                .catch(err => {
                    console.error('Failed to load clipboard settings:', err);
                });
        }

        function updateClipboardSettings() {
            const enabled = document.getElementById('clipboard-enabled').checked;
            const settingsDiv = document.getElementById('clipboard-settings');
            settingsDiv.style.display = enabled ? 'block' : 'none';
        }

        function saveClipboardSettings() {
            const settings = {
                enabled: document.getElementById('clipboard-enabled').checked,
                baseUrl: document.getElementById('clipboard-base-url').value,
                apiKey: document.getElementById('clipboard-api-key').value,
                timeoutSeconds: parseInt(document.getElementById('clipboard-timeout').value),
                fallbackToLocal: document.getElementById('clipboard-fallback').checked,
                description: "VM clipboard bridge for cross-system clipboard synchronization"
            };

            fetch('/api/settings/clipboard-bridge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            })
            .then(r => r.json())
            .then(result => {
                showClipboardStatus(result.message, 'success');
            })
            .catch(err => {
                console.error('Failed to save clipboard settings:', err);
                showClipboardStatus('Failed to save settings: ' + err.message, 'error');
            });
        }

        function testClipboardBridge() {
            showClipboardStatus('Testing connection...', 'info');

            fetch('/api/settings/clipboard-bridge/test')
                .then(r => r.json())
                .then(result => {
                    const statusType = result.available ? 'success' : 'warning';
                    showClipboardStatus(result.message, statusType);
                })
                .catch(err => {
                    console.error('Failed to test clipboard bridge:', err);
                    showClipboardStatus('Test failed: ' + err.message, 'error');
                });
        }

        function showClipboardStatus(message, type) {
            const statusDiv = document.getElementById('clipboard-status');
            statusDiv.style.display = 'block';
            statusDiv.textContent = message;

            // Set background color based on type
            switch(type) {
                case 'success':
                    statusDiv.style.backgroundColor = '#d4edda';
                    statusDiv.style.color = '#155724';
                    statusDiv.style.border = '1px solid #c3e6cb';
                    break;
                case 'error':
                    statusDiv.style.backgroundColor = '#f8d7da';
                    statusDiv.style.color = '#721c24';
                    statusDiv.style.border = '1px solid #f5c6cb';
                    break;
                case 'warning':
                    statusDiv.style.backgroundColor = '#fff3cd';
                    statusDiv.style.color = '#856404';
                    statusDiv.style.border = '1px solid #ffeaa7';
                    break;
                case 'info':
                    statusDiv.style.backgroundColor = '#d1ecf1';
                    statusDiv.style.color = '#0c5460';
                    statusDiv.style.border = '1px solid #bee5eb';
                    break;
            }

            // Auto-hide after 5 seconds for success messages
            if (type === 'success') {
                setTimeout(() => {
                    statusDiv.style.display = 'none';
                }, 5000);
            }
        }

        // Load clipboard settings on page load
        loadClipboardSettings();
    </script>
</body>
</html>
""";
    }
}
