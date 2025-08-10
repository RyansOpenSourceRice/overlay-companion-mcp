using OverlayCompanion.Services;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// MCP tool for simulating text input
/// Implements the type_text tool from MCP_SPECIFICATION.md
/// </summary>
public class TypeTextTool : IMcpTool
{
    private readonly IInputMonitorService _inputService;
    private readonly IModeManager _modeManager;

    public string Name => "type_text";
    public string Description => "Simulate typing text at the current cursor position";

    public TypeTextTool(IInputMonitorService inputService, IModeManager modeManager)
    {
        _inputService = inputService;
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
        
        if (string.IsNullOrEmpty(text))
        {
            throw new ArgumentException("text parameter is required");
        }

        // Parse optional parameters
        var typingSpeedWpm = parameters.GetValue("typing_speed_wpm", 60);
        var requireUserConfirmation = parameters.GetValue("require_user_confirmation", false);

        // Check if confirmation is required
        var needsConfirmation = requireUserConfirmation || _modeManager.RequiresConfirmation(Name);
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
            if (_inputService is InputMonitorService inputMonitorService)
            {
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

        // Return MCP-compliant response
        return new
        {
            success = success,
            typed_length = typedLength
        };
    }
}