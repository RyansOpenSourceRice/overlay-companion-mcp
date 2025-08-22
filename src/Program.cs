using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
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

using System.IO;

namespace OverlayCompanion;

/// <summary>
/// Main entry point for the Overlay Companion MCP Server
/// Uses the official ModelContextProtocol SDK
/// </summary>
public class Program
{
    [RequiresUnreferencedCode("MCP server uses reflection-based tool discovery and JSON serialization; trimming may remove required members.")]
    public static async Task Main(string[] args)
    {
        // Enable smoke-test hooks if requested
        if (args.Contains("--smoke-test") || Environment.GetEnvironmentVariable("OC_SMOKE_TEST") == "1")
        {
            ConfigureSmokeTestHooks();
        }

        // Support both stdio (for testing/legacy) and HTTP transport (primary)
        bool useHttpTransport = args.Contains("--http") || args.Contains("--bridge");

        if (useHttpTransport)
        {
            await RunWithHttpTransport(args);
        }
        else
        {
            await RunStdioMcpServer(args);
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
        logger.LogInformation("Starting Overlay Companion MCP Server (stdio transport)...");
        logger.LogInformation("Server will listen for stdio MCP connections from Jan.ai or other MCP clients");

        try
        {
            // Start MCP host and (optionally) Avalonia GUI concurrently
            bool smoke = args.Contains("--smoke-test") || Environment.GetEnvironmentVariable("OC_SMOKE_TEST") == "1";
            bool headless = smoke || args.Contains("--no-gui") || Environment.GetEnvironmentVariable("HEADLESS") == "1";
            var hostTask = host.RunAsync();
            Task? avaloniaTask = null;
            if (!headless)
            {
                avaloniaTask = Task.Run(() => StartAvaloniaApp(host.Services));
            }

            // Wait appropriately: if GUI started, tie process lifetime to GUI
            if (avaloniaTask is not null)
            {
                await avaloniaTask;
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
        logger.LogInformation("Starting Overlay Companion with Native HTTP Transport...");
        logger.LogInformation("Native HTTP provides multi-client support, streaming, and web integration");
        logger.LogInformation("HTTP Transport listening on http://0.0.0.0:3000/mcp");

        // Enable CORS
        app.UseCors();

        // Map MCP endpoints (native HTTP transport with streaming support)
        app.MapMcp();  // This registers the /mcp endpoint with full MCP protocol support

        try
        {
            // Start HTTP transport and (optionally) Avalonia GUI concurrently
            bool smoke = args.Contains("--smoke-test") || Environment.GetEnvironmentVariable("OC_SMOKE_TEST") == "1";
            bool headless = smoke || args.Contains("--no-gui") || Environment.GetEnvironmentVariable("HEADLESS") == "1";
            var webAppTask = app.RunAsync();
            Task? avaloniaTask = null;
            if (!headless)
            {
                avaloniaTask = Task.Run(() => StartAvaloniaApp(app.Services));
            }

            if (avaloniaTask is not null)
            {
                await avaloniaTask;
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

            OverlayApplication.WindowShown += () =>
            {
                try
                {
                    File.WriteAllText(readyFile!, DateTime.UtcNow.ToString("o"));
                }
                catch { /* ignore */ }
            };
        }


    private static void StartAvaloniaApp(IServiceProvider services)
    {
        // Initialize and start Avalonia GUI application
        var app = AppBuilder.Configure<OverlayApplication>()
            .UsePlatformDetect()
            // .WithInterFont() // Not available in this Avalonia version
            .LogToTrace()
            .SetupWithLifetime(new ClassicDesktopStyleApplicationLifetime());

        // Set service provider for dependency injection
        if (app.Instance is OverlayApplication overlayApp)
        {
            overlayApp.ServiceProvider = services;
            OverlayApplication.GlobalServiceProvider = services;
        }

        app.StartWithClassicDesktopLifetime(Array.Empty<string>());
    }
}
