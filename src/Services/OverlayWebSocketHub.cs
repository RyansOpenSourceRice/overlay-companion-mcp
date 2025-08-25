using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using OverlayCompanion.Models;

namespace OverlayCompanion.Services;

public class OverlayWebSocketHub : IDisposable
{
    private static readonly JsonSerializerOptions JsonOpts = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private readonly ILogger<OverlayWebSocketHub> _logger;
    private readonly IOverlayService _overlayService;
    private readonly IScreenCaptureService _screenCaptureService;
    private readonly ConcurrentDictionary<Guid, WebSocket> _clients = new();

    public OverlayWebSocketHub(ILogger<OverlayWebSocketHub> logger, IOverlayService overlayService, IScreenCaptureService screenCaptureService)
    {
        _logger = logger;
        _overlayService = overlayService;
        _screenCaptureService = screenCaptureService;

        // Subscribe to overlay events
        _overlayService.OverlayCreated += async (_, overlay) => await BroadcastAsync(new { type = "overlay_created", overlay });
        _overlayService.OverlayRemoved += async (_, overlayId) => await BroadcastAsync(new { type = "overlay_removed", overlayId });
        _overlayService.OverlayUpdated += async (_, overlay) => await BroadcastAsync(new { type = "overlay_updated", overlay });
    }

    public async Task HandleClientAsync(WebSocket socket, CancellationToken ct)
    {
        var id = Guid.NewGuid();
        _clients[id] = socket;
        _logger.LogInformation("WebSocket client connected: {ClientId}", id);

        // Send initial sync of active overlays
        try
        {
            var active = await _overlayService.GetActiveOverlaysAsync();
            // Get display info for multi-monitor layout
            var monitors = await _screenCaptureService.GetMonitorsAsync();
            var minX = monitors.Any() ? monitors.Min(m => m.X) : 0;
            var minY = monitors.Any() ? monitors.Min(m => m.Y) : 0;
            var maxX = monitors.Any() ? monitors.Max(m => m.X + m.Width) : 1920;
            var maxY = monitors.Any() ? monitors.Max(m => m.Y + m.Height) : 1080;
            var payload = new
            {
                type = "sync",
                overlays = active,
                displays = monitors.Select(m => new { index = m.Index, name = m.Name, x = m.X, y = m.Y, width = m.Width, height = m.Height, is_primary = m.IsPrimary, scale = m.Scale, refresh_rate = m.RefreshRate }).ToArray(),
                virtual_screen = new { min_x = minX, min_y = minY, width = maxX - minX, height = maxY - minY }
            };
            await SendAsync(socket, payload, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to send initial overlay sync to {ClientId}", id);
        }

        var buffer = new byte[4096];
        try
        {
            while (!ct.IsCancellationRequested && socket.State == WebSocketState.Open)
            {
                var result = await socket.ReceiveAsync(buffer, ct);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    break;
                }
                // Ignore incoming messages for now (viewer is passive)
            }
        }
        catch (OperationCanceledException) { }
        catch (WebSocketException) { }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "WebSocket client error: {ClientId}", id);
        }
        finally
        {
            _clients.TryRemove(id, out _);
            try { await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "bye", CancellationToken.None); } catch { }
            _logger.LogInformation("WebSocket client disconnected: {ClientId}", id);
        }
    }

    private async Task BroadcastAsync(object payload)
    {
        var json = JsonSerializer.Serialize(payload, JsonOpts);
        var bytes = Encoding.UTF8.GetBytes(json);
        var seg = new ArraySegment<byte>(bytes);

        foreach (var kvp in _clients.ToArray())
        {
            var ws = kvp.Value;
            if (ws.State != WebSocketState.Open)
            {
                _clients.TryRemove(kvp.Key, out _);
                continue;
            }
            try
            {
                await ws.SendAsync(seg, WebSocketMessageType.Text, true, CancellationToken.None);
            }
            catch
            {
                _clients.TryRemove(kvp.Key, out _);
            }
        }
    }

    private static Task SendAsync(WebSocket socket, object payload, CancellationToken ct)
    {
        var json = JsonSerializer.Serialize(payload, JsonOpts);
        var bytes = Encoding.UTF8.GetBytes(json);
        return socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, ct);
    }

    public void Dispose()
    {
        foreach (var ws in _clients.Values)
        {
            try { ws.Abort(); } catch { }
        }
        _clients.Clear();
    }
}
