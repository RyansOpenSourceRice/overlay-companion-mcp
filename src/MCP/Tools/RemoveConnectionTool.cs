using ModelContextProtocol.Server;
using OverlayCompanion.Services;
using System.ComponentModel;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// Tool for removing a connection configuration
/// </summary>
[McpServerToolType]
public class RemoveConnectionTool
{
    private readonly IConnectionManagementService _connectionService;

    public RemoveConnectionTool(IConnectionManagementService connectionService)
    {
        _connectionService = connectionService;
    }

    [McpServerTool]
    [Description("Remove a connection configuration by ID")]
    public async Task<object> RemoveConnection(
        [Description("Connection ID to remove")] string connectionId)
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

            var removed = await _connectionService.RemoveConnectionAsync(connectionId);

            return new
            {
                success = removed,
                message = removed
                    ? $"Connection '{connection.Name}' removed successfully"
                    : $"Failed to remove connection '{connection.Name}'"
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
