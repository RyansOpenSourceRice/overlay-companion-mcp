using OverlayCompanion.Models;
using OverlayCompanion.Services;
using System.ComponentModel;
using ModelContextProtocol.Server;
using System.Diagnostics.CodeAnalysis;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// MCP tool for setting operational mode
/// Implements the set_mode tool from MCP_SPECIFICATION.md
/// </summary>
[McpServerToolType]
public static class SetModeTool
{
    [McpServerTool, Description("Set the operational mode of the overlay companion")]
    [RequiresUnreferencedCode("JSON serialization may require types that cannot be statically analyzed")]
    public static async Task<string> SetMode(
        IModeManager modeManager,
        [Description("Operational mode (passive, assist, autopilot, composing)")] string mode = "passive",
        [Description("Optional metadata for the mode change")] string? metadata = null)
    {
        // Parse mode enum
        if (!Enum.TryParse<OperationalMode>(mode, true, out var operationalMode))
        {
            throw new ArgumentException($"Invalid mode: {mode}. Valid modes are: {string.Join(", ", Enum.GetNames<OperationalMode>())}");
        }

        // Parse metadata if provided
        Dictionary<string, object>? metadataDict = null;
        if (!string.IsNullOrEmpty(metadata))
        {
            try
            {
                metadataDict = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, object>>(metadata);
            }
            catch (System.Text.Json.JsonException)
            {
                // If metadata is not valid JSON, treat it as a simple string value
                metadataDict = new Dictionary<string, object> { ["value"] = metadata };
            }
        }

        // Set the mode
        var success = await modeManager.SetModeAsync(operationalMode, metadataDict);

        // Return JSON string response
        var response = new
        {
            ok = success,
            active_mode = modeManager.CurrentMode.ToString().ToLower(),
            previous_mode = operationalMode.ToString().ToLower(),
            metadata_applied = metadataDict != null
        };

        return System.Text.Json.JsonSerializer.Serialize(response);
    }
}
