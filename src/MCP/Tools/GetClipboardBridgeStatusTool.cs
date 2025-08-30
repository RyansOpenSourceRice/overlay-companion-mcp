using OverlayCompanion.Services;
using System.ComponentModel;
using ModelContextProtocol.Server;
using System.Diagnostics.CodeAnalysis;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// MCP tool for checking clipboard bridge status and configuration
/// Provides information about VM clipboard bridge availability and configuration
/// </summary>
[McpServerToolType]
public static class GetClipboardBridgeStatusTool
{
    [McpServerTool, Description("Get the status and configuration of the VM clipboard bridge")]
    [RequiresUnreferencedCode("JSON serialization may require types that cannot be statically analyzed")]
    public static async Task<string> GetClipboardBridgeStatus(
        IClipboardBridgeService clipboardBridge,
        IConfiguration configuration)
    {
        try
        {
            var isAvailable = await clipboardBridge.IsAvailableAsync();
            var baseUrl = configuration["ClipboardBridge:BaseUrl"] ?? "http://localhost:8765";
            var apiKey = configuration["ClipboardBridge:ApiKey"] ?? "overlay-companion-mcp";

            var response = new
            {
                available = isAvailable,
                configured = true,
                base_url = baseUrl,
                api_key_configured = !string.IsNullOrEmpty(apiKey),
                status = isAvailable ? "connected" : "disconnected",
                description = isAvailable 
                    ? "VM clipboard bridge is available and responding"
                    : "VM clipboard bridge is not available - clipboard operations will use local system only",
                fallback_enabled = true,
                features = new
                {
                    vm_clipboard_sync = isAvailable,
                    local_clipboard_fallback = true,
                    multi_backend_support = true,
                    wayland_support = true,
                    x11_support = true
                }
            };

            return System.Text.Json.JsonSerializer.Serialize(response);
        }
        catch (Exception ex)
        {
            var response = new
            {
                available = false,
                configured = false,
                error = ex.Message,
                status = "error",
                description = "Failed to check clipboard bridge status",
                fallback_enabled = true
            };

            return System.Text.Json.JsonSerializer.Serialize(response);
        }
    }
}