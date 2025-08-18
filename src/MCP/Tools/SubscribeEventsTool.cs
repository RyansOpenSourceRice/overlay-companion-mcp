using OverlayCompanion.Services;
using System.ComponentModel;
using System.Text.Json;
using ModelContextProtocol.Server;
using System.Diagnostics.CodeAnalysis;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// MCP tool for subscribing to UI events
/// Implements the subscribe_events tool from MCP_SPECIFICATION.md
/// </summary>
[McpServerToolType]
public static class SubscribeEventsTool
{
    private static readonly Dictionary<string, string> _subscriptions = new();

    [McpServerTool, Description("Subscribe to UI events like mouse movements and clicks")]
    [RequiresUnreferencedCode("JSON serialization may require types that cannot be statically analyzed")]
    public static async Task<string> SubscribeEvents(
        IInputMonitorService inputService,
        IModeManager modeManager,
        [Description("JSON array of event types to subscribe to (mouse_move, mouse_click, key_press, window_focus)")] string events)
    {
        // Check if action is allowed in current mode
        if (!modeManager.CanExecuteAction("subscribe_events"))
        {
            throw new InvalidOperationException($"Action 'subscribe_events' not allowed in {modeManager.CurrentMode} mode");
        }

        if (string.IsNullOrEmpty(events))
        {
            throw new ArgumentException("events parameter is required and must not be empty");
        }

        // Parse JSON array of event types
        JsonElement eventsArray;
        try
        {
            eventsArray = JsonSerializer.Deserialize<JsonElement>(events);
        }
        catch (JsonException ex)
        {
            throw new ArgumentException($"Invalid JSON in events parameter: {ex.Message}");
        }

        if (eventsArray.ValueKind != JsonValueKind.Array)
        {
            throw new ArgumentException("events parameter must be a JSON array");
        }

        // Convert events to string array
        var eventsList = new List<string>();
        foreach (var eventData in eventsArray.EnumerateArray())
        {
            if (eventData.ValueKind == JsonValueKind.String)
            {
                var eventName = eventData.GetString();
                if (!string.IsNullOrEmpty(eventName))
                {
                    eventsList.Add(eventName);
                }
            }
        }

        if (eventsList.Count == 0)
        {
            throw new ArgumentException("No valid event names found in events parameter");
        }

        // Generate subscription ID
        var subscriptionId = Guid.NewGuid().ToString();

        // Store subscription (simplified implementation)
        _subscriptions[subscriptionId] = string.Join(",", eventsList);

        // Start monitoring if not already started
        if (!inputService.IsMonitoring)
        {
            inputService.StartMonitoring();
        }

        // Process and validate event types
        var subscribedEvents = new List<string>();
        var validEvents = new[] { "mouse_move", "mouse_click", "key_press", "window_focus" };

        foreach (var eventName in eventsList)
        {
            var normalizedEvent = eventName.ToLower() switch
            {
                "mouse_move" or "mousemove" => "mouse_move",
                "mouse_click" or "click" => "mouse_click",
                "key_press" or "keypress" => "key_press",
                "window_focus" or "focus" => "window_focus",
                _ => null
            };

            if (normalizedEvent != null && validEvents.Contains(normalizedEvent))
            {
                subscribedEvents.Add(normalizedEvent);
            }
            else
            {
                Console.WriteLine($"Warning: Event type '{eventName}' not supported");
            }
        }

        Console.WriteLine($"Subscribed to events: {string.Join(", ", subscribedEvents)}");

        // Return JSON string response
        var response = new
        {
            subscription_id = subscriptionId,
            subscribed = subscribedEvents.ToArray(),
            monitoring_active = inputService.IsMonitoring,
            total_subscriptions = _subscriptions.Count
        };

        return JsonSerializer.Serialize(response);
    }
}