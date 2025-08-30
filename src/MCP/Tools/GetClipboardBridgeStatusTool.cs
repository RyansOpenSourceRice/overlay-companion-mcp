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
        ISettingsService settingsService)
    {
        try
        {
            var settings = await settingsService.GetClipboardBridgeSettingsAsync();
            var isAvailable = await clipboardBridge.IsAvailableAsync();

            var response = new
            {
                enabled = settings.Enabled,
                available = isAvailable,
                configured = true,
                base_url = settings.BaseUrl,
                api_key_configured = !string.IsNullOrEmpty(settings.ApiKey),
                timeout_seconds = settings.TimeoutSeconds,
                fallback_to_local = settings.FallbackToLocal,
                status = !settings.Enabled ? "disabled" : (isAvailable ? "connected" : "disconnected"),
                description = !settings.Enabled
                    ? "VM clipboard bridge is disabled - clipboard operations will use local system only"
                    : isAvailable
                        ? "VM clipboard bridge is available and responding"
                        : "VM clipboard bridge is not available - clipboard operations will use local system only",
                features = new
                {
                    vm_clipboard_sync = settings.Enabled && isAvailable,
                    local_clipboard_fallback = settings.FallbackToLocal,
                    multi_backend_support = true,
                    wayland_support = true,
                    x11_support = true,
                    web_configurable = true
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
