using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ModelContextProtocol;
using System.Text.Json;

namespace OverlayCompanion.MCP;

/// <summary>
/// Hosted service that runs the MCP server using the official ModelContextProtocol SDK
/// </summary>
public class OverlayCompanionMcpService : BackgroundService
{
    private readonly ILogger<OverlayCompanionMcpService> _logger;
    private readonly McpToolRegistry _toolRegistry;
    private readonly IOptionsMonitor<McpServerOptions> _options;
    // TODO: Fix MCP SDK integration - IMcpServer type not found
    // private IMcpServer? _mcpServer;

    public OverlayCompanionMcpService(
        ILogger<OverlayCompanionMcpService> logger,
        McpToolRegistry toolRegistry,
        IOptionsMonitor<McpServerOptions> options)
    {
        _logger = logger;
        _toolRegistry = toolRegistry;
        _options = options;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            _logger.LogInformation("Starting MCP server...");
            
            // TODO: Fix MCP SDK integration - types not found in current package version
            _logger.LogWarning("MCP server integration temporarily disabled due to SDK compatibility issues");
            
            /*
            // Create MCP server using official SDK
            var serverBuilder = new McpServerBuilder()
                .WithServerInfo(_options.CurrentValue.ServerInfo)
                .WithStdioTransport(); // Use stdio transport for Jan.ai compatibility

            // Register tools from our registry
            foreach (var tool in _toolRegistry.GetAllTools())
            {
                serverBuilder.WithTool(tool.Name, tool.Description, async (parameters) =>
                {
                    try
                    {
                        var result = await tool.ExecuteAsync(parameters);
                        return result;
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Error executing tool {ToolName}", tool.Name);
                        throw;
                    }
                });
            }

            _mcpServer = serverBuilder.Build();
            */

            _logger.LogInformation("MCP server started successfully with {ToolCount} tools", 
                _toolRegistry.GetToolNames().Length);

            // TODO: Run the actual MCP server when SDK is fixed
            // await _mcpServer.RunAsync(stoppingToken);
            
            // For now, just keep the service running
            await Task.Delay(Timeout.Infinite, stoppingToken);
        }
        catch (OperationCanceledException)
        {
            _logger.LogInformation("MCP server shutdown requested");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error running MCP server");
            throw;
        }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("Stopping MCP server...");
        
        // TODO: Stop actual MCP server when SDK is fixed
        /*
        if (_mcpServer != null)
        {
            await _mcpServer.StopAsync(cancellationToken);
            _mcpServer.Dispose();
        }
        */

        await base.StopAsync(cancellationToken);
        _logger.LogInformation("MCP server stopped");
    }
}

/// <summary>
/// Configuration options for the MCP server
/// </summary>
public class McpServerOptions
{
    public McpServerInfo ServerInfo { get; set; } = new();
}

/// <summary>
/// Server information for MCP protocol
/// </summary>
public class McpServerInfo
{
    public string Name { get; set; } = string.Empty;
    public string Version { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
}