using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using OverlayCompanion.Models;

namespace OverlayCompanion.Web;

public interface IOverlayEventBroadcaster
{
    Guid AddClient(WebSocket socket, IDictionary<string, string>? meta = null);
    void RemoveClient(Guid clientId);
    Task BroadcastOverlayCreatedAsync(OverlayElement overlay);
    Task BroadcastOverlayRemovedAsync(string overlayId);
    Task BroadcastClearAsync();
    int ClientCount { get; }
}

public class OverlayEventBroadcaster : IOverlayEventBroadcaster
{
    private readonly ConcurrentDictionary<Guid, WebSocket> _clients = new();

    public int ClientCount => _clients.Count;

    public Guid AddClient(WebSocket socket, IDictionary<string, string>? meta = null)
    {
        var id = Guid.NewGuid();
        _clients[id] = socket;
        return id;
    }

    public void RemoveClient(Guid clientId)
    {
        if (_clients.TryRemove(clientId, out var socket))
        {
            try { socket.Abort(); } catch { /* ignore */ }
            try { socket.Dispose(); } catch { /* ignore */ }
        }
    }

    public Task BroadcastOverlayCreatedAsync(OverlayElement overlay)
        => BroadcastAsync(new
        {
            type = "overlay_created",
            overlay = new
            {
                id = overlay.Id,
                x = overlay.Bounds.X,
                y = overlay.Bounds.Y,
                width = overlay.Bounds.Width,
                height = overlay.Bounds.Height,
                color = overlay.Color,
                opacity = overlay.Opacity,
                monitor_index = overlay.MonitorIndex,
                created_at = overlay.CreatedAt
            }
        });

    public Task BroadcastOverlayRemovedAsync(string overlayId)
        => BroadcastAsync(new { type = "overlay_removed", overlay_id = overlayId });

    public Task BroadcastClearAsync() => BroadcastAsync(new { type = "clear_overlays" });

    private async Task BroadcastAsync(object payload)
    {
        if (_clients.IsEmpty) return;

        var json = JsonSerializer.Serialize(payload);
        var buffer = Encoding.UTF8.GetBytes(json);
        var segment = new ArraySegment<byte>(buffer);

        var dead = new List<Guid>();
        foreach (var kv in _clients)
        {
            var id = kv.Key;
            var ws = kv.Value;
            if (ws.State != WebSocketState.Open)
            {
                dead.Add(id);
                continue;
            }
            try
            {
                await ws.SendAsync(segment, WebSocketMessageType.Text, true, CancellationToken.None);
            }
            catch
            {
                dead.Add(id);
            }
        }
        // Cleanup dead sockets
        foreach (var d in dead)
        {
            RemoveClient(d);
        }
    }
}
