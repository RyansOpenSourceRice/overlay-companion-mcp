using OverlayCompanion.Models;
using OverlayCompanion.Services;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// MCP tool for setting operational mode
/// Implements the set_mode tool from MCP_SPECIFICATION.md
/// </summary>
public class SetModeTool : IMcpTool
{
    private readonly IModeManager _modeManager;

    public string Name => "set_mode";
    public string Description => "Set the operational mode of the overlay companion";

    public SetModeTool(IModeManager modeManager)
    {
        _modeManager = modeManager;
    }

    public async Task<object> ExecuteAsync(Dictionary<string, object> parameters)
    {
        // Parse required parameters
        var modeString = parameters.GetValue("mode", "passive");
        var metadata = parameters.GetValue<Dictionary<string, object>?>("metadata", null);

        // Parse mode enum
        if (!Enum.TryParse<OperationalMode>(modeString, true, out var mode))
        {
            throw new ArgumentException($"Invalid mode: {modeString}. Valid modes are: {string.Join(", ", Enum.GetNames<OperationalMode>())}");
        }

        // Set the mode
        var success = await _modeManager.SetModeAsync(mode, metadata);

        // Return MCP-compliant response
        return new
        {
            ok = success,
            active_mode = _modeManager.CurrentMode.ToString().ToLower()
        };
    }
}