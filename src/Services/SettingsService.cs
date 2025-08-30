using System.Text.Json;

namespace OverlayCompanion.Services;

/// <summary>
/// Service for managing application settings through web interface
/// Provides persistent storage and dynamic configuration updates
/// </summary>
public interface ISettingsService
{
    Task<T?> GetSettingAsync<T>(string key, T? defaultValue = default);
    Task SetSettingAsync<T>(string key, T value);
    Task<bool> DeleteSettingAsync(string key);
    Task<Dictionary<string, object>> GetAllSettingsAsync();
    Task<ClipboardBridgeSettings> GetClipboardBridgeSettingsAsync();
    Task SetClipboardBridgeSettingsAsync(ClipboardBridgeSettings settings);
}

public class SettingsService : ISettingsService
{
    private readonly ILogger<SettingsService> _logger;
    private readonly string _settingsFilePath;
    private readonly SemaphoreSlim _fileLock = new(1, 1);
    private Dictionary<string, object> _cachedSettings = new();
    private DateTime _lastLoadTime = DateTime.MinValue;
    private readonly TimeSpan _cacheTimeout = TimeSpan.FromSeconds(30);

    public SettingsService(ILogger<SettingsService> logger)
    {
        _logger = logger;
        
        // Store settings in user data directory
        var dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".overlay-companion");
        Directory.CreateDirectory(dataDir);
        _settingsFilePath = Path.Combine(dataDir, "settings.json");
        
        _logger.LogInformation("Settings service initialized with file: {SettingsFile}", _settingsFilePath);
    }

    public async Task<T?> GetSettingAsync<T>(string key, T? defaultValue = default)
    {
        await EnsureSettingsLoadedAsync();
        
        if (_cachedSettings.TryGetValue(key, out var value))
        {
            try
            {
                if (value is JsonElement jsonElement)
                {
                    return JsonSerializer.Deserialize<T>(jsonElement.GetRawText());
                }
                else if (value is T directValue)
                {
                    return directValue;
                }
                else
                {
                    // Try to convert the value
                    var json = JsonSerializer.Serialize(value);
                    return JsonSerializer.Deserialize<T>(json);
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to deserialize setting {Key} to type {Type}", key, typeof(T).Name);
                return defaultValue;
            }
        }
        
        return defaultValue;
    }

    public async Task SetSettingAsync<T>(string key, T value)
    {
        await _fileLock.WaitAsync();
        try
        {
            await EnsureSettingsLoadedAsync();
            
            _cachedSettings[key] = value!;
            await SaveSettingsAsync();
            
            _logger.LogDebug("Setting {Key} updated", key);
        }
        finally
        {
            _fileLock.Release();
        }
    }

    public async Task<bool> DeleteSettingAsync(string key)
    {
        await _fileLock.WaitAsync();
        try
        {
            await EnsureSettingsLoadedAsync();
            
            var removed = _cachedSettings.Remove(key);
            if (removed)
            {
                await SaveSettingsAsync();
                _logger.LogDebug("Setting {Key} deleted", key);
            }
            
            return removed;
        }
        finally
        {
            _fileLock.Release();
        }
    }

    public async Task<Dictionary<string, object>> GetAllSettingsAsync()
    {
        await EnsureSettingsLoadedAsync();
        return new Dictionary<string, object>(_cachedSettings);
    }

    public async Task<ClipboardBridgeSettings> GetClipboardBridgeSettingsAsync()
    {
        var settings = await GetSettingAsync<ClipboardBridgeSettings>("clipboard_bridge");
        return settings ?? new ClipboardBridgeSettings();
    }

    public async Task SetClipboardBridgeSettingsAsync(ClipboardBridgeSettings settings)
    {
        await SetSettingAsync("clipboard_bridge", settings);
    }

    private async Task EnsureSettingsLoadedAsync()
    {
        if (DateTime.UtcNow - _lastLoadTime > _cacheTimeout)
        {
            await LoadSettingsAsync();
        }
    }

    private async Task LoadSettingsAsync()
    {
        try
        {
            if (File.Exists(_settingsFilePath))
            {
                var json = await File.ReadAllTextAsync(_settingsFilePath);
                var settings = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json);
                
                if (settings != null)
                {
                    _cachedSettings = settings.ToDictionary(
                        kvp => kvp.Key,
                        kvp => (object)kvp.Value
                    );
                }
            }
            else
            {
                _cachedSettings = new Dictionary<string, object>();
            }
            
            _lastLoadTime = DateTime.UtcNow;
            _logger.LogDebug("Settings loaded from {SettingsFile}", _settingsFilePath);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to load settings from {SettingsFile}", _settingsFilePath);
            _cachedSettings = new Dictionary<string, object>();
        }
    }

    private async Task SaveSettingsAsync()
    {
        try
        {
            var json = JsonSerializer.Serialize(_cachedSettings, new JsonSerializerOptions
            {
                WriteIndented = true
            });
            
            await File.WriteAllTextAsync(_settingsFilePath, json);
            _lastLoadTime = DateTime.UtcNow;
            
            _logger.LogDebug("Settings saved to {SettingsFile}", _settingsFilePath);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to save settings to {SettingsFile}", _settingsFilePath);
            throw;
        }
    }
}

/// <summary>
/// Configuration settings for the clipboard bridge
/// </summary>
public class ClipboardBridgeSettings
{
    public bool Enabled { get; set; } = true;
    public string BaseUrl { get; set; } = "http://localhost:8765";
    public string ApiKey { get; set; } = "overlay-companion-mcp";
    public int TimeoutSeconds { get; set; } = 5;
    public bool FallbackToLocal { get; set; } = true;
    public string Description { get; set; } = "VM clipboard bridge for cross-system clipboard synchronization";
}