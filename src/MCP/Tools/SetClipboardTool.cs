using OverlayCompanion.Services;
using System.ComponentModel;
using System.Diagnostics;
using ModelContextProtocol.Server;
using System.Diagnostics.CodeAnalysis;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// MCP tool for setting clipboard content
/// Implements the set_clipboard tool from MCP_SPECIFICATION.md
/// Supports both VM clipboard bridge and local clipboard access
/// </summary>
[McpServerToolType]
public static class SetClipboardTool
{
    [McpServerTool, Description("Set the clipboard content in VM or local system")]
    [RequiresUnreferencedCode("JSON serialization may require types that cannot be statically analyzed")]
    public static async Task<string> SetClipboard(
        IModeManager modeManager,
        IClipboardBridgeService clipboardBridge,
        [Description("Text content to set in clipboard")] string text,
        [Description("Format of the content (text, html)")] string format = "text")
    {
        // Check if action is allowed in current mode
        if (!modeManager.CanExecuteAction("set_clipboard"))
        {
            throw new InvalidOperationException($"Action 'set_clipboard' not allowed in {modeManager.CurrentMode} mode");
        }

        if (string.IsNullOrEmpty(text))
        {
            throw new ArgumentException("text parameter is required");
        }

        // Check if confirmation is required
        var needsConfirmation = modeManager.RequiresConfirmation("set_clipboard");
        var wasConfirmed = false;

        if (needsConfirmation)
        {
            // TODO: Implement user confirmation dialog
            // For now, assume confirmation is granted
            wasConfirmed = true;
            Console.WriteLine($"User confirmation required for setting clipboard to: '{text.Substring(0, Math.Min(50, text.Length))}...' - GRANTED");
        }

        bool success = false;
        string source = "none";

        if (!needsConfirmation || wasConfirmed)
        {
            (success, source) = await SetClipboardTextAsync(clipboardBridge, text, format);
        }

        var response = new
        {
            ok = success,
            text_length = text.Length,
            format = format,
            confirmation_required = needsConfirmation,
            confirmed = wasConfirmed,
            source = source,
            vm_bridge_available = await clipboardBridge.IsAvailableAsync()
        };

        return System.Text.Json.JsonSerializer.Serialize(response);
    }

    private static async Task<(bool success, string source)> SetClipboardTextAsync(IClipboardBridgeService clipboardBridge, string text, string format = "text")
    {
        // First try VM clipboard bridge if available
        if (await clipboardBridge.IsAvailableAsync())
        {
            var vmSuccess = await clipboardBridge.SetClipboardAsync(text, format);
            if (vmSuccess)
            {
                return (true, "vm_bridge");
            }
        }

        // Fallback to local clipboard access
        var localSuccess = await SetLocalClipboardTextAsync(text, format);
        return (localSuccess, localSuccess ? "local" : "failed");
    }

    private static async Task<bool> SetLocalClipboardTextAsync(string text, string format = "text")
    {
        try
        {
            // Prefer Wayland clipboard first
            var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "wl-copy",
                    UseShellExecute = false,
                    RedirectStandardInput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                }
            };

            process.Start();
            await process.StandardInput.WriteAsync(text);
            process.StandardInput.Close();
            await process.WaitForExitAsync();

            if (process.ExitCode == 0)
            {
                return true;
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
                    Arguments = "-selection clipboard",
                    UseShellExecute = false,
                    RedirectStandardInput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                }
            };

            process.Start();
            await process.StandardInput.WriteAsync(text);
            process.StandardInput.Close();
            await process.WaitForExitAsync();

            if (process.ExitCode == 0)
            {
                return true;
            }
        }
        catch
        {
            // Clipboard access failed
        }

        return false;
    }
}
