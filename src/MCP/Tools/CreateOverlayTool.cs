using ModelContextProtocol.Server;
using OverlayCompanion.Models;
using OverlayCompanion.Services;
using System.ComponentModel;

namespace OverlayCompanion.MCP.Tools;

public class CreateOverlayRequest
{
    [Description("X coordinate of the overlay")]
    public int X { get; set; }

    [Description("Y coordinate of the overlay")]
    public int Y { get; set; }

    [Description("Width of the overlay")]
    public int Width { get; set; }

    [Description("Height of the overlay")]
    public int Height { get; set; }

    [Description("Color of the overlay in hex format (e.g., #ff0000)")]
    public string? Color { get; set; }

    [Description("Opacity of the overlay (0.0 to 1.0)")]
    public double? Opacity { get; set; }

    [Description("Label text to display on the overlay")]
    public string? Label { get; set; }

    [Description("Whether the overlay should be click-through")]
    public bool? ClickThrough { get; set; }

    [Description("Monitor index for multi-monitor setups (0-based)")]
    public int? MonitorIndex { get; set; }

    [Description("Auto-remove overlay after this many milliseconds (0 for permanent)")]
    public int? TemporaryMs { get; set; }
}

public class CreateOverlayResponse
{
    public string OverlayId { get; set; } = string.Empty;
    public bool Success { get; set; }
    public bool KasmVNCSync { get; set; }
    public string? Error { get; set; }
    public DisplayInfo[]? AvailableDisplays { get; set; }
}

[Tool("create_overlay")]
[Description("Create a visual overlay on the screen with KasmVNC integration for multi-monitor support")]
public class CreateOverlayTool : IMcpTool<CreateOverlayRequest, CreateOverlayResponse>
{
    private readonly IOverlayService _overlayService;
    private readonly IKasmVNCService _kasmvncService;
    private readonly ILogger<CreateOverlayTool> _logger;

    public CreateOverlayTool(
        IOverlayService overlayService, 
        IKasmVNCService kasmvncService,
        ILogger<CreateOverlayTool> logger)
    {
        _overlayService = overlayService;
        _kasmvncService = kasmvncService;
        _logger = logger;
    }

    public async Task<CreateOverlayResponse> ExecuteAsync(CreateOverlayRequest request)
    {
        try
        {
            _logger.LogInformation("Creating overlay at ({X}, {Y}) with size {Width}x{Height}", 
                request.X, request.Y, request.Width, request.Height);

            // Get available displays for validation and response
            var displays = await _kasmvncService.GetDisplaysAsync();
            var monitorIndex = request.MonitorIndex ?? 0;

            // Validate monitor index
            if (monitorIndex >= displays.Length)
            {
                _logger.LogWarning("Invalid monitor index {Index}, using primary display", monitorIndex);
                monitorIndex = 0;
            }

            // Create overlay locally
            var overlay = new OverlayElement
            {
                Bounds = new ScreenRegion(request.X, request.Y, request.Width, request.Height),
                Color = request.Color ?? "#ff0000",
                Opacity = request.Opacity ?? 0.5,
                Label = request.Label,
                ClickThrough = request.ClickThrough ?? true,
                MonitorIndex = monitorIndex,
                TemporaryMs = request.TemporaryMs
            };

            var overlayId = await _overlayService.DrawOverlayAsync(overlay);
            _logger.LogDebug("Created local overlay with ID: {OverlayId}", overlayId);

            // Send to KasmVNC for web display synchronization
            var kasmvncConnected = await _kasmvncService.IsConnectedAsync();
            if (!kasmvncConnected)
            {
                _logger.LogInformation("KasmVNC not connected, attempting to connect...");
                kasmvncConnected = await _kasmvncService.ConnectAsync();
            }

            if (kasmvncConnected)
            {
                var overlayCommand = new OverlayCommand
                {
                    Type = "create",
                    Id = overlayId,
                    X = request.X,
                    Y = request.Y,
                    Width = request.Width,
                    Height = request.Height,
                    Color = request.Color ?? "#ff0000",
                    Opacity = request.Opacity ?? 0.5,
                    MonitorIndex = monitorIndex,
                    ClickThrough = request.ClickThrough ?? true
                };

                await _kasmvncService.SendOverlayCommandAsync(overlayCommand);
                _logger.LogDebug("Sent overlay command to KasmVNC for overlay {OverlayId}", overlayId);
            }
            else
            {
                _logger.LogWarning("Could not connect to KasmVNC - overlay created locally only");
            }

            return new CreateOverlayResponse
            {
                OverlayId = overlayId,
                Success = true,
                KasmVNCSync = kasmvncConnected,
                AvailableDisplays = displays
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error creating overlay");
            return new CreateOverlayResponse
            {
                Success = false,
                Error = ex.Message,
                AvailableDisplays = await _kasmvncService.GetDisplaysAsync()
            };
        }
    }
}