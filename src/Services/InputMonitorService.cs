using OverlayCompanion.Models;
using System;
using System.Diagnostics;
using System.Threading;

namespace OverlayCompanion.Services;

/// <summary>
/// Interface for input monitoring functionality
/// Adapted from GraphicalJobApplicationGuidanceSystem
/// </summary>
public interface IInputMonitorService
{
    event EventHandler<InputEvent>? MouseMoved;
    event EventHandler<InputEvent>? MouseClicked;
    event EventHandler<InputEvent>? KeyPressed;

    void StartMonitoring();
    void StopMonitoring();
    bool IsMonitoring { get; }
    ScreenPoint GetCurrentMousePosition();
    Task<bool> SimulateClickAsync(ScreenPoint position, string button = "left", int clicks = 1);
    Task<bool> SimulateTypingAsync(string text, int typingSpeedWpm = 60);
}

/// <summary>
/// Linux-native input monitoring implementation
/// Extracted and adapted from GraphicalJobApplicationGuidanceSystem
/// Removed job-specific context, added mode awareness
/// </summary>
public class InputMonitorService : IInputMonitorService
{
    private bool _isMonitoring;
    private Timer? _mouseTimer;
    private ScreenPoint _lastMousePosition = new(0, 0);
    private readonly int _pollingIntervalMs;

    public event EventHandler<InputEvent>? MouseMoved;
    public event EventHandler<InputEvent>? MouseClicked;
    public event EventHandler<InputEvent>? KeyPressed;

    public bool IsMonitoring => _isMonitoring;

    public InputMonitorService(int pollingIntervalMs = 50) // 20 FPS default
    {
        _pollingIntervalMs = pollingIntervalMs;
    }

    public void StartMonitoring()
    {
        if (_isMonitoring) return;

        _isMonitoring = true;

        // Start mouse position polling
        _mouseTimer = new Timer(CheckMousePosition, null, 0, _pollingIntervalMs);
    }

    public void StopMonitoring()
    {
        _isMonitoring = false;
        _mouseTimer?.Dispose();
        _mouseTimer = null;
    }

    public ScreenPoint GetCurrentMousePosition()
    {
        return GetCursorPositionFromSystem();
    }

    private void CheckMousePosition(object? state)
    {
        if (!_isMonitoring) return;

        try
        {
            var currentPos = GetCursorPositionFromSystem();

            if (currentPos.X != _lastMousePosition.X || currentPos.Y != _lastMousePosition.Y)
            {
                _lastMousePosition = currentPos;

                var inputEvent = new InputEvent
                {
                    Position = currentPos,
                    EventType = "move"
                };

                MouseMoved?.Invoke(this, inputEvent);
            }
        }
        catch
        {
            // Ignore errors during monitoring
        }
    }

    private ScreenPoint GetCursorPositionFromSystem()
    {
        try
        {
            // Wayland-first: try wev/wtype utilities or ydotool (root)
            var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "sh",
                    Arguments = "-lc 'command -v wlrctl >/dev/null 2>&1 && wlrctl pointer location || command -v hyprctl >/dev/null 2>&1 && hyprctl -j cursorpos || command -v swaymsg >/dev/null 2>&1 && swaymsg -t get_seats'",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    CreateNoWindow = true
                }
            };

            process.Start();
            var output = process.StandardOutput.ReadToEnd();
            process.WaitForExit();

            if (process.ExitCode == 0 && !string.IsNullOrWhiteSpace(output))
            {
                // Try to parse "x y" or JSON {"x":..,"y":..}
                output = output.Trim();
                if (output.StartsWith("{"))
                {
                    try
                    {
                        var doc = System.Text.Json.JsonDocument.Parse(output);
                        if (doc.RootElement.TryGetProperty("x", out var xEl) && doc.RootElement.TryGetProperty("y", out var yEl))
                        {
                            return new ScreenPoint(xEl.GetInt32(), yEl.GetInt32());
                        }
                    }
                    catch { }
                }
                else
                {
                    var parts = output.Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
                    if (parts.Length >= 2 && int.TryParse(parts[0], out var x) && int.TryParse(parts[1], out var y))
                    {
                        return new ScreenPoint(x, y);
                    }
                }
            }
        }
        catch { }

        try
        {
            // Fallback to X11 xdotool
            var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "xdotool",
                    Arguments = "getmouselocation --shell",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    CreateNoWindow = true
                }
            };

            process.Start();
            var output = process.StandardOutput.ReadToEnd();
            process.WaitForExit();

            if (process.ExitCode == 0)
            {
                var lines = output.Split('\n');
                int x = 0, y = 0;

                foreach (var line in lines)
                {
                    if (line.StartsWith("X=") && int.TryParse(line.Substring(2), out x)) continue;
                    if (line.StartsWith("Y=") && int.TryParse(line.Substring(2), out y)) continue;
                }

                return new ScreenPoint(x, y);
            }
        }
        catch
        {
            // Fallback for when xdotool is not available
        }

        // Return last known position or origin
        return _lastMousePosition;
    }

    /// <summary>
    /// Simulate a mouse click at the specified position
    /// Added for MCP tool support
    /// </summary>
    public async Task<bool> SimulateClickAsync(ScreenPoint position, string button = "left", int clicks = 1)
    {
        try
        {
            var buttonArg = button.ToLower() switch
            {
                "right" => "3",
                "middle" => "2",
                _ => "1" // left
            };

            var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "xdotool",
                    Arguments = $"mousemove {position.X} {position.Y} click --repeat {clicks} {buttonArg}",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                }
            };

            process.Start();
            await process.WaitForExitAsync();

            if (process.ExitCode == 0)
            {
                // Fire click event
                var inputEvent = new InputEvent
                {
                    Position = position,
                    EventType = "click",
                    Data = $"{button}:{clicks}"
                };

                MouseClicked?.Invoke(this, inputEvent);
                return true;
            }
        }
        catch
        {
            // Click failed
        }

        return false;
    }

    /// <summary>
    /// Simulate typing text
    /// Added for MCP tool support
    /// </summary>
    public async Task<bool> SimulateTypingAsync(string text, int typingSpeedWpm = 60)
    {
        try
        {
            // Calculate delay between characters based on WPM
            // Average word length is 5 characters, so WPM * 5 = characters per minute
            var charactersPerMinute = typingSpeedWpm * 5;
            var delayMs = 60000 / charactersPerMinute; // milliseconds per character

            var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "xdotool",
                    Arguments = $"type --delay {delayMs} \"{text.Replace("\"", "\\\"")}\"",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                }
            };

            process.Start();
            await process.WaitForExitAsync();

            if (process.ExitCode == 0)
            {
                // Fire key event
                var inputEvent = new InputEvent
                {
                    Position = GetCurrentMousePosition(),
                    EventType = "key",
                    Data = text
                };

                KeyPressed?.Invoke(this, inputEvent);
                return true;
            }
        }
        catch
        {
            // Typing failed
        }

        return false;
    }
}
