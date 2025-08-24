using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using System.Net.WebSockets;
using System.Text.Json;
using OverlayCompanion.Web;
using OverlayCompanion.Services;

namespace OverlayCompanion.Web;

public static class WebSocketEndpoints
{
    public static void MapOverlayWebSockets(this WebApplication app)
    {
        app.UseWebSockets();

        app.Map("/ws/overlays", async (HttpContext context, IOverlayEventBroadcaster broadcaster, IOverlayService overlayService) =>
        {
            if (!context.WebSockets.IsWebSocketRequest)
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                await context.Response.WriteAsync("Expected WebSocket request");
                return;
            }

            using var socket = await context.WebSockets.AcceptWebSocketAsync();
            var id = broadcaster.AddClient(socket);

            // Proactively sync current overlay state to the new viewer
            try
            {
                var current = await overlayService.GetActiveOverlaysAsync();
                var payload = new
                {
                    type = "sync_state",
                    overlays = current.Select(o => new
                    {
                        id = o.Id,
                        x = o.Bounds.X,
                        y = o.Bounds.Y,
                        width = o.Bounds.Width,
                        height = o.Bounds.Height,
                        color = o.Color,
                        opacity = o.Opacity,
                        monitor_index = o.MonitorIndex,
                        created_at = o.CreatedAt
                    }).ToArray()
                };
                var json = JsonSerializer.Serialize(payload);
                var seg = new ArraySegment<byte>(System.Text.Encoding.UTF8.GetBytes(json));
                await socket.SendAsync(seg, WebSocketMessageType.Text, true, CancellationToken.None);
            }
            catch { /* best-effort */ }

            try
            {
                var buffer = new byte[1024];
                // Keep the socket alive; accept but ignore client messages for now
                while (socket.State == WebSocketState.Open)
                {
                    var result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);
                    if (result.CloseStatus.HasValue) break;
                }
            }
            finally
            {
                broadcaster.RemoveClient(id);
            }
        });
    }
}
