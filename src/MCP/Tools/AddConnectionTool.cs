using ModelContextProtocol.Server;
using OverlayCompanion.Services;
using System.ComponentModel;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// Tool for adding a new connection configuration (KasmVNC, VNC, or RDP)
/// </summary>
[McpServerToolType]
public class AddConnectionTool
{
    private readonly IConnectionManagementService _connectionService;

    public AddConnectionTool(IConnectionManagementService connectionService)
    {
        _connectionService = connectionService;
    }

    [McpServerTool]
    [Description("Add a new connection configuration for KasmVNC, VNC, or RDP. RDP requires both username and password. KasmVNC is recommended for multi-monitor support.")]
    public async Task<object> AddConnection(
        [Description("Friendly name for the connection")] string name,
        [Description("Host IP address or hostname")] string host,
        [Description("Port number (default: KasmVNC=6901, VNC=5900, RDP=3389)")] int port,
        [Description("Protocol type: 'kasmvnc' (recommended for multi-monitor), 'vnc' (standard VNC), or 'rdp' (Windows RDP)")] string protocol,
        [Description("Username (required for RDP, optional for VNC/KasmVNC)")] string? username = null,
        [Description("Password (required for RDP, recommended for VNC/KasmVNC)")] string? password = null)
    {
        try
        {
            var config = new ConnectionConfig
            {
                Name = name,
                Host = host,
                Port = port,
                Protocol = protocol.ToLowerInvariant(),
                Username = username,
                Password = password
            };

            // Validate first
            var validation = await _connectionService.ValidateConnectionAsync(config);
            if (!validation.IsValid)
            {
                return new
                {
                    success = false,
                    errors = validation.Errors,
                    warnings = validation.Warnings
                };
            }

            // Add the connection
            var added = await _connectionService.AddConnectionAsync(config);

            return new
            {
                success = true,
                connection = new
                {
                    id = added.Id,
                    name = added.Name,
                    host = added.Host,
                    port = added.Port,
                    protocol = added.Protocol,
                    has_username = !string.IsNullOrEmpty(added.Username),
                    has_password = !string.IsNullOrEmpty(added.Password),
                    created_at = added.CreatedAt
                },
                warnings = validation.Warnings,
                message = $"Connection '{name}' added successfully. Use test_connection to verify connectivity."
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
