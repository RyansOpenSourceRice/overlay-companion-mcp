using OverlayCompanion.Services;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace OverlayCompanion.MCP.Tools;

/// <summary>
/// MCP tool for unsubscribing from UI events
/// Implements the unsubscribe_events tool from MCP_SPECIFICATION.md
/// </summary>
public class UnsubscribeEventsTool : IMcpTool
{
    private readonly IInputMonitorService _inputService;
    private readonly IModeManager _modeManager;

    public string Name => "unsubscribe_events";
    public string Description => "Unsubscribe from UI events";

    public UnsubscribeEventsTool(IInputMonitorService inputService, IModeManager modeManager)
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
        var subscriptionId = parameters.GetValue<string>("subscription_id");
        
        if (string.IsNullOrEmpty(subscriptionId))
        {
            throw new ArgumentException("subscription_id parameter is required");
        }

        // Access the static subscriptions from SubscribeEventsTool
        var subscriptionsField = typeof(SubscribeEventsTool).GetField("_subscriptions", 
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);
        
        bool success = false;
        
        if (subscriptionsField?.GetValue(null) is Dictionary<string, string> subscriptions)
        {
            success = subscriptions.Remove(subscriptionId);
            
            // If no more subscriptions, stop monitoring
            if (subscriptions.Count == 0 && _inputService.IsMonitoring)
            {
                _inputService.StopMonitoring();
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

        // Return MCP-compliant response
        return new
        {
            ok = success
        };
    }
}