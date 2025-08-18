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

namespace OverlayCompanion;

/// <summary>
/// Main entry point for the Overlay Companion MCP Server
/// Uses the official ModelContextProtocol SDK
/// </summary>
public class Program
{
    public static async Task Main(string[] args)
    {
        // Support both stdio (direct) and HTTP bridge (segmented) deployments
        bool useHttpBridge = args.Contains("--http") || args.Contains("--bridge");

        if (useHttpBridge)
        {
            await RunWithHttpBridge(args);
        }
        else
        {
            await RunStdioMcpServer(args);
        }
    }

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

    private static async Task RunWithHttpBridge(string[] args)
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

        // Add MCP server with official SDK
        builder.Services
            .AddMcpServer()
            .WithToolsFromAssembly();

        // Configure web server
        builder.WebHost.ConfigureKestrel(options =>
        {
            options.ListenAnyIP(3000);
        });

        var app = builder.Build();

        var logger = app.Services.GetRequiredService<ILogger<Program>>();
        logger.LogInformation("Starting Overlay Companion HTTP Bridge...");
        logger.LogInformation("Bridge provides system segmentation and deployment flexibility");
        logger.LogInformation("HTTP Bridge listening on http://0.0.0.0:3000/mcp");

        // Configure HTTP-to-stdio bridge endpoint for system segmentation
        app.MapPost("/mcp", async (HttpContext context) =>
        {
            try
            {
                // Read the HTTP request body
                using var reader = new StreamReader(context.Request.Body);
                var requestBody = await reader.ReadToEndAsync();

                // Start the stdio MCP server process (segmented from control plane)
                var processInfo = new System.Diagnostics.ProcessStartInfo
                {
                    FileName = "dotnet",
                    Arguments = "run --project /workspace/project/overlay-companion-mcp/src/OverlayCompanion.csproj",
                    UseShellExecute = false,
                    RedirectStandardInput = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                };

                using var process = System.Diagnostics.Process.Start(processInfo);
                if (process == null)
                {
                    context.Response.StatusCode = 500;
                    await context.Response.WriteAsync("Failed to start segmented MCP server process");
                    return;
                }

                // Forward request to segmented stdio MCP server
                await process.StandardInput.WriteLineAsync(requestBody);
                await process.StandardInput.FlushAsync();
                process.StandardInput.Close();

                // Return response from segmented server
                var response = await process.StandardOutput.ReadToEndAsync();
                await process.WaitForExitAsync();

                context.Response.ContentType = "application/json";
                await context.Response.WriteAsync(response);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error in HTTP-to-stdio bridge");
                context.Response.StatusCode = 500;
                await context.Response.WriteAsync($"Bridge error: {ex.Message}");
            }
        });

        try
        {
            // Start Avalonia GUI and HTTP bridge concurrently
            var avaloniaTask = Task.Run(() => StartAvaloniaApp(app.Services));
            var webAppTask = app.RunAsync();

            // Wait for either to complete
            await Task.WhenAny(avaloniaTask, webAppTask);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "An error occurred while running the HTTP bridge");
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