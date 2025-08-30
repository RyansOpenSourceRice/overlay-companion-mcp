using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace OverlayCompanion.Services;

/// <summary>
/// Service for communicating with the VM clipboard bridge Flatpak
/// Provides clipboard synchronization between host and VM
/// </summary>
public interface IClipboardBridgeService
{
    Task<string?> GetClipboardAsync(string format = "text");
    Task<bool> SetClipboardAsync(string content, string format = "text");
    Task<bool> ClearClipboardAsync();
    Task<bool> IsAvailableAsync();
}

public class ClipboardBridgeService : IClipboardBridgeService
{
    private readonly HttpClient _httpClient;
    private readonly ILogger<ClipboardBridgeService> _logger;
    private readonly ISettingsService _settingsService;

    public ClipboardBridgeService(ILogger<ClipboardBridgeService> logger, ISettingsService settingsService)
    {
        _logger = logger;
        _settingsService = settingsService;

        _httpClient = new HttpClient();

        _logger.LogInformation("Clipboard Bridge Service initialized with dynamic configuration");
    }

    public async Task<string?> GetClipboardAsync(string format = "text")
    {
        var settings = await _settingsService.GetClipboardBridgeSettingsAsync();
        if (!settings.Enabled)
        {
            return null;
        }

        try
        {
            _logger.LogDebug("Getting clipboard content from VM bridge");

            using var request = new HttpRequestMessage(HttpMethod.Get, $"{settings.BaseUrl}/clipboard");
            request.Headers.Add("X-API-Key", settings.ApiKey);

            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(settings.TimeoutSeconds));
            var response = await _httpClient.SendAsync(request, cts.Token);

            if (response.IsSuccessStatusCode)
            {
                var jsonContent = await response.Content.ReadAsStringAsync();
                var clipboardResponse = JsonSerializer.Deserialize<ClipboardResponse>(jsonContent, new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                });

                if (clipboardResponse?.Success == true)
                {
                    _logger.LogDebug("Successfully retrieved clipboard content from VM bridge: {Length} characters",
                        clipboardResponse.Content?.Length ?? 0);
                    return clipboardResponse.Content;
                }
                else
                {
                    _logger.LogDebug("VM clipboard bridge returned unsuccessful response: {Message}",
                        clipboardResponse?.Message);
                    return null;
                }
            }
            else
            {
                _logger.LogDebug("Failed to get clipboard from VM bridge. Status: {StatusCode}",
                    response.StatusCode);
                return null;
            }
        }
        catch (HttpRequestException ex)
        {
            _logger.LogDebug("Network error communicating with VM clipboard bridge: {Message}", ex.Message);
            return null;
        }
        catch (TaskCanceledException ex)
        {
            _logger.LogDebug("Timeout communicating with VM clipboard bridge: {Message}", ex.Message);
            return null;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Error getting clipboard from VM bridge: {Message}", ex.Message);
            return null;
        }
    }

    public async Task<bool> SetClipboardAsync(string content, string format = "text")
    {
        var settings = await _settingsService.GetClipboardBridgeSettingsAsync();
        if (!settings.Enabled)
        {
            return false;
        }

        try
        {
            _logger.LogDebug("Setting clipboard content in VM bridge: {Length} characters", content.Length);

            var requestData = new ClipboardContent
            {
                Content = content,
                ContentType = format == "html" ? "text/html" : "text/plain"
            };

            var jsonContent = JsonSerializer.Serialize(requestData, new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase
            });

            using var request = new HttpRequestMessage(HttpMethod.Post, $"{settings.BaseUrl}/clipboard");
            request.Headers.Add("X-API-Key", settings.ApiKey);
            request.Content = new StringContent(jsonContent, Encoding.UTF8, "application/json");

            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(settings.TimeoutSeconds));
            var response = await _httpClient.SendAsync(request, cts.Token);

            if (response.IsSuccessStatusCode)
            {
                var responseContent = await response.Content.ReadAsStringAsync();
                var clipboardResponse = JsonSerializer.Deserialize<ClipboardResponse>(responseContent, new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                });

                if (clipboardResponse?.Success == true)
                {
                    _logger.LogDebug("Successfully set clipboard content in VM bridge");
                    return true;
                }
                else
                {
                    _logger.LogDebug("VM clipboard bridge returned unsuccessful response: {Message}",
                        clipboardResponse?.Message);
                    return false;
                }
            }
            else
            {
                _logger.LogDebug("Failed to set clipboard in VM bridge. Status: {StatusCode}",
                    response.StatusCode);
                return false;
            }
        }
        catch (HttpRequestException ex)
        {
            _logger.LogDebug("Network error communicating with VM clipboard bridge: {Message}", ex.Message);
            return false;
        }
        catch (TaskCanceledException ex)
        {
            _logger.LogDebug("Timeout communicating with VM clipboard bridge: {Message}", ex.Message);
            return false;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Error setting clipboard in VM bridge: {Message}", ex.Message);
            return false;
        }
    }

    public async Task<bool> ClearClipboardAsync()
    {
        var settings = await _settingsService.GetClipboardBridgeSettingsAsync();
        if (!settings.Enabled)
        {
            return false;
        }

        try
        {
            _logger.LogDebug("Clearing clipboard content in VM bridge");

            using var request = new HttpRequestMessage(HttpMethod.Delete, $"{settings.BaseUrl}/clipboard");
            request.Headers.Add("X-API-Key", settings.ApiKey);

            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(settings.TimeoutSeconds));
            var response = await _httpClient.SendAsync(request, cts.Token);

            if (response.IsSuccessStatusCode)
            {
                var responseContent = await response.Content.ReadAsStringAsync();
                var clipboardResponse = JsonSerializer.Deserialize<ClipboardResponse>(responseContent, new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                });

                if (clipboardResponse?.Success == true)
                {
                    _logger.LogDebug("Successfully cleared clipboard content in VM bridge");
                    return true;
                }
                else
                {
                    _logger.LogDebug("VM clipboard bridge returned unsuccessful response: {Message}",
                        clipboardResponse?.Message);
                    return false;
                }
            }
            else
            {
                _logger.LogDebug("Failed to clear clipboard in VM bridge. Status: {StatusCode}",
                    response.StatusCode);
                return false;
            }
        }
        catch (HttpRequestException ex)
        {
            _logger.LogDebug("Network error communicating with VM clipboard bridge: {Message}", ex.Message);
            return false;
        }
        catch (TaskCanceledException ex)
        {
            _logger.LogDebug("Timeout communicating with VM clipboard bridge: {Message}", ex.Message);
            return false;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Error clearing clipboard in VM bridge: {Message}", ex.Message);
            return false;
        }
    }

    public async Task<bool> IsAvailableAsync()
    {
        var settings = await _settingsService.GetClipboardBridgeSettingsAsync();
        if (!settings.Enabled)
        {
            return false;
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, $"{settings.BaseUrl}/health");
            request.Headers.Add("X-API-Key", settings.ApiKey);

            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(settings.TimeoutSeconds));
            var response = await _httpClient.SendAsync(request, cts.Token);
            return response.IsSuccessStatusCode;
        }
        catch (Exception)
        {
            // Silently return false - this is expected when the bridge is not available
            return false;
        }
    }

    public void Dispose()
    {
        _httpClient?.Dispose();
    }
}

// Data models for clipboard bridge API
public class ClipboardContent
{
    public string Content { get; set; } = string.Empty;
    public string ContentType { get; set; } = "text/plain";
}

public class ClipboardResponse
{
    public bool Success { get; set; }
    public string? Content { get; set; }
    public string? ContentType { get; set; }
    public string Timestamp { get; set; } = string.Empty;
    public string? Message { get; set; }
}
