using System.Text;
using System.Text.Json;

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
    private readonly string _baseUrl;
    private readonly string _apiKey;

    public ClipboardBridgeService(ILogger<ClipboardBridgeService> logger, IConfiguration configuration)
    {
        _logger = logger;
        
        // Get configuration from appsettings.json or environment variables
        _baseUrl = configuration["ClipboardBridge:BaseUrl"] ?? "http://localhost:8765";
        _apiKey = configuration["ClipboardBridge:ApiKey"] ?? "overlay-companion-mcp";
        
        _httpClient = new HttpClient();
        _httpClient.DefaultRequestHeaders.Add("X-API-Key", _apiKey);
        _httpClient.Timeout = TimeSpan.FromSeconds(5); // Short timeout for clipboard operations
        
        _logger.LogInformation("Clipboard Bridge Service initialized with URL: {BaseUrl}", _baseUrl);
    }

    public async Task<string?> GetClipboardAsync(string format = "text")
    {
        try
        {
            _logger.LogDebug("Getting clipboard content from VM bridge");
            
            var response = await _httpClient.GetAsync($"{_baseUrl}/clipboard");
            
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

            var httpContent = new StringContent(jsonContent, Encoding.UTF8, "application/json");
            var response = await _httpClient.PostAsync($"{_baseUrl}/clipboard", httpContent);
            
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
        try
        {
            _logger.LogDebug("Clearing clipboard content in VM bridge");
            
            var response = await _httpClient.DeleteAsync($"{_baseUrl}/clipboard");
            
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
        try
        {
            var response = await _httpClient.GetAsync($"{_baseUrl}/health");
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