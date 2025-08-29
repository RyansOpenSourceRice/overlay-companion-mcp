using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using OverlayCompanion.Models;

namespace OverlayCompanion.Services;

public class KasmVNCOptions
{
    public string BaseUrl { get; set; } = "http://kasmvnc:6901";
    public string WebSocketUrl { get; set; } = "ws://kasmvnc:6901/websockify";
    public string ApiUrl { get; set; } = "http://kasmvnc:6902";
    public int AdminPort { get; set; } = 3000;
    public int ConnectionTimeoutMs { get; set; } = 5000;
    public int ReconnectDelayMs { get; set; } = 2000;
}

public class DisplayInfo
{
    public int Index { get; set; }
    public int X { get; set; }
    public int Y { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public bool IsPrimary { get; set; }
    public bool KasmVNCSupported { get; set; }
    public double ScaleFactor { get; set; } = 1.0;
}

public class OverlayCommand
{
    public string Type { get; set; } = string.Empty;
    public string Id { get; set; } = string.Empty;
    public int X { get; set; }
    public int Y { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public string? Color { get; set; }
    public double? Opacity { get; set; }
    public int MonitorIndex { get; set; }
    public bool ClickThrough { get; set; } = true;
}

public interface IKasmVNCService : IDisposable
{
    Task<bool> IsConnectedAsync();
    Task<DisplayInfo[]> GetDisplaysAsync();
    Task SendOverlayCommandAsync(OverlayCommand command);
    Task<string> GetSessionStatusAsync();
    Task<bool> TestConnectionAsync();
    Task<bool> ConnectAsync();
    Task DisconnectAsync();
}

public class KasmVNCService : IKasmVNCService
{
    private readonly HttpClient _httpClient;
    private readonly KasmVNCOptions _options;
    private readonly ILogger<KasmVNCService> _logger;
    private ClientWebSocket? _webSocket;
    private CancellationTokenSource? _cancellationTokenSource;
    private readonly SemaphoreSlim _connectionSemaphore = new(1, 1);
    private bool _disposed;

    public KasmVNCService(HttpClient httpClient, IOptions<KasmVNCOptions> options, ILogger<KasmVNCService> logger)
    {
        _httpClient = httpClient;
        _options = options.Value;
        _logger = logger;

        // Configure HTTP client timeout
        _httpClient.Timeout = TimeSpan.FromMilliseconds(_options.ConnectionTimeoutMs);
    }

    public async Task<bool> IsConnectedAsync()
    {
        return _webSocket?.State == WebSocketState.Open;
    }

    public async Task<bool> ConnectAsync()
    {
        await _connectionSemaphore.WaitAsync();
        try
        {
            if (_webSocket?.State == WebSocketState.Open)
            {
                return true;
            }

            await DisconnectInternalAsync();

            _cancellationTokenSource = new CancellationTokenSource();
            _webSocket = new ClientWebSocket();

            try
            {
                var uri = new Uri(_options.WebSocketUrl);
                _logger.LogInformation("Connecting to KasmVNC WebSocket: {Url}", uri);

                await _webSocket.ConnectAsync(uri, _cancellationTokenSource.Token);

                _logger.LogInformation("Successfully connected to KasmVNC WebSocket");

                // Start background message handling
                _ = Task.Run(HandleWebSocketMessages, _cancellationTokenSource.Token);

                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to connect to KasmVNC WebSocket");
                await DisconnectInternalAsync();
                return false;
            }
        }
        finally
        {
            _connectionSemaphore.Release();
        }
    }

    public async Task DisconnectAsync()
    {
        await _connectionSemaphore.WaitAsync();
        try
        {
            await DisconnectInternalAsync();
        }
        finally
        {
            _connectionSemaphore.Release();
        }
    }

    private async Task DisconnectInternalAsync()
    {
        _cancellationTokenSource?.Cancel();

        if (_webSocket != null)
        {
            try
            {
                if (_webSocket.State == WebSocketState.Open)
                {
                    await _webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Disconnecting", CancellationToken.None);
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Error during WebSocket close");
            }
            finally
            {
                _webSocket.Dispose();
                _webSocket = null;
            }
        }

        _cancellationTokenSource?.Dispose();
        _cancellationTokenSource = null;
    }

    private async Task HandleWebSocketMessages()
    {
        if (_webSocket == null || _cancellationTokenSource == null)
            return;

        var buffer = new byte[4096];

        try
        {
            while (_webSocket.State == WebSocketState.Open && !_cancellationTokenSource.Token.IsCancellationRequested)
            {
                var result = await _webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), _cancellationTokenSource.Token);

                if (result.MessageType == WebSocketMessageType.Text)
                {
                    var message = Encoding.UTF8.GetString(buffer, 0, result.Count);
                    _logger.LogDebug("Received KasmVNC WebSocket message: {Message}", message);

                    // Handle incoming messages from KasmVNC if needed
                    await HandleKasmVNCMessage(message);
                }
                else if (result.MessageType == WebSocketMessageType.Close)
                {
                    _logger.LogInformation("KasmVNC WebSocket closed by remote");
                    break;
                }
            }
        }
        catch (OperationCanceledException)
        {
            _logger.LogDebug("WebSocket message handling cancelled");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error handling KasmVNC WebSocket messages");
        }
    }

    private async Task HandleKasmVNCMessage(string message)
    {
        try
        {
            using var document = JsonDocument.Parse(message);
            var root = document.RootElement;

            if (root.TryGetProperty("type", out var typeElement))
            {
                var messageType = typeElement.GetString();
                _logger.LogDebug("Handling KasmVNC message type: {Type}", messageType);

                // Handle different message types from KasmVNC
                switch (messageType)
                {
                    case "display_changed":
                        await HandleDisplayChanged(root);
                        break;
                    case "session_status":
                        await HandleSessionStatus(root);
                        break;
                    default:
                        _logger.LogDebug("Unhandled KasmVNC message type: {Type}", messageType);
                        break;
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Error parsing KasmVNC message: {Message}", message);
        }
    }

    private async Task HandleDisplayChanged(JsonElement message)
    {
        _logger.LogInformation("KasmVNC display configuration changed");
        // Could trigger display info refresh or notify other services
        await Task.CompletedTask;
    }

    private async Task HandleSessionStatus(JsonElement message)
    {
        if (message.TryGetProperty("status", out var statusElement))
        {
            var status = statusElement.GetString();
            _logger.LogDebug("KasmVNC session status: {Status}", status);
        }
        await Task.CompletedTask;
    }

    public async Task<DisplayInfo[]> GetDisplaysAsync()
    {
        try
        {
            var response = await _httpClient.GetAsync($"{_options.ApiUrl}/api/displays");
            if (response.IsSuccessStatusCode)
            {
                var json = await response.Content.ReadAsStringAsync();
                var displays = JsonSerializer.Deserialize<DisplayInfo[]>(json);

                _logger.LogDebug("Retrieved {Count} displays from KasmVNC", displays?.Length ?? 0);
                return displays ?? Array.Empty<DisplayInfo>();
            }
            else
            {
                _logger.LogWarning("Failed to get displays from KasmVNC API: {StatusCode}", response.StatusCode);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error getting displays from KasmVNC");
        }

        // Fallback to single display
        return new[]
        {
            new DisplayInfo
            {
                Index = 0,
                X = 0,
                Y = 0,
                Width = 1920,
                Height = 1080,
                IsPrimary = true,
                KasmVNCSupported = false,
                ScaleFactor = 1.0
            }
        };
    }

    public async Task SendOverlayCommandAsync(OverlayCommand command)
    {
        if (_webSocket?.State != WebSocketState.Open)
        {
            _logger.LogWarning("Cannot send overlay command - WebSocket not connected");

            // Attempt to reconnect
            if (!await ConnectAsync())
            {
                _logger.LogError("Failed to reconnect to KasmVNC for overlay command");
                return;
            }
        }

        try
        {
            var message = JsonSerializer.Serialize(new
            {
                type = "overlay_command",
                command = command.Type,
                id = command.Id,
                x = command.X,
                y = command.Y,
                width = command.Width,
                height = command.Height,
                color = command.Color,
                opacity = command.Opacity,
                monitor_index = command.MonitorIndex,
                click_through = command.ClickThrough,
                timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            });

            var buffer = Encoding.UTF8.GetBytes(message);
            await _webSocket!.SendAsync(buffer, WebSocketMessageType.Text, true, CancellationToken.None);

            _logger.LogDebug("Sent overlay command to KasmVNC: {Type} {Id}", command.Type, command.Id);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error sending overlay command to KasmVNC: {Command}", command.Type);
        }
    }

    public async Task<string> GetSessionStatusAsync()
    {
        try
        {
            var response = await _httpClient.GetAsync($"{_options.ApiUrl}/api/session");
            if (response.IsSuccessStatusCode)
            {
                var json = await response.Content.ReadAsStringAsync();
                using var document = JsonDocument.Parse(json);

                if (document.RootElement.TryGetProperty("status", out var statusElement))
                {
                    return statusElement.GetString() ?? "unknown";
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error getting session status from KasmVNC");
        }

        return "unavailable";
    }

    public async Task<bool> TestConnectionAsync()
    {
        try
        {
            var response = await _httpClient.GetAsync($"{_options.BaseUrl}/api/health");
            var isHealthy = response.IsSuccessStatusCode;

            _logger.LogDebug("KasmVNC health check: {Status}", isHealthy ? "healthy" : "unhealthy");
            return isHealthy;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error testing KasmVNC connection");
            return false;
        }
    }

    public void Dispose()
    {
        if (_disposed)
            return;

        _disposed = true;

        try
        {
            DisconnectAsync().GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Error during KasmVNCService disposal");
        }

        _connectionSemaphore.Dispose();
        GC.SuppressFinalize(this);
    }
}
