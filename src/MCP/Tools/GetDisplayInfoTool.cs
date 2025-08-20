using ModelContextProtocol.Server;
using OverlayCompanion.Services;
using System.ComponentModel;
using System.Diagnostics;
using System.Text.Json;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// Tool for retrieving display information including multi-monitor setup
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
    [Description("Get information about all connected displays including resolution, position, and scale")]
    public async Task<object> GetDisplayInfo()
    {
        try
        {
            var displays = await GetDisplaysInfoAsync();

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
                }
            };
        }
        catch (Exception ex)
        {
            return new { error = $"Failed to get display info: {ex.Message}" };
        }
    }

    private async Task<List<DisplayInfo>> GetDisplaysInfoAsync()
    {
        var displays = new List<DisplayInfo>();

        try
        {
            // Try xrandr first (most common on Linux)
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
            // Fallback to xdpyinfo
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
