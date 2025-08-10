using OverlayCompanion.Models;
using OverlayCompanion.Services;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// MCP tool for drawing multiple overlays at once
/// Implements the batch_overlay tool from MCP_SPECIFICATION.md
/// </summary>
public class BatchOverlayTool : IMcpTool
{
    private readonly IOverlayService _overlayService;
    private readonly IModeManager _modeManager;

    public string Name => "batch_overlay";
    public string Description => "Draw multiple overlays at once";

    public BatchOverlayTool(IOverlayService overlayService, IModeManager modeManager)
    {
        _overlayService = overlayService;
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
        var overlaysData = parameters.GetValue<object[]>("overlays");
        
        if (overlaysData == null || overlaysData.Length == 0)
        {
            throw new ArgumentException("overlays parameter is required and must not be empty");
        }

        // Parse optional parameters
        var oneAtATime = parameters.GetValue("one_at_a_time", false);

        // Convert overlay data to OverlayElement objects
        var overlays = new List<OverlayElement>();
        
        foreach (var overlayData in overlaysData)
        {
            if (overlayData is Dictionary<string, object> overlayDict)
            {
                var overlay = new OverlayElement
                {
                    Bounds = new ScreenRegion(
                        overlayDict.GetValue("x", 0),
                        overlayDict.GetValue("y", 0),
                        overlayDict.GetValue("width", 50),
                        overlayDict.GetValue("height", 50)
                    ),
                    Color = overlayDict.GetValue("color", "Yellow"),
                    Label = overlayDict.GetValue<string?>("label", null),
                    TemporaryMs = overlayDict.GetValue("temporary_ms", 0)
                };
                
                overlays.Add(overlay);
            }
        }

        if (overlays.Count == 0)
        {
            throw new ArgumentException("No valid overlay definitions found in overlays parameter");
        }

        // Draw overlays
        var overlayIds = await _overlayService.DrawBatchOverlaysAsync(overlays.ToArray(), oneAtATime);

        // Return MCP-compliant response
        return new
        {
            overlay_ids = overlayIds
        };
    }
}