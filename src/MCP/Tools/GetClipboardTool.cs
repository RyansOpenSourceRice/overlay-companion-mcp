using OverlayCompanion.Services;
using System.ComponentModel;
using System.Diagnostics;
using ModelContextProtocol.Server;
using System.Diagnostics.CodeAnalysis;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// MCP tool for reading clipboard content
/// Implements the get_clipboard tool from MCP_SPECIFICATION.md
/// Supports both VM clipboard bridge and local clipboard access
/// </summary>
[McpServerToolType]
public static class GetClipboardTool
{
    [McpServerTool, Description("Get the current clipboard content from VM or local system (Wayland/X11 compatible)")]
    [RequiresUnreferencedCode("JSON serialization may require types that cannot be statically analyzed")]
    public static async Task<string> GetClipboard(
        IModeManager modeManager,
        IClipboardBridgeService clipboardBridge,
        [Description("Format to retrieve (text, html, image)")] string format = "text")
    {
        // Check if action is allowed in current mode
        if (!modeManager.CanExecuteAction("get_clipboard"))
        {
            throw new InvalidOperationException($"Action 'get_clipboard' not allowed in {modeManager.CurrentMode} mode");
        }

        try
        {
            var (clipboardText, source) = await GetClipboardTextAsync(clipboardBridge, format);

            var response = new
            {
                text = clipboardText ?? string.Empty,
                available = !string.IsNullOrEmpty(clipboardText),
                format = format,
                source = source,
                vm_bridge_available = await clipboardBridge.IsAvailableAsync()
            };

            return System.Text.Json.JsonSerializer.Serialize(response);
        }
        catch (Exception ex)
        {
            var response = new
            {
                text = string.Empty,
                available = false,
                error = ex.Message,
                format = format,
                source = "error",
                vm_bridge_available = false
            };

            return System.Text.Json.JsonSerializer.Serialize(response);
        }
    }

    private static async Task<(string? content, string source)> GetClipboardTextAsync(IClipboardBridgeService clipboardBridge, string format = "text")
    {
        // First try VM clipboard bridge if available
        if (await clipboardBridge.IsAvailableAsync())
        {
            var vmClipboard = await clipboardBridge.GetClipboardAsync(format);
            if (vmClipboard != null)
            {
                return (vmClipboard, "vm_bridge");
            }
        }

        // Fallback to local clipboard access
        var localClipboard = await GetLocalClipboardTextAsync(format);
        return (localClipboard, localClipboard != null ? "local" : "none");
    }

    private static async Task<string?> GetLocalClipboardTextAsync(string format = "text")
    {
        try
        {
            // Prefer Wayland clipboard first
            var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "wl-paste",
                    Arguments = "--no-newline",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                }
            };

            process.Start();
            var output = await process.StandardOutput.ReadToEndAsync();
            await process.WaitForExitAsync();

            if (process.ExitCode == 0)
            {
                return output;
            }
        }
        catch
        {
            // Try X11 clipboard tools next
        }

        try
        {
            // Fallback to xclip on X11
            var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "xclip",
                    Arguments = "-selection clipboard -o",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                }
            };

            process.Start();
            var output = await process.StandardOutput.ReadToEndAsync();
            await process.WaitForExitAsync();

            if (process.ExitCode == 0)
            {
                return output;
            }
        }
        catch
        {
            // Clipboard access failed
        }

        return null;
    }
}
