using OverlayCompanion.Services;
using System.ComponentModel;
using System.Diagnostics;
using ModelContextProtocol.Server;
using System.Diagnostics.CodeAnalysis;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// MCP tool for setting clipboard content
/// Implements the set_clipboard tool from MCP_SPECIFICATION.md
/// </summary>
[McpServerToolType]
public static class SetClipboardTool
{
    [McpServerTool, Description("Set the clipboard content")]
    [RequiresUnreferencedCode("JSON serialization may require types that cannot be statically analyzed")]
    public static async Task<string> SetClipboard(
        IModeManager modeManager,
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

        if (!needsConfirmation || wasConfirmed)
        {
            success = await SetClipboardTextAsync(text, format);
        }

        var response = new
        {
            ok = success,
            text_length = text.Length,
            format = format,
            confirmation_required = needsConfirmation,
            confirmed = wasConfirmed
        };

        return System.Text.Json.JsonSerializer.Serialize(response);
    }

    private static async Task<bool> SetClipboardTextAsync(string text, string format = "text")
    {
        try
        {
            // Use xclip to set clipboard content on Linux
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
            // Try alternative clipboard tools
        }

        try
        {
            // Try wl-copy for Wayland
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
            // Clipboard access failed
        }

        return false;
    }
}