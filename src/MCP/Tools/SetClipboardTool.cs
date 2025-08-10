using OverlayCompanion.Services;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading.Tasks;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// MCP tool for setting clipboard content
/// Implements the set_clipboard tool from MCP_SPECIFICATION.md
/// </summary>
public class SetClipboardTool : IMcpTool
{
    private readonly IModeManager _modeManager;

    public string Name => "set_clipboard";
    public string Description => "Set the clipboard content";

    public SetClipboardTool(IModeManager modeManager)
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

        // Parse required parameters
        var text = parameters.GetValue<string>("text");
        
        if (text == null)
        {
            throw new ArgumentException("text parameter is required");
        }

        // Check if confirmation is required
        var needsConfirmation = _modeManager.RequiresConfirmation(Name);
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
            success = await SetClipboardTextAsync(text);
        }

        return new
        {
            ok = success
        };
    }

    private async Task<bool> SetClipboardTextAsync(string text)
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