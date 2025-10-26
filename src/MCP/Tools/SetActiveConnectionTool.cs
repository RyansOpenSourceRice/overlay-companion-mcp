using ModelContextProtocol.Server;
using OverlayCompanion.Services;
using System.ComponentModel;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// Tool for setting the active connection
/// </summary>
[McpServerToolType]
public class SetActiveConnectionTool
{
    private readonly IConnectionManagementService _connectionService;

    public SetActiveConnectionTool(IConnectionManagementService connectionService)
    {
        _connectionService = connectionService;
    }

    [McpServerTool]
    [Description("Set the active connection for overlay and screen interaction operations")]
    public async Task<object> SetActiveConnection(
        [Description("Connection ID to set as active")] string connectionId)
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

            var result = await _connectionService.SetActiveConnectionAsync(connectionId);

            return new
            {
                success = result,
                active_connection = new
                {
                    id = connection.Id,
                    name = connection.Name,
                    host = connection.Host,
                    port = connection.Port,
                    protocol = connection.Protocol
                },
                message = result
                    ? $"Active connection set to '{connection.Name}' ({connection.Protocol}://{connection.Host}:{connection.Port})"
                    : $"Failed to set active connection"
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
