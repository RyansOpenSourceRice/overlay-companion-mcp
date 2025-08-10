using OverlayCompanion.Services;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading.Tasks;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// MCP tool for reading clipboard content
/// Implements the get_clipboard tool from MCP_SPECIFICATION.md
/// </summary>
public class GetClipboardTool : IMcpTool
{
    private readonly IModeManager _modeManager;

    public string Name => "get_clipboard";
    public string Description => "Get the current clipboard content";

    public GetClipboardTool(IModeManager modeManager)
    {
        _modeManager = modeManager;
    }

    public async Task<object> ExecuteAsync(Dictionary<string, object> parameters)
    {
        // Check if action is allowed in current mode
        if (!_modeManager.CanExecuteAction(Name))
        {
            throw new InvalidOperationException($"Action '{Name}' not allowed in {_modeManager.CurrentMode} mode");
        }

        try
        {
            var clipboardText = await GetClipboardTextAsync();
            
            return new
            {
                text = clipboardText ?? string.Empty,
                available = !string.IsNullOrEmpty(clipboardText)
            };
        }
        catch (Exception ex)
        {
            return new
            {
                text = string.Empty,
                available = false,
                error = ex.Message
            };
        }
    }

    private async Task<string?> GetClipboardTextAsync()
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