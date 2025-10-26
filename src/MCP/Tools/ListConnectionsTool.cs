using ModelContextProtocol.Server;
using OverlayCompanion.Services;
using System.ComponentModel;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// Tool for listing all configured connections
/// </summary>
[McpServerToolType]
public class ListConnectionsTool
{
    private readonly IConnectionManagementService _connectionService;

    public ListConnectionsTool(IConnectionManagementService connectionService)
    {
        _connectionService = connectionService;
    }

    [McpServerTool]
    [Description("List all configured connections (KasmVNC, VNC, RDP). Shows connection details without exposing credentials.")]
    public async Task<object> ListConnections()
    {
        try
        {
            var connections = await _connectionService.GetAllConnectionsAsync();

            return new
            {
                success = true,
                total_connections = connections.Count,
                connections = connections.Select(c => new
                {
                    id = c.Id,
                    name = c.Name,
                    host = c.Host,
                    port = c.Port,
                    protocol = c.Protocol,
                    protocol_info = GetProtocolInfo(c.Protocol),
                    has_username = !string.IsNullOrEmpty(c.Username),
                    has_password = !string.IsNullOrEmpty(c.Password),
                    is_active = c.IsActive,
                    created_at = c.CreatedAt,
                    last_connected = c.LastConnected
                }).ToList(),
                protocol_recommendations = new
                {
                    kasmvnc = "Recommended for multi-monitor support - independent browser windows per display",
                    vnc = "Standard VNC - limited multi-monitor (single canvas)",
                    rdp = "Windows RDP - requires username+password, multi-monitor on Windows 7+ Enterprise/Ultimate"
                }
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

    private static object GetProtocolInfo(string protocol)
    {
        return protocol.ToLowerInvariant() switch
        {
            "kasmvnc" => new
            {
                name = "KasmVNC",
                default_port = 6901,
                multi_monitor = "Full support - independent browser windows",
                authentication = "Flexible - password-only or username+password",
                recommended = true
            },
            "vnc" => new
            {
                name = "Standard VNC",
                default_port = 5900,
                multi_monitor = "Limited - single canvas display",
                authentication = "Password-only (username optional)",
                recommended = false
            },
            "rdp" => new
            {
                name = "Windows RDP",
                default_port = 3389,
                multi_monitor = "Supported on Windows 7+ Enterprise/Ultimate",
                authentication = "Username+password required",
                recommended = false
            },
            _ => new
            {
                name = "Unknown",
                default_port = 0,
                multi_monitor = "Unknown",
                authentication = "Unknown",
                recommended = false
            }
        };
    }
}
