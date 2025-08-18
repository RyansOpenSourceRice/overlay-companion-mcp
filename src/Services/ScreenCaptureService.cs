using OverlayCompanion.Models;
using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;

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
                MonitorIndex = 0, // TODO: Implement multi-monitor detection
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
        // For now, treat as full screen capture
        // TODO: Implement proper multi-monitor support
        return await CaptureScreenAsync(fullScreen: true);
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

            throw new InvalidOperationException("No suitable screen capture tool found. Please install gnome-screenshot, scrot, or ImageMagick.");
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
            ("gnome-screenshot", $"-f {outputFile}"),
            ("scrot", outputFile),
            ("import", $"-window root {outputFile}"), // ImageMagick
            ("maim", outputFile), // Modern alternative to scrot
            ("spectacle", $"-b -n -o {outputFile}") // KDE
        };
    }

    private static (string tool, string args)[] GetRegionTools(string outputFile, ScreenRegion region)
    {
        return new[]
        {
            ("gnome-screenshot", $"-a -f {outputFile}"), // Area selection
            ("scrot", $"-s {outputFile}"), // Select area
            ("import", $"{outputFile}"), // ImageMagick interactive
            ("maim", $"-s {outputFile}"), // Select area
            ("spectacle", $"-r -b -n -o {outputFile}") // KDE region
        };
    }

    public async Task<(int width, int height)> GetScreenResolutionAsync()
    {
        try
        {
            // Try to get screen resolution using xrandr
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
}