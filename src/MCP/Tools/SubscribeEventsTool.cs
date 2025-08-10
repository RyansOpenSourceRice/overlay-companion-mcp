using OverlayCompanion.Services;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// MCP tool for subscribing to UI events
/// Implements the subscribe_events tool from MCP_SPECIFICATION.md
/// </summary>
public class SubscribeEventsTool : IMcpTool
{
    private readonly IInputMonitorService _inputService;
    private readonly IModeManager _modeManager;
    private static readonly Dictionary<string, string> _subscriptions = new();

    public string Name => "subscribe_events";
    public string Description => "Subscribe to UI events like mouse movements and clicks";

    public SubscribeEventsTool(IInputMonitorService inputService, IModeManager modeManager)
    {
        _inputService = inputService;
        _modeManager = modeManager;
    }

    public async Task<object> ExecuteAsync(Dictionary<string, object> parameters)
    {
        // Check if action is allowed in current mode
        if (!_modeManager.CanExecuteAction(Name))
        {
            throw new InvalidOperationException($"Action '{Name}' not allowed in {_modeManager.CurrentMode} mode");
        }

        // Parse required parameters
        var eventsData = parameters.GetValue<object[]>("events");
        
        if (eventsData == null || eventsData.Length == 0)
        {
            throw new ArgumentException("events parameter is required and must not be empty");
        }

        // Parse optional parameters
        var debounceMs = parameters.GetValue("debounce_ms", 50);
        var filter = parameters.GetValue<Dictionary<string, object>?>("filter", null);

        // Convert events to string array
        var events = new List<string>();
        foreach (var eventData in eventsData)
        {
            if (eventData is string eventName)
            {
                events.Add(eventName);
            }
        }

        if (events.Count == 0)
        {
            throw new ArgumentException("No valid event names found in events parameter");
        }

        // Generate subscription ID
        var subscriptionId = Guid.NewGuid().ToString();
        
        // Store subscription (simplified implementation)
        _subscriptions[subscriptionId] = string.Join(",", events);

        // Start monitoring if not already started
        if (!_inputService.IsMonitoring)
        {
            _inputService.StartMonitoring();
        }

        // TODO: Implement proper event filtering and debouncing
        // For now, just subscribe to basic events
        var subscribedEvents = new List<string>();

        foreach (var eventName in events)
        {
            switch (eventName.ToLower())
            {
                case "mouse_move":
                case "mousemove":
                    subscribedEvents.Add("mouse_move");
                    break;
                case "mouse_click":
                case "click":
                    subscribedEvents.Add("mouse_click");
                    break;
                case "key_press":
                case "keypress":
                    subscribedEvents.Add("key_press");
                    break;
                default:
                    Console.WriteLine($"Warning: Event type '{eventName}' not supported");
                    break;
            }
        }

        Console.WriteLine($"Subscribed to events: {string.Join(", ", subscribedEvents)} with debounce {debounceMs}ms");

        // Return MCP-compliant response
        return new
        {
            subscription_id = subscriptionId,
            subscribed = subscribedEvents.ToArray()
        };
    }
}