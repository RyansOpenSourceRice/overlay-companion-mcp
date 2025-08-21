using OverlayCompanion.Models;
using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using System.Text.Json;

namespace OverlayCompanion.Services;

/// <summary>
/// Interface for screen capture functionality
/// Adapted from GraphicalJobApplicationGuidanceSystem
/// </summary>
public interface IScreenCaptureService
{
    Task<Screenshot> CaptureScreenAsync(ScreenRegion? region = null, bool fullScreen = true);
    Task<Screenshot> CaptureMonitorAsync(int monitorIndex);
    Task<(int width, int height)> GetScreenResolutionAsync();
    Task<List<MonitorInfo>> GetMonitorsAsync();
    Task<MonitorInfo?> GetMonitorInfoAsync(int monitorIndex);
    event EventHandler<Screenshot>? ScreenCaptured;
}

/// <summary>
/// Linux-native screen capture implementation using external tools
/// Extracted and adapted from GraphicalJobApplicationGuidanceSystem
/// Removed job-specific context, added MCP-compatible features
/// </summary>
public class ScreenCaptureService : IScreenCaptureService
{
    public event EventHandler<Screenshot>? ScreenCaptured;

    public async Task<Screenshot> CaptureScreenAsync(ScreenRegion? region = null, bool fullScreen = true)
    {
        try
        {
            var imageData = await CaptureUsingLinuxTools(region, fullScreen);
            var (width, height) = await GetScreenResolutionAsync();

            var screenshot = new Screenshot
            {
                ImageData = imageData,
                Width = region?.Width ?? width,
                Height = region?.Height ?? height,
                MonitorIndex = await DetectMonitorIndexAsync(region),
                DisplayScale = await GetDisplayScaleAsync(),
                CaptureRegion = region
            };

            // Fire event
            ScreenCaptured?.Invoke(this, screenshot);

            return screenshot;
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Failed to capture screen: {ex.Message}", ex);
        }
    }

    public async Task<Screenshot> CaptureMonitorAsync(int monitorIndex)
    {
        var monitor = await GetMonitorInfoAsync(monitorIndex);
        if (monitor == null)
        {
            throw new ArgumentException($"Monitor {monitorIndex} not found");
        }

        // Create region for specific monitor
        var region = new ScreenRegion(monitor.X, monitor.Y, monitor.Width, monitor.Height);

        var screenshot = await CaptureScreenAsync(region, fullScreen: false);
        screenshot.MonitorIndex = monitorIndex;
        return screenshot;
    }

    private async Task<byte[]> CaptureUsingLinuxTools(ScreenRegion? region = null, bool fullScreen = true)
    {
        var tempFile = Path.GetTempFileName() + ".png";

        try
        {
            // Build capture command based on region
            var tools = fullScreen || region == null
                ? GetFullScreenTools(tempFile)
                : GetRegionTools(tempFile, region);

            foreach (var (tool, args) in tools)
            {
                try
                {
                    var process = new Process
                    {
                        StartInfo = new ProcessStartInfo
                        {
                            FileName = tool,
                            Arguments = args,
                            UseShellExecute = false,
                            RedirectStandardOutput = true,
                            RedirectStandardError = true,
                            CreateNoWindow = true
                        }
                    };

                    process.Start();
                    await process.WaitForExitAsync();

                    if (process.ExitCode == 0 && File.Exists(tempFile))
                    {
                        var bytes = await File.ReadAllBytesAsync(tempFile);
                        return bytes;
                    }
                }
                catch
                {
                    // Try next tool
                    continue;
                }
            }

            throw new InvalidOperationException("No suitable screen capture tool found. Please install grim, gnome-screenshot, spectacle, scrot, or ImageMagick.");
        }
        finally
        {
            // Cleanup temp file
            if (File.Exists(tempFile))
            {
                try { File.Delete(tempFile); } catch { }
            }
        }
    }

    private static (string tool, string args)[] GetFullScreenTools(string outputFile)
    {
        return new[]
        {
            ("grim", $"{outputFile}"), // Wayland-native (wlroots)
            ("gnome-screenshot", $"-f {outputFile}"),
            ("spectacle", $"-b -n -o {outputFile}"), // KDE
            ("maim", outputFile), // X11 alternative
            ("scrot", outputFile),
            ("import", $"-window root {outputFile}") // ImageMagick (X11)
        };
    }

