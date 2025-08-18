using OverlayCompanion.Services;
using System.ComponentModel;
using System.Diagnostics;
using ModelContextProtocol.Server;
using System.Diagnostics.CodeAnalysis;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// MCP tool for reading clipboard content
/// Implements the get_clipboard tool from MCP_SPECIFICATION.md
/// </summary>
[McpServerToolType]
public static class GetClipboardTool
{
    [McpServerTool, Description("Get the current clipboard content (Wayland/X11 compatible)")]
    [RequiresUnreferencedCode("JSON serialization may require types that cannot be statically analyzed")]
    public static async Task<string> GetClipboard(
        IModeManager modeManager,
        [Description("Format to retrieve (text, html, image)")] string format = "text")
    {
        // Check if action is allowed in current mode
        if (!modeManager.CanExecuteAction("get_clipboard"))
        {
            throw new InvalidOperationException($"Action 'get_clipboard' not allowed in {modeManager.CurrentMode} mode");
        }

        try
        {
            var clipboardText = await GetClipboardTextAsync(format);

            var response = new
            {
                text = clipboardText ?? string.Empty,
                available = !string.IsNullOrEmpty(clipboardText),
                format = format
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
                format = format
            };

            return System.Text.Json.JsonSerializer.Serialize(response);
        }
    }

    private static async Task<string?> GetClipboardTextAsync(string format = "text")
    {
        try
        {
            // Use xclip to get clipboard content on Linux
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
            // Try alternative clipboard tools
        }

        try
        {
            // Try wl-paste for Wayland
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
            // Clipboard access failed
        }

        return null;
    }
}