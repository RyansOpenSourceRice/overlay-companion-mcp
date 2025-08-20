using OverlayCompanion.Models;
using System;
using System.Collections.Generic;

namespace OverlayCompanion.Services;

/// <summary>
/// Interface for operational mode management
/// New component for overlay-companion-mcp (not in original project)
/// </summary>
public interface IModeManager
{
    OperationalMode CurrentMode { get; }
    Task<bool> SetModeAsync(OperationalMode mode, Dictionary<string, object>? metadata = null);
    bool CanExecuteAction(string actionType);
    bool RequiresConfirmation(string actionType);
    event EventHandler<OperationalMode>? ModeChanged;
}

/// <summary>
/// Manages operational modes for the overlay companion
/// Implements human-in-the-loop safety principles
/// </summary>
public class ModeManager : IModeManager
{
    private OperationalMode _currentMode = OperationalMode.Passive;
    private Dictionary<string, object> _modeMetadata = new();

    public OperationalMode CurrentMode => _currentMode;

    public event EventHandler<OperationalMode>? ModeChanged;

    public async Task<bool> SetModeAsync(OperationalMode mode, Dictionary<string, object>? metadata = null)
    {
        var previousMode = _currentMode;
        _currentMode = mode;
        _modeMetadata = metadata ?? new Dictionary<string, object>();

        // Log mode change
        Console.WriteLine($"Mode changed from {previousMode} to {mode}");

        ModeChanged?.Invoke(this, mode);
        return await Task.FromResult(true);
    }

    public bool CanExecuteAction(string actionType)
    {
        return _currentMode switch
        {
            OperationalMode.Passive => IsViewOnlyAction(actionType),
            OperationalMode.Assist => true, // All actions allowed but may require confirmation
            OperationalMode.Autopilot => IsAutopilotAllowedAction(actionType),
            OperationalMode.Composing => IsComposingAction(actionType),
            OperationalMode.Custom => IsCustomModeAllowedAction(actionType),
            _ => false
        };
    }

    public bool RequiresConfirmation(string actionType)
    {
        return _currentMode switch
        {
            OperationalMode.Passive => false, // No actions executed
            OperationalMode.Assist => IsDestructiveAction(actionType),
            OperationalMode.Autopilot => IsHighRiskAction(actionType),
            OperationalMode.Composing => IsNonComposingAction(actionType),
            OperationalMode.Custom => IsCustomConfirmationRequired(actionType),
            _ => true // Default to requiring confirmation
        };
    }

    private static bool IsViewOnlyAction(string actionType)
    {
        var viewOnlyActions = new HashSet<string>
        {
            "take_screenshot",
            "get_clipboard",
            "subscribe_events",
            "unsubscribe_events"
        };

        return viewOnlyActions.Contains(actionType);
    }

    private static bool IsAutopilotAllowedAction(string actionType)
    {
        var restrictedActions = new HashSet<string>
        {
            "set_clipboard", // Could overwrite important data
            "type_text"      // Could input sensitive information
        };

        return !restrictedActions.Contains(actionType);
    }

    private static bool IsComposingAction(string actionType)
    {
        var composingActions = new HashSet<string>
        {
            "type_text",
            "set_clipboard",
            "get_clipboard",
            "take_screenshot",
            "draw_overlay",
            "remove_overlay"
        };

        return composingActions.Contains(actionType);
    }

    private static bool IsDestructiveAction(string actionType)
    {
        var destructiveActions = new HashSet<string>
        {
            "click_at",
            "type_text",
            "set_clipboard"
        };

        return destructiveActions.Contains(actionType);
    }

    private static bool IsHighRiskAction(string actionType)
    {
        var highRiskActions = new HashSet<string>
        {
            "type_text", // Could input passwords or sensitive data
            "click_at"   // Could click on dangerous buttons
        };

        return highRiskActions.Contains(actionType);
    }

    private static bool IsNonComposingAction(string actionType)
    {
        var nonComposingActions = new HashSet<string>
        {
            "click_at" // Clicking is not part of composing
        };

        return nonComposingActions.Contains(actionType);
    }

    private bool IsCustomModeAllowedAction(string actionType)
    {
        // Check custom mode metadata for allowed actions
        if (_modeMetadata.TryGetValue("allowed_actions", out var allowedObj) &&
            allowedObj is string[] allowedActions)
        {
            return allowedActions.Contains(actionType);
        }

        // Default to restrictive behavior
        return IsViewOnlyAction(actionType);
    }

    private bool IsCustomConfirmationRequired(string actionType)
    {
        // Check custom mode metadata for confirmation requirements
        if (_modeMetadata.TryGetValue("require_confirmation", out var confirmObj) &&
            confirmObj is string[] confirmActions)
        {
            return confirmActions.Contains(actionType);
        }

        // Default to requiring confirmation for non-view actions
        return !IsViewOnlyAction(actionType);
    }
}
