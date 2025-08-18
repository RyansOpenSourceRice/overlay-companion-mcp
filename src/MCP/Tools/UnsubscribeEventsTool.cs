using OverlayCompanion.Services;
using System.ComponentModel;
using System.Text.Json;
using ModelContextProtocol.Server;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// MCP tool for unsubscribing from UI events
/// Implements the unsubscribe_events tool from MCP_SPECIFICATION.md
/// </summary>
[McpServerToolType]
public static class UnsubscribeEventsTool
{
    [McpServerTool, Description("Unsubscribe from UI events")]
    public static async Task<string> UnsubscribeEvents(
        IInputMonitorService inputService,
        IModeManager modeManager,
        [Description("Subscription ID to unsubscribe from")] string subscriptionId)
    {
        // Check if action is allowed in current mode
        if (!modeManager.CanExecuteAction("unsubscribe_events"))
        {
            throw new InvalidOperationException($"Action 'unsubscribe_events' not allowed in {modeManager.CurrentMode} mode");
        }

        if (string.IsNullOrEmpty(subscriptionId))
        {
            throw new ArgumentException("subscription_id parameter is required");
        }

        // Access the static subscriptions from SubscribeEventsTool using reflection
        var subscriptionsField = typeof(SubscribeEventsTool).GetField("_subscriptions", 
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);
        
        bool success = false;
        int remainingSubscriptions = 0;
        
        if (subscriptionsField?.GetValue(null) is Dictionary<string, string> subscriptions)
        {
            success = subscriptions.Remove(subscriptionId);
            remainingSubscriptions = subscriptions.Count;
            
            // If no more subscriptions, stop monitoring
            if (remainingSubscriptions == 0 && inputService.IsMonitoring)
            {
                inputService.StopMonitoring();
                Console.WriteLine("Stopped input monitoring - no active subscriptions");
            }
        }

        if (success)
        {
            Console.WriteLine($"Unsubscribed from events with subscription ID: {subscriptionId}");
        }
        else
        {
            Console.WriteLine($"Subscription ID not found: {subscriptionId}");
        }

        // Return JSON string response
        var response = new
        {
            ok = success,
            subscription_id = subscriptionId,
            remaining_subscriptions = remainingSubscriptions,
            monitoring_active = inputService.IsMonitoring
        };

        return JsonSerializer.Serialize(response);
    }
}