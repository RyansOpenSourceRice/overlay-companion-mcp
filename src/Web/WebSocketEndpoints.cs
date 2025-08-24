using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using System.Net.WebSockets;
using OverlayCompanion.Web;

namespace OverlayCompanion.Web;

public static class WebSocketEndpoints
{
    public static void MapOverlayWebSockets(this WebApplication app)
    {
        app.UseWebSockets();

        app.Map("/ws/overlays", async (HttpContext context, IOverlayEventBroadcaster broadcaster) =>
        {
            if (!context.WebSockets.IsWebSocketRequest)
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                await context.Response.WriteAsync("Expected WebSocket request");
                return;
            }

            using var socket = await context.WebSockets.AcceptWebSocketAsync();
            var id = broadcaster.AddClient(socket);

            try
            {
                var buffer = new byte[1024];
                // Keep the socket alive; no commands expected from client yet
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