    private static (string tool, string args)[] GetRegionTools(string outputFile, ScreenRegion region)
    {
        var geom = $"{region.X},{region.Y} {region.Width}x{region.Height}";
        return new[]
        {
            ("grim", $"-g \"{geom}\" {outputFile}"), // Non-interactive on Wayland
            ("gnome-screenshot", $"-a -f {outputFile}"), // Interactive region selection (Wayland-supported)
            ("spectacle", $"-r -b -n -o {outputFile}"), // KDE region (Wayland-supported)
            ("maim", $"-g {region.Width}x{region.Height}+{region.X}+{region.Y} {outputFile}"), // X11
            ("scrot", $"-a {region.X},{region.Y},{region.Width},{region.Height} {outputFile}"), // X11
            ("import", $"-window root -crop {region.Width}x{region.Height}+{region.X}+{region.Y} {outputFile}") // ImageMagick (X11)
        };
    }

    public async Task<(int width, int height)> GetScreenResolutionAsync()
    {
        // Try Wayland compositors first
        try
        {
            var swayJson = await RunCommandAsync("swaymsg", "-t get_outputs -r");
            if (!string.IsNullOrWhiteSpace(swayJson))
            {
                using var doc = JsonDocument.Parse(swayJson);
                var first = doc.RootElement.EnumerateArray().FirstOrDefault();
                if (first.ValueKind != JsonValueKind.Undefined && first.TryGetProperty("current_mode", out var mode) && mode.ValueKind == JsonValueKind.Object)
                {
                    if (mode.TryGetProperty("width", out var w) && mode.TryGetProperty("height", out var h))
                    {
                        return (w.GetInt32(), h.GetInt32());
                    }
                }
                if (first.TryGetProperty("rect", out var rect))
                {
                    return (rect.GetProperty("width").GetInt32(), rect.GetProperty("height").GetInt32());
                }
            }
        }
        catch { }

        try
        {
            var hyprJson = await RunCommandAsync("hyprctl", "monitors -j");
            if (!string.IsNullOrWhiteSpace(hyprJson))
            {
                using var doc = JsonDocument.Parse(hyprJson);
                var first = doc.RootElement.EnumerateArray().FirstOrDefault();
                if (first.ValueKind != JsonValueKind.Undefined)
                {
                    var width = first.GetProperty("width").GetInt32();
                    var height = first.GetProperty("height").GetInt32();
                    return (width, height);
                }
            }
        }
        catch { }

        try
        {
            // Try to get screen resolution using xrandr (X11)
            var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "xrandr",
                    Arguments = "--current",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    CreateNoWindow = true
                }
            };

            process.Start();
            var output = await process.StandardOutput.ReadToEndAsync();
            await process.WaitForExitAsync();

