using ModelContextProtocol.Server;
using OverlayCompanion.Services;
using System.ComponentModel;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// Tool for testing connection connectivity
/// </summary>
[McpServerToolType]
public class TestConnectionTool
{
    private readonly IConnectionManagementService _connectionService;

    public TestConnectionTool(IConnectionManagementService connectionService)
    {
        _connectionService = connectionService;
    }

    [McpServerTool]
    [Description("Test connectivity to a configured connection by attempting to connect to the specified host and port")]
    public async Task<object> TestConnection(
        [Description("Connection ID to test")] string connectionId)
    {
        try
        {
            var connection = await _connectionService.GetConnectionAsync(connectionId);
            if (connection == null)
            {
                return new
                {
                    success = false,
                    error = $"Connection with ID '{connectionId}' not found"
                };
            }

            var testResult = await _connectionService.TestConnectionAsync(connectionId);

            return new
            {
                success = testResult,
                connection = new
                {
                    id = connection.Id,
                    name = connection.Name,
                    host = connection.Host,
                    port = connection.Port,
                    protocol = connection.Protocol
                },
                message = testResult
                    ? $"Successfully connected to {connection.Host}:{connection.Port}"
                    : $"Failed to connect to {connection.Host}:{connection.Port} - check host, port, and network connectivity",
                last_connected = connection.LastConnected
            };
        }
        catch (Exception ex)
        {
            return new
            {
                success = false,
                error = ex.Message
            };
        }
    }
}
