using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ModelContextProtocol.Server;
using OverlayCompanion.Services;
using OverlayCompanion.MCP.Tools;
using OverlayCompanion.UI;

namespace OverlayCompanion;

/// <summary>
/// Main entry point for the Overlay Companion MCP Server
/// Uses the official ModelContextProtocol SDK
/// </summary>
public class Program
{
    public static async Task Main(string[] args)
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

        // Add MCP server with official SDK
        builder.Services
            .AddMcpServer()
            .WithStdioServerTransport()
            .WithToolsFromAssembly();

        var host = builder.Build();

        var logger = host.Services.GetRequiredService<ILogger<Program>>();
        logger.LogInformation("Starting Overlay Companion MCP Server with official SDK...");
        logger.LogInformation("Server will listen for MCP connections from Jan.ai or other MCP clients");

        try
        {
            // Start Avalonia GUI and MCP server concurrently
            var avaloniaTask = Task.Run(() => StartAvaloniaApp(host.Services));
            var hostTask = host.RunAsync();

            // Wait for either to complete
            await Task.WhenAny(avaloniaTask, hostTask);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "An error occurred while running the MCP server");
            throw;
        }
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
        }

        app.StartWithClassicDesktopLifetime(Array.Empty<string>());
    }
}