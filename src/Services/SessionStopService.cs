using Microsoft.Extensions.Logging;
using OverlayCompanion.Models;
using System;
using System.Threading.Tasks;

namespace OverlayCompanion.Services;

/// <summary>
/// Interface for session stop functionality
/// Provides emergency stop capabilities for AI interactions
/// </summary>
public interface ISessionStopService
{
    Task StopSessionAsync();
    event EventHandler<SessionStopEventArgs> SessionStopped;
    bool IsSessionStopped { get; }
    Task ResumeSessionAsync();
}

/// <summary>
/// Session stop service implementation
/// Provides critical safety feature to immediately halt all AI operations
/// </summary>
public class SessionStopService : ISessionStopService
{
    private readonly IOverlayService _overlayService;
    private readonly IInputMonitorService _inputMonitorService;
    private readonly ILogger<SessionStopService> _logger;
    private bool _isSessionStopped = false;

    public event EventHandler<SessionStopEventArgs>? SessionStopped;
    public bool IsSessionStopped => _isSessionStopped;

    public SessionStopService(
        IOverlayService overlayService,
        IInputMonitorService inputMonitorService,
        ILogger<SessionStopService> logger)
    {
        _overlayService = overlayService;
        _inputMonitorService = inputMonitorService;
        _logger = logger;
    }

    public async Task StopSessionAsync()
    {
        if (_isSessionStopped)
        {
            _logger.LogInformation("Session stop requested but session is already stopped");
            return;
        }

        _logger.LogWarning("Session stop activated - clearing all AI operations");
        _isSessionStopped = true;

        try
        {
            // Clear all active overlays
            await _overlayService.ClearAllOverlaysAsync();
            _logger.LogInformation("All overlays cleared");

            // Stop input monitoring
            _inputMonitorService.StopMonitoring();
            _logger.LogInformation("Input monitoring stopped");

            // Notify subscribers
            var eventArgs = new SessionStopEventArgs
            {
                Timestamp = DateTime.UtcNow,
                Reason = "User activated session stop",
                ActionsCleared = await _overlayService.GetActiveOverlaysAsync()
            };

            SessionStopped?.Invoke(this, eventArgs);
            _logger.LogWarning("Session stopped successfully - all AI operations halted");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error during session stop");
            throw;
        }
    }

    public async Task ResumeSessionAsync()
    {
        if (!_isSessionStopped)
        {
            _logger.LogInformation("Session resume requested but session is not stopped");
            return;
        }

        _logger.LogInformation("Resuming session - AI operations enabled");
        _isSessionStopped = false;

        try
        {
            // Resume input monitoring if needed
            _inputMonitorService.StartMonitoring();
            _logger.LogInformation("Session resumed successfully");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error during session resume");
            throw;
        }
    }
}

/// <summary>
/// Event arguments for session stop events
/// </summary>
public class SessionStopEventArgs : EventArgs
{
    public DateTime Timestamp { get; set; }
    public string Reason { get; set; } = string.Empty;
    public OverlayElement[] ActionsCleared { get; set; } = Array.Empty<OverlayElement>();
}