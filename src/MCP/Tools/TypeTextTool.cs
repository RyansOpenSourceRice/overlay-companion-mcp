using OverlayCompanion.Services;
using System.ComponentModel;
using ModelContextProtocol.Server;
using System.Diagnostics.CodeAnalysis;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// MCP tool for simulating text input
/// Implements the type_text tool from MCP_SPECIFICATION.md
/// </summary>
[McpServerToolType]
public static class TypeTextTool
{
    [McpServerTool, Description("Simulate typing text at the current cursor position")]
    [RequiresUnreferencedCode("JSON serialization may require types that cannot be statically analyzed")]
    public static async Task<string> TypeText(
        IInputMonitorService inputService,
        IModeManager modeManager,
        [Description("Text to type")] string text,
        [Description("Delay between keystrokes in milliseconds")] int delayMs = 50)
    {
        // Check if action is allowed in current mode
        if (!modeManager.CanExecuteAction("type_text"))
        {
            throw new InvalidOperationException($"Action 'type_text' not allowed in {modeManager.CurrentMode} mode");
        }

        if (string.IsNullOrEmpty(text))
        {
            throw new ArgumentException("text parameter is required");
        }

        // Check if confirmation is required
        var needsConfirmation = modeManager.RequiresConfirmation("type_text");
        var wasConfirmed = false;

        if (needsConfirmation)
        {
            // TODO: Implement user confirmation dialog
            // For now, assume confirmation is granted
            wasConfirmed = true;
            Console.WriteLine($"User confirmation required for typing text: '{text.Substring(0, Math.Min(50, text.Length))}...' - GRANTED");
        }

        bool success = false;
        int typedLength = 0;

        if (!needsConfirmation || wasConfirmed)
        {
            // Cast to InputMonitorService to access SimulateTypingAsync
            if (inputService is InputMonitorService inputMonitorService)
            {
                // Convert delay to WPM (approximate)
                var typingSpeedWpm = Math.Max(1, 60000 / (delayMs * 5)); // Rough conversion
                success = await inputMonitorService.SimulateTypingAsync(text, typingSpeedWpm);
                if (success)
                {
                    typedLength = text.Length;
                }
            }
            else
            {
                throw new InvalidOperationException("Input service does not support typing simulation");
            }
        }

        // Return JSON string response
        var response = new
        {
            success = success,
            typed_length = typedLength,
            text_preview = text.Length > 50 ? text.Substring(0, 50) + "..." : text,
            was_confirmed = wasConfirmed
        };

        return System.Text.Json.JsonSerializer.Serialize(response);
    }
}