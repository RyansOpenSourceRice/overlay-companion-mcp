using ModelContextProtocol.Server;
using OverlayCompanion.Services;
using System.ComponentModel;
using System.Diagnostics;
using System.Text.Json;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// Tool for retrieving display information including multi-monitor setup
/// Wayland-first with X11 fallback
/// </summary>
[McpServerToolType]
public class GetDisplayInfoTool
{
    private readonly IScreenCaptureService _screenCaptureService;

    public GetDisplayInfoTool(IScreenCaptureService screenCaptureService)
    {
        _screenCaptureService = screenCaptureService;
    }

    [McpServerTool]
    [Description("Get information about all connected displays including resolution, position, scale, and KasmVNC integration status")]
    public async Task<object> GetDisplayInfo()
    {
        try
        {
            var displays = await GetDisplaysInfoAsync();

            // Try to get KasmVNC service if available
            var kasmvncConnected = false;
            string? sessionStatus = null;

            try
            {
                // This will be injected if KasmVNC service is registered
                var kasmvncService = ServiceProvider?.GetService(typeof(IKasmVNCService)) as IKasmVNCService;
                if (kasmvncService != null)
                {
                    kasmvncConnected = await kasmvncService.IsConnectedAsync();
                    if (!kasmvncConnected)
                    {
                        kasmvncConnected = await kasmvncService.ConnectAsync();
                    }

                    if (kasmvncConnected)
                    {
                        sessionStatus = await kasmvncService.GetSessionStatusAsync();
                    }
                }
            }
            catch (Exception ex)
            {
                // Log but don't fail the entire operation
                Console.WriteLine($"KasmVNC integration warning: {ex.Message}");
            }

            return new
            {
                displays = displays,
                primary_display = displays.FirstOrDefault(d => d.is_primary),
                total_displays = displays.Count,
                virtual_screen = new
                {
                    width = displays.Max(d => d.x + d.width),
                    height = displays.Max(d => d.y + d.height),
                    min_x = displays.Min(d => d.x),
                    min_y = displays.Min(d => d.y)
                },
                kasmvnc_integration = new
                {
                    connected = kasmvncConnected,
                    session_status = sessionStatus,
                    multi_monitor_support = kasmvncConnected,
                    overlay_support = kasmvncConnected
                }
            };
        }
        catch (Exception ex)
        {
            return new { error = $"Failed to get display info: {ex.Message}" };
        }
    }

    // Property to access service provider for KasmVNC service
    public IServiceProvider? ServiceProvider { get; set; }

    private async Task<List<DisplayInfo>> GetDisplaysInfoAsync()
    {
        var displays = new List<DisplayInfo>();

        // Wayland-first: Hyprland
        try
        {
            var hyprJson = await RunCommandAsync("hyprctl", "monitors -j");
            if (!string.IsNullOrWhiteSpace(hyprJson))
            {
                displays = ParseHyprctlOutput(hyprJson);
                if (displays.Any()) return displays;
            }
        }
        catch { }

        // Wayland: Sway (wlroots)
        try
        {
            var swayJson = await RunCommandAsync("swaymsg", "-t get_outputs -r");
            if (!string.IsNullOrWhiteSpace(swayJson))
            {
                displays = ParseSwaymsgOutput(swayJson);
                if (displays.Any()) return displays;
            }
        }
        catch { }

        try
        {
            // X11: xrandr
            var xrandrResult = await RunCommandAsync("xrandr", "--query");
            if (!string.IsNullOrEmpty(xrandrResult))
            {
                displays = ParseXrandrOutput(xrandrResult);
                if (displays.Any())
                    return displays;
            }
        }
        catch { }

        try
        {
            // X11: xdpyinfo
            var xdpyinfoResult = await RunCommandAsync("xdpyinfo", "");
            if (!string.IsNullOrEmpty(xdpyinfoResult))
            {
                displays = ParseXdpyinfoOutput(xdpyinfoResult);
                if (displays.Any())
                    return displays;
            }
        }
        catch { }

        // Final fallback - single display with current resolution
        var (width, height) = await _screenCaptureService.GetScreenResolutionAsync();
        displays.Add(new DisplayInfo
        {
            index = 0,
            name = "Display-0",
            width = width,
            height = height,
            x = 0,
            y = 0,
            is_primary = true,
            scale = 1.0,
            refresh_rate = 60.0
        });

        return displays;
    }

    private List<DisplayInfo> ParseHyprctlOutput(string json)
    {
        var displays = new List<DisplayInfo>();
        try
        {
            using var doc = JsonDocument.Parse(json);
            int idx = 0;
            foreach (var el in doc.RootElement.EnumerateArray())
            {
                var name = el.GetProperty("name").GetString() ?? $"Display-{idx}";
                var width = el.GetProperty("width").GetInt32();
                var height = el.GetProperty("height").GetInt32();
                var x = el.GetProperty("x").GetInt32();
                var y = el.GetProperty("y").GetInt32();
                var primary = el.TryGetProperty("focused", out var focused) && focused.GetBoolean();
                double scale = el.TryGetProperty("scale", out var sc) ? sc.GetDouble() : 1.0;
                double refresh = el.TryGetProperty("refreshRate", out var rr) ? rr.GetDouble() : 60.0;

                displays.Add(new DisplayInfo
                {
                    index = idx++,
                    name = name,
                    width = width,
                    height = height,
                    x = x,
                    y = y,
                    is_primary = primary,
                    scale = scale,
                    refresh_rate = refresh
                });
            }
        }
        catch { }
        return displays;
    }

