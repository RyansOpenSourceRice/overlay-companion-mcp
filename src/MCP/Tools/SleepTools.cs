using OverlayCompanion.Services;
using System.ComponentModel;
using System.Text.Json;
using ModelContextProtocol.Server;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// Power management tools: instant sleep/wake plus status. Unlike state-changing
/// overlay/input tools, these are deliberately NOT gated by ModeManager — the
/// user asked for a sleep option reachable in seconds even in Passive mode,
/// because sleeping is strictly resource-saving and non-destructive. Wake also
/// happens automatically on any detected user input, so sleep can never leave
/// an agent stuck.
/// </summary>
[McpServerToolType]
public static class SleepTools
{
    [McpServerTool, Description(
        "Put the server to sleep instantly (power saving) or wake it. " +
        "While asleep screen captures are served from cache and input polling slows to a heartbeat; " +
        "any detected mouse movement wakes it automatically.")]
    public static async Task<string> SetSleep(
        ISleepGate sleepGate,
        [Description("true = sleep now (e.g. before locking up for the day); false = wake immediately")] bool enabled)
    {
        if (enabled)
        {
            sleepGate.Sleep("manual");
        }
        else
        {
            sleepGate.Wake("manual");
        }
        return await Task.FromResult(JsonSerializer.Serialize(new
        {
            success = true,
            asleep = sleepGate.IsAsleep,
            reason = sleepGate.SleepReason,
            idle_seconds = Math.Round(sleepGate.IdleFor.TotalSeconds, 1),
            last_activity_utc = sleepGate.LastActivityUtc.ToString("o"),
        }));
    }

    [McpServerTool, Description("Report current power state: asleep/idle seconds/auto-sleep threshold.")]
    public static async Task<string> GetSleepStatus(ISleepGate sleepGate)
    {
        var threshold = Environment.GetEnvironmentVariable("OC_IDLE_SLEEP_SECONDS");
        return await Task.FromResult(JsonSerializer.Serialize(new
        {
            asleep = sleepGate.IsAsleep,
            reason = sleepGate.SleepReason,
            idle_seconds = Math.Round(sleepGate.IdleFor.TotalSeconds, 1),
            auto_sleep_after_seconds = string.IsNullOrEmpty(threshold) ? 600 : int.Parse(threshold),
            last_activity_utc = sleepGate.LastActivityUtc.ToString("o"),
        }));
    }
}
