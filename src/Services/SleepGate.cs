using System;
using System.Threading;
using OverlayCompanion.Models;

namespace OverlayCompanion.Services;

/// <summary>
/// Power management for long-lived sessions (8h/day usage).
///
/// While the user is away the server should not keep spending CPU on screen
/// captures (which spawn capture helper processes) or 4Hz pointer polling.
/// SleepGate tracks input activity and:
///   - AUTO-SLEEPS after OC_IDLE_SLEEP_SECONDS of no detected activity
///     (default 600s; set 0 to disable auto-sleep entirely), and
///   - can be toggled instantly via the set_sleep MCP tool ("seconds" sleep).
///
/// Waking is automatic on any detected user input (mouse move) so an idle-slept
/// session feels seamless; a manually-slept session only wakes via input after
/// MANUAL_SLEEP_WAKES_ON_INPUT is not false, i.e. users who explicitly asked to
/// sleep can still nudge it awake with the same gesture. Screen captures while
/// asleep are short-circuited by ScreenCaptureService with a cached frame, and
/// the input monitor's poll cadence drops to a slow heartbeat until wake.
/// </summary>
public interface ISleepGate
{
    bool IsAsleep { get; }
    DateTimeOffset LastActivityUtc { get; }
    /// <summary>Why we are currently asleep: "manual", "idle", or null when awake.</summary>
    string? SleepReason { get; }
    event EventHandler<string>? StateChanged;
    void RecordActivity();
    void Sleep(string reason);
    void Wake(string reason);
    TimeSpan IdleFor { get; }
}

public class SleepGate : ISleepGate, IDisposable
{
    private readonly IInputMonitorService _input;
    private readonly Timer _autoSleepTimer;
    private readonly int _idleSleepSeconds;
    private readonly bool _manualWakesOnInput;
    private const int AsleepHeartbeatMs = 3000;
    // Captured from the monitor at construction so OC_INPUT_POLL_MS survives
    // sleep/wake cycles (OpenCodeReview finding: hardcoded restore lost it).
    private readonly int _awakePollMs;

    public bool IsAsleep { get; private set; }
    public string? SleepReason { get; private set; }
    public DateTimeOffset LastActivityUtc { get; private set; } = DateTimeOffset.UtcNow;
    public TimeSpan IdleFor => DateTimeOffset.UtcNow - LastActivityUtc;
    public event EventHandler<string>? StateChanged;

    // The gate subscribes to input events so that BOTH idle detection and
    // wake-on-input share one source of truth.
    public SleepGate(IInputMonitorService input)
    {
        _input = input;
        _awakePollMs = input.PollingIntervalMs;

        var envSeconds = Environment.GetEnvironmentVariable("OC_IDLE_SLEEP_SECONDS");
        _idleSleepSeconds = int.TryParse(envSeconds, out var s) && s >= 0 ? s : 600;

        var manualWake = Environment.GetEnvironmentVariable("MANUAL_SLEEP_WAKES_ON_INPUT");
        _manualWakesOnInput = !string.Equals(manualWake, "false", StringComparison.OrdinalIgnoreCase);

        _input.MouseMoved += OnInput;
        _input.MouseClicked += OnInput;
        _input.KeyPressed += OnInput;

        // Idle sweep every 10s is plenty; when disabled this timer simply
        // observes an always-fresh LastActivityUtc and does nothing.
        if (_idleSleepSeconds > 0)
        {
            _autoSleepTimer = new Timer(_ =>
            {
                try
                {
                    if (!IsAsleep && IdleFor.TotalSeconds >= _idleSleepSeconds)
                    {
                        Sleep("idle");
                    }
                }
                catch
                {
                    // Power management must never take the process down.
                }
            }, null, TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(10));
        }
        else
        {
            _autoSleepTimer = new Timer(_ => { }, null, Timeout.Infinite, Timeout.Infinite);
        }
    }

    private void OnInput(object? sender, InputEvent e)
    {
        RecordActivity();
        if (IsAsleep && (_manualWakesOnInput || SleepReason == "idle"))
        {
            Wake(SleepReason ?? "manual");
        }
    }

    public void RecordActivity()
    {
        LastActivityUtc = DateTimeOffset.UtcNow;
    }

    public void Sleep(string reason)
    {
        if (IsAsleep) return;
        IsAsleep = true;
        SleepReason = reason;
        _input.SetPollingIntervalMs(AsleepHeartbeatMs);
        Console.WriteLine($"[sleep] entered ({reason}); captures gated, input heartbeat {AsleepHeartbeatMs}ms");
        StateChanged?.Invoke(this, reason);
    }

    public void Wake(string reason)
    {
        if (!IsAsleep) return;
        IsAsleep = false;
        SleepReason = null;
        RecordActivity();
        _input.SetPollingIntervalMs(_awakePollMs);
        Console.WriteLine($"[sleep] exited ({reason})");
        StateChanged?.Invoke(this, reason);
    }

    public void Dispose()
    {
        _autoSleepTimer.Dispose();
        _input.MouseMoved -= OnInput;
        _input.MouseClicked -= OnInput;
        _input.KeyPressed -= OnInput;
    }
}