    private List<DisplayInfo> ParseSwaymsgOutput(string json)
    {
        var displays = new List<DisplayInfo>();
        try
        {
            using var doc = JsonDocument.Parse(json);
            int idx = 0;
            foreach (var el in doc.RootElement.EnumerateArray())
            {
                var name = el.GetProperty("name").GetString() ?? $"Display-{idx}";
                var rect = el.GetProperty("rect");
                var x = rect.GetProperty("x").GetInt32();
                var y = rect.GetProperty("y").GetInt32();
                var width = rect.GetProperty("width").GetInt32();
                var height = rect.GetProperty("height").GetInt32();
                var primary = el.TryGetProperty("primary", out var pr) && pr.GetBoolean();
                double scale = el.TryGetProperty("scale", out var sc) ? sc.GetDouble() : 1.0;
                double refresh = el.TryGetProperty("current_mode", out var mode) && mode.ValueKind == JsonValueKind.Object && mode.TryGetProperty("refresh", out var rf)
                    ? rf.GetDouble() : 60.0;

                displays.Add(new DisplayInfo
                {
                    index = idx++,
                    name = name,
                    width = width,
                    height = height,
                    x = x,
                    y = y,
                    is_primary = primary,
                    scale = scale,
                    refresh_rate = refresh
                });
            }
        }
        catch { }
        return displays;
    }

    private List<DisplayInfo> ParseXrandrOutput(string output)
    {
        var displays = new List<DisplayInfo>();
        var lines = output.Split('\n');
        int index = 0;

        foreach (var line in lines)
        {
            if (line.Contains(" connected"))
            {
                var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                var name = parts[0];
                var isPrimary = line.Contains("primary");

                // Parse resolution and position (e.g., "1920x1080+0+0")
                var resolutionPart = parts.FirstOrDefault(p => p.Contains("x") && p.Contains("+"));
                if (resolutionPart != null)
                {
                    var resParts = resolutionPart.Split('+');
                    if (resParts.Length >= 3)
                    {
                        var dimensions = resParts[0].Split('x');
                        if (dimensions.Length == 2 &&
                            int.TryParse(dimensions[0], out int width) &&
                            int.TryParse(dimensions[1], out int height) &&
                            int.TryParse(resParts[1], out int x) &&
                            int.TryParse(resParts[2], out int y))
                        {
                            displays.Add(new DisplayInfo
                            {
                                index = index++,
                                name = name,
                                width = width,
                                height = height,
                                x = x,
                                y = y,
                                is_primary = isPrimary,
                                scale = 1.0, // TODO: Parse scale from xrandr
                                refresh_rate = 60.0 // TODO: Parse refresh rate from xrandr
                            });
                        }
                    }
                }
            }
        }

        return displays;
    }

    private List<DisplayInfo> ParseXdpyinfoOutput(string output)
    {
        var displays = new List<DisplayInfo>();

        // Basic parsing for xdpyinfo - usually shows single display info
        var lines = output.Split('\n');
        var dimensionsLine = lines.FirstOrDefault(l => l.Contains("dimensions:"));

        if (dimensionsLine != null)
        {
            // Parse "dimensions: 1920x1080 pixels"
            var parts = dimensionsLine.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            var dimPart = parts.FirstOrDefault(p => p.Contains("x"));

            if (dimPart != null)
            {
                var dimensions = dimPart.Split('x');
                if (dimensions.Length == 2 &&
                    int.TryParse(dimensions[0], out int width) &&
                    int.TryParse(dimensions[1], out int height))
                {
                    displays.Add(new DisplayInfo
                    {
                        index = 0,
                        name = "Display-0",
                        width = width,
                        height = height,
                        x = 0,
                        y = 0,
                        is_primary = true,
                        scale = 1.0,
                        refresh_rate = 60.0
                    });
                }
            }
        }

        return displays;
    }

    private async Task<string> RunCommandAsync(string command, string arguments)
    {
        try
        {
            var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = command,
                    Arguments = arguments,
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                }
            };

            process.Start();
            var output = await process.StandardOutput.ReadToEndAsync();
            await process.WaitForExitAsync();

            return process.ExitCode == 0 ? output : string.Empty;
        }
        catch
        {
            return string.Empty;
        }
    }

    private class DisplayInfo
    {
        public int index { get; set; }
        public string name { get; set; } = "";
        public int width { get; set; }
        public int height { get; set; }
        public int x { get; set; }
        public int y { get; set; }
        public bool is_primary { get; set; }
        public double scale { get; set; }
        public double refresh_rate { get; set; }
    }
}
