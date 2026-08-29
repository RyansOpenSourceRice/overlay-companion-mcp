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
    /// <summary>
    /// Adjust the position-poll cadence at runtime. Each tick spawns a helper
    /// process (wlrctl/hyprctl), so idle periods should poll slowly: power
    /// management (SleepGate) slows this down while the user is away.
    /// </summary>
    void SetPollingIntervalMs(int intervalMs);
    /// <summary>Current cadence so SleepGate can restore the exact pre-sleep value (honors OC_INPUT_POLL_MS).</summary>
    int PollingIntervalMs { get; }
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
    // Mutable: SleepGate lowers this to a heartbeat while asleep and restores
    // it on wake (SetPollingIntervalMs).
    private int _pollingIntervalMs;

    public event EventHandler<InputEvent>? MouseMoved;
    public event EventHandler<InputEvent>? MouseClicked;
    public event EventHandler<InputEvent>? KeyPressed;

    public bool IsMonitoring => _isMonitoring;
    public int PollingIntervalMs => _pollingIntervalMs;

    public InputMonitorService(int pollingIntervalMs = 250)
    {
        // Each tick spawns a helper process (see GetCursorPositionFromSystem),
        // so the default cadence is deliberately modest: 250ms gives responsive
        // activity detection without burning 20 process spawns per second for
        // hours. Override with OC_INPUT_POLL_MS.
        if (int.TryParse(Environment.GetEnvironmentVariable("OC_INPUT_POLL_MS"), out var ms) && ms >= 50)
        {
            pollingIntervalMs = ms;
        }
        _pollingIntervalMs = pollingIntervalMs;
    }

    private readonly object _timerLock = new();

    /// <inheritdoc />
    public void SetPollingIntervalMs(int intervalMs)
    {
        if (intervalMs < 50 || intervalMs == _pollingIntervalMs) return;
        lock (_timerLock)
        {
            if (!(_isMonitoring && _mouseTimer != null)) return;
            // Recreate the timer so the new cadence takes effect immediately
            // while keeping monitoring state.
            _mouseTimer.Dispose();
            _mouseTimer = new Timer(CheckMousePosition, null, 0, intervalMs);
        }
        _pollingIntervalMs = intervalMs;
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
            // NOTE: with UseShellExecute=false, .NET does NO shell parsing — the
            // Arguments string reaches sh verbatim. The old inline-quoted form
            // ("-lc 'command -v …'") delivered literal quotes as the script,
            // producing ~0.4 shell-syntax errors/second in the container logs.
            // ArgumentList passes the script as ONE real argument, no quoting.
            var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "/bin/sh",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                }
            };
            process.StartInfo.ArgumentList.Add("-lc");
            process.StartInfo.ArgumentList.Add(
                "command -v wlrctl >/dev/null 2>&1 && wlrctl pointer location || " +
                "command -v hyprctl >/dev/null 2>&1 && hyprctl -j cursorpos || " +
                "command -v swaymsg >/dev/null 2>&1 && swaymsg -t get_seats");

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
            var buttonNum = button.ToLower() switch
            {
                "right" => "3",
                "middle" => "2",
                _ => "1" // left
            };

            // Wayland-first: try ydotool (may require uinput permissions)
            try
            {
                var whichYdt = new Process
                {
                    StartInfo = new ProcessStartInfo
                    {
                        FileName = "/bin/sh",
                        UseShellExecute = false,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                        CreateNoWindow = true
                    }
                };
                whichYdt.StartInfo.ArgumentList.Add("-lc");
                whichYdt.StartInfo.ArgumentList.Add("command -v ydotool");
                whichYdt.Start();
                whichYdt.WaitForExit();
                if (whichYdt.ExitCode == 0)
                {
                    var move = new Process
                    {
                        StartInfo = new ProcessStartInfo
                        {
                            FileName = "ydotool",
                            Arguments = $"mousemove {position.X} {position.Y}",
                            UseShellExecute = false,
                            RedirectStandardError = true,
                            CreateNoWindow = true
                        }
                    };
                    move.Start();
                    await move.WaitForExitAsync();
                    if (move.ExitCode == 0)
                    {
                        bool ok = true;
                        for (int i = 0; i < clicks; i++)
                        {
                            var clickProc = new Process
                            {
                                StartInfo = new ProcessStartInfo
                                {
                                    FileName = "ydotool",
                                    Arguments = $"click {buttonNum}",
                                    UseShellExecute = false,
                                    RedirectStandardError = true,
                                    CreateNoWindow = true
                                }
                            };
                            clickProc.Start();
                            await clickProc.WaitForExitAsync();
                            if (clickProc.ExitCode != 0) { ok = false; break; }
                        }
                        if (ok)
                        {
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
                }
            }
            catch
            {
                // fall through to X11 fallback
            }

            // Fallback: xdotool (X11)
            var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "xdotool",
                    Arguments = $"mousemove {position.X} {position.Y} click --repeat {clicks} {buttonNum}",
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
        // Calculate delay between characters based on WPM
        // Average word length is 5 characters, so WPM * 5 = characters per minute
        var charactersPerMinute = Math.Max(typingSpeedWpm * 5, 1);
        var delayMs = 60000 / charactersPerMinute; // milliseconds per character
        var escaped = text.Replace("\"", "\\\"");

        // Wayland-first: try wtype
        try
        {
            var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "wtype",
                    Arguments = $"-d {delayMs} -- \"{escaped}\"",
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
            // fall through to X11 fallback
        }

        // Fallback: xdotool (X11)
        try
        {
            var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "xdotool",
                    Arguments = $"type --delay {delayMs} \"{escaped}\"",
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
