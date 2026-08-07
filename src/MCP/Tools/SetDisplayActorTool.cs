using OverlayCompanion.Services;
using System.ComponentModel;
using System.Text.Json;
using System.Diagnostics.CodeAnalysis;
using ModelContextProtocol.Server;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// MCP tool for switching display ownership between the in-app ("interior")
/// assistant and an external ("exterior") MCP agent. Only one owns the canvas
/// at a time; switching releases overlays authored by the other actor. The
/// human (or an authorized agent) uses this to decide who may draw.
/// </summary>
[McpServerToolType]
public static class SetDisplayActorTool
{
    [McpServerTool, Description(
        "Set which agent owns overlay drawing on the shared display. " +
        "'interior' = the in-app chat assistant; 'exterior' = an external MCP agent. " +
        "Only the active owner may draw overlays; switching releases the other actor's overlays. " +
        "Requires mode confirmation for safety.")]
    [RequiresUnreferencedCode("JSON serialization may require types that cannot be statically analyzed")]
    public static async Task<string> SetDisplayActor(
        IDisplayActorGate displayActor,
        IModeManager modeManager,
        [Description("Actor to activate: 'interior' (in-app assistant) or 'exterior' (external MCP agent)")] string actor)
    {
        if (!modeManager.CanExecuteAction("set_display_actor"))
        {
            throw new InvalidOperationException($"Action 'set_display_actor' not allowed in {modeManager.CurrentMode} mode");
        }

        var target = (actor ?? "").ToActor();
        var previous = await displayActor.GetActiveActorAsync();
        var activated = await displayActor.SetActiveActorAsync(target);

        var response = new
        {
            success = true,
            previous_actor = previous.ToKey(),
            active_actor = activated.ToKey(),
            released_other_overlays = activated != previous
        };
        return JsonSerializer.Serialize(response);
    }
}