            if (process.ExitCode == 0)
            {
                // Parse xrandr output to find current resolution
                var lines = output.Split('\n');
                foreach (var line in lines)
                {
                    if (line.Contains("*") && line.Contains("x"))
                    {
                        var parts = line.Trim().Split(' ')[0].Split('x');
                        if (parts.Length == 2 &&
                            int.TryParse(parts[0], out var width) &&
                            int.TryParse(parts[1], out var height))
                        {
                            return (width, height);
                        }
                    }
                }
            }
        }
        catch
        {
            // Fall through to default
        }

        // Fallback to common resolution
        return (1920, 1080);
    }

    private async Task<double> GetDisplayScaleAsync()
    {
        try
        {
            // Try to detect HiDPI scaling
            var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "gsettings",
                    Arguments = "get org.gnome.desktop.interface scaling-factor",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    CreateNoWindow = true
                }
            };

            process.Start();
            var output = await process.StandardOutput.ReadToEndAsync();
            await process.WaitForExitAsync();

            if (process.ExitCode == 0 && double.TryParse(output.Trim(), out var scale))
            {
                return scale;
            }
        }
        catch
        {
            // Ignore errors
        }

        return 1.0; // Default scale
    }

    public async Task<List<MonitorInfo>> GetMonitorsAsync()
    {
        var monitors = new List<MonitorInfo>();

        // Wayland-first: try compositor-specific queries
        try
        {
            var swayJson = await RunCommandAsync("swaymsg", "-t get_outputs -r");
            if (!string.IsNullOrWhiteSpace(swayJson))
            {
                monitors = ParseSwaymsgMonitors(swayJson);
                if (monitors.Any()) return monitors;
            }
        }
        catch { }

        try
        {
            var hyprJson = await RunCommandAsync("hyprctl", "monitors -j");
            if (!string.IsNullOrWhiteSpace(hyprJson))
            {
                monitors = ParseHyprctlMonitors(hyprJson);
                if (monitors.Any()) return monitors;
            }
        }
        catch { }

        try
        {
            // Try xrandr first (most common on Linux/X11)
            var xrandrResult = await RunCommandAsync("xrandr", "--query");
            if (!string.IsNullOrEmpty(xrandrResult))
            {
                monitors = ParseXrandrMonitors(xrandrResult);
                if (monitors.Any())
                    return monitors;
            }
        }
        catch { }

        try
        {
            // Fallback to xdpyinfo (X11)
            var xdpyinfoResult = await RunCommandAsync("xdpyinfo", "");
            if (!string.IsNullOrEmpty(xdpyinfoResult))
            {
                monitors = ParseXdpyinfoMonitors(xdpyinfoResult);
                if (monitors.Any())
                    return monitors;
            }
        }
        catch { }

        // Final fallback - single monitor with current resolution
        var (width, height) = await GetScreenResolutionAsync();
        monitors.Add(new MonitorInfo
        {
            Index = 0,
            Name = "Monitor-0",
            Width = width,
            Height = height,
            X = 0,
            Y = 0,
            IsPrimary = true
        });

        return monitors;
    }

    public async Task<MonitorInfo?> GetMonitorInfoAsync(int monitorIndex)
    {
        var monitors = await GetMonitorsAsync();
        return monitors.FirstOrDefault(m => m.Index == monitorIndex);
    }

    private async Task<int> DetectMonitorIndexAsync(ScreenRegion? region)
    {
        if (region == null)
            return 0; // Default to primary monitor

        var monitors = await GetMonitorsAsync();

        // Find which monitor contains the center of the region
        var centerX = region.X + region.Width / 2;
        var centerY = region.Y + region.Height / 2;

        foreach (var monitor in monitors)
        {
            if (centerX >= monitor.X && centerX < monitor.X + monitor.Width &&
                centerY >= monitor.Y && centerY < monitor.Y + monitor.Height)
            {
                return monitor.Index;
            }
        }

        return 0; // Default to primary monitor if not found
    }

    private List<MonitorInfo> ParseXrandrMonitors(string output)
    {
        var monitors = new List<MonitorInfo>();
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
                            monitors.Add(new MonitorInfo
                            {
                                Index = index++,
                                Name = name,
                                Width = width,
                                Height = height,
                                X = x,
                                Y = y,
                                IsPrimary = isPrimary
                            });
                        }
                    }
                }
            }
        }

        return monitors;
    }

    private List<MonitorInfo> ParseXdpyinfoMonitors(string output)
    {
        var monitors = new List<MonitorInfo>();

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
                    monitors.Add(new MonitorInfo
                    {
                        Index = 0,
                        Name = "Monitor-0",
                        Width = width,
                        Height = height,
                        X = 0,
                        Y = 0,
                        IsPrimary = true
                    });
                }
            }
        }

        return monitors;
    }

    private List<MonitorInfo> ParseSwaymsgMonitors(string json)
    {
        var monitors = new List<MonitorInfo>();
        try
        {
            using var doc = JsonDocument.Parse(json);
            int idx = 0;
            foreach (var el in doc.RootElement.EnumerateArray())
            {
                if (el.TryGetProperty("rect", out var rect))
                {
                    monitors.Add(new MonitorInfo
                    {
                        Index = idx++,
                        Name = el.GetProperty("name").GetString() ?? $"Display-{idx}",
                        Width = rect.GetProperty("width").GetInt32(),
                        Height = rect.GetProperty("height").GetInt32(),
                        X = rect.GetProperty("x").GetInt32(),
                        Y = rect.GetProperty("y").GetInt32(),
                        IsPrimary = el.TryGetProperty("primary", out var primary) && primary.GetBoolean()
                    });
                }
            }
        }
        catch { }
        return monitors;
    }

    private List<MonitorInfo> ParseHyprctlMonitors(string json)
    {
        var monitors = new List<MonitorInfo>();
        try
        {
            using var doc = JsonDocument.Parse(json);
            int idx = 0;
            foreach (var el in doc.RootElement.EnumerateArray())
            {
                monitors.Add(new MonitorInfo
                {
                    Index = idx++,
                    Name = el.GetProperty("name").GetString() ?? $"Display-{idx}",
                    Width = el.GetProperty("width").GetInt32(),
                    Height = el.GetProperty("height").GetInt32(),
                    X = el.GetProperty("x").GetInt32(),
                    Y = el.GetProperty("y").GetInt32(),
                    IsPrimary = el.TryGetProperty("focused", out var focused) && focused.GetBoolean()
                });
            }
        }
        catch { }
        return monitors;
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
}
