using Microsoft.Extensions.Logging;
using ModelContextProtocol.Server;
using OverlayCompanion.Services;
using System.ComponentModel;
using System.Threading.Tasks;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// MCP tool for session stop functionality
/// Provides AI clients with information about session stop events
/// </summary>
[McpServerToolType]
public static class SessionStopTool
{
    [McpServerTool, Description("Check if the session has been stopped by the user. Returns session status and any stop reason.")]
    public static async Task<object> CheckSessionStatus(
        ISessionStopService sessionStopService,
        ILogger<Program> logger)
    {
        logger.LogDebug("Checking session stop status");

        var result = new
        {
            session_stopped = sessionStopService.IsSessionStopped,
            timestamp = System.DateTime.UtcNow,
            message = sessionStopService.IsSessionStopped 
                ? "Session has been stopped by user. All AI operations are halted. Please wait for user to resume session."
                : "Session is active and AI operations are permitted.",
            status = sessionStopService.IsSessionStopped ? "stopped" : "active"
        };

        if (sessionStopService.IsSessionStopped)
        {
            logger.LogInformation("AI client checked session status - session is stopped");
        }

        return result;
    }
}