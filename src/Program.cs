using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ModelContextProtocol;
using OverlayCompanion.Services;
using OverlayCompanion.MCP;
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

        // Configure logging
        builder.Logging.AddConsole();
        builder.Logging.SetMinimumLevel(LogLevel.Information);

        // Register core services
        builder.Services.AddSingleton<IScreenCaptureService, ScreenCaptureService>();
        builder.Services.AddSingleton<IOverlayService, OverlayService>();
        builder.Services.AddSingleton<IInputMonitorService, InputMonitorService>();
        builder.Services.AddSingleton<IModeManager, ModeManager>();

        // Register MCP tool registry
        builder.Services.AddSingleton<McpToolRegistry>();

        // Register MCP tools
        builder.Services.AddTransient<TakeScreenshotTool>();
        builder.Services.AddTransient<DrawOverlayTool>();
        builder.Services.AddTransient<RemoveOverlayTool>();
        builder.Services.AddTransient<ClickAtTool>();
        builder.Services.AddTransient<TypeTextTool>();
        builder.Services.AddTransient<SetModeTool>();
        builder.Services.AddTransient<GetClipboardTool>();
        builder.Services.AddTransient<SetClipboardTool>();
        builder.Services.AddTransient<BatchOverlayTool>();
        builder.Services.AddTransient<SetScreenshotFrequencyTool>();
        builder.Services.AddTransient<SubscribeEventsTool>();
        builder.Services.AddTransient<UnsubscribeEventsTool>();

        // TODO: Add MCP server services using official SDK when types are available
        /*
        builder.Services.AddMcpServer(options =>
        {
            options.ServerInfo = new McpServerInfo
            {
                Name = "overlay-companion-mcp",
                Version = "1.0.0",
                Description = "General-purpose, human-in-the-loop AI-assisted screen interaction toolkit"
            };
        });

        // Register MCP tools with the server
        builder.Services.Configure<McpServerOptions>(options =>
        {
            // Tools will be registered in the hosted service
        });
        */

        // Add the MCP server hosted service
        builder.Services.AddHostedService<OverlayCompanionMcpService>();

        var host = builder.Build();

        // Initialize tool registry
        var toolRegistry = host.Services.GetRequiredService<McpToolRegistry>();
        RegisterTools(toolRegistry, host.Services);

        var logger = host.Services.GetRequiredService<ILogger<Program>>();
        logger.LogInformation("Starting Overlay Companion MCP Server...");
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

    private static void RegisterTools(McpToolRegistry registry, IServiceProvider services)
    {
        // Register all MCP tools
        registry.RegisterTool(services.GetRequiredService<TakeScreenshotTool>());
        registry.RegisterTool(services.GetRequiredService<DrawOverlayTool>());
        registry.RegisterTool(services.GetRequiredService<RemoveOverlayTool>());
        registry.RegisterTool(services.GetRequiredService<ClickAtTool>());
        registry.RegisterTool(services.GetRequiredService<TypeTextTool>());
        registry.RegisterTool(services.GetRequiredService<SetModeTool>());
        registry.RegisterTool(services.GetRequiredService<GetClipboardTool>());
        registry.RegisterTool(services.GetRequiredService<SetClipboardTool>());
        registry.RegisterTool(services.GetRequiredService<BatchOverlayTool>());
        registry.RegisterTool(services.GetRequiredService<SetScreenshotFrequencyTool>());
        registry.RegisterTool(services.GetRequiredService<SubscribeEventsTool>());
        registry.RegisterTool(services.GetRequiredService<UnsubscribeEventsTool>());

        var logger = services.GetRequiredService<ILogger<Program>>();
        logger.LogInformation("Registered {ToolCount} MCP tools", registry.GetToolNames().Length);
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