using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace OverlayCompanion.Services;

public class ConnectionConfig
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Name { get; set; } = string.Empty;
    public string Host { get; set; } = string.Empty;
    public int Port { get; set; }
    public string Protocol { get; set; } = "kasmvnc"; // kasmvnc, vnc, rdp
    public string? Username { get; set; }
    public string? Password { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastConnected { get; set; }
    public bool IsActive { get; set; }
}

public class ConnectionValidationResult
{
    public bool IsValid { get; set; }
    public List<string> Errors { get; set; } = new();
    public List<string> Warnings { get; set; } = new();
}

public interface IConnectionManagementService
{
    Task<ConnectionConfig> AddConnectionAsync(ConnectionConfig config);
    Task<ConnectionConfig?> GetConnectionAsync(string id);
    Task<List<ConnectionConfig>> GetAllConnectionsAsync();
    Task<bool> RemoveConnectionAsync(string id);
    Task<ConnectionConfig> UpdateConnectionAsync(ConnectionConfig config);
    Task<ConnectionValidationResult> ValidateConnectionAsync(ConnectionConfig config);
    Task<bool> TestConnectionAsync(string id);
    Task<ConnectionConfig?> GetActiveConnectionAsync();
    Task<bool> SetActiveConnectionAsync(string id);
}

public class ConnectionManagementService : IConnectionManagementService
{
    private readonly ILogger<ConnectionManagementService> _logger;
    private readonly Dictionary<string, ConnectionConfig> _connections = new();
    private readonly SemaphoreSlim _lock = new(1, 1);
    private readonly string _storageFile;

    public ConnectionManagementService(ILogger<ConnectionManagementService> logger)
    {
        _logger = logger;
        _storageFile = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ".overlay-companion",
            "connections.json"
        );

        _ = LoadConnectionsAsync();
    }

    public async Task<ConnectionConfig> AddConnectionAsync(ConnectionConfig config)
    {
        await _lock.WaitAsync();
        try
        {
            // Validate the connection
            var validation = await ValidateConnectionAsync(config);
            if (!validation.IsValid)
            {
                throw new ArgumentException($"Invalid connection configuration: {string.Join(", ", validation.Errors)}");
            }

            // Ensure unique ID
            if (string.IsNullOrEmpty(config.Id))
            {
                config.Id = Guid.NewGuid().ToString();
            }

            // Check for duplicate
            if (_connections.ContainsKey(config.Id))
            {
                throw new InvalidOperationException($"Connection with ID {config.Id} already exists");
            }

            config.CreatedAt = DateTime.UtcNow;
            _connections[config.Id] = config;

            await SaveConnectionsAsync();

            _logger.LogInformation("Added connection {Name} ({Protocol}://{Host}:{Port})",
                config.Name, config.Protocol, config.Host, config.Port);

            return config;
        }
        finally
        {
            _lock.Release();
        }
    }

    public async Task<ConnectionConfig?> GetConnectionAsync(string id)
    {
        await _lock.WaitAsync();
        try
        {
            return _connections.TryGetValue(id, out var config) ? config : null;
        }
        finally
        {
            _lock.Release();
        }
    }

    public async Task<List<ConnectionConfig>> GetAllConnectionsAsync()
    {
        await _lock.WaitAsync();
        try
        {
            return _connections.Values.ToList();
        }
        finally
        {
            _lock.Release();
        }
    }

    public async Task<bool> RemoveConnectionAsync(string id)
    {
        await _lock.WaitAsync();
        try
        {
            if (_connections.Remove(id))
            {
                await SaveConnectionsAsync();
                _logger.LogInformation("Removed connection {Id}", id);
                return true;
            }
            return false;
        }
        finally
        {
            _lock.Release();
        }
    }

    public async Task<ConnectionConfig> UpdateConnectionAsync(ConnectionConfig config)
    {
        await _lock.WaitAsync();
        try
        {
            if (!_connections.ContainsKey(config.Id))
            {
                throw new KeyNotFoundException($"Connection with ID {config.Id} not found");
            }

            // Validate the updated connection
            var validation = await ValidateConnectionAsync(config);
            if (!validation.IsValid)
            {
                throw new ArgumentException($"Invalid connection configuration: {string.Join(", ", validation.Errors)}");
            }

            _connections[config.Id] = config;
            await SaveConnectionsAsync();

            _logger.LogInformation("Updated connection {Name} ({Id})", config.Name, config.Id);

            return config;
        }
        finally
        {
            _lock.Release();
        }
    }

    public async Task<ConnectionValidationResult> ValidateConnectionAsync(ConnectionConfig config)
    {
        var result = new ConnectionValidationResult { IsValid = true };

        // Validate name
        if (string.IsNullOrWhiteSpace(config.Name))
        {
            result.Errors.Add("Connection name is required");
            result.IsValid = false;
        }

        // Validate host
        if (string.IsNullOrWhiteSpace(config.Host))
        {
            result.Errors.Add("Host is required");
            result.IsValid = false;
        }

        // Validate port
        if (config.Port < 1 || config.Port > 65535)
        {
            result.Errors.Add("Port must be between 1 and 65535");
            result.IsValid = false;
        }

        // Validate protocol
        var validProtocols = new[] { "kasmvnc", "vnc", "rdp" };
        if (!validProtocols.Contains(config.Protocol.ToLowerInvariant()))
        {
            result.Errors.Add($"Protocol must be one of: {string.Join(", ", validProtocols)}");
            result.IsValid = false;
        }

        // Protocol-specific validation
        if (config.Protocol.ToLowerInvariant() == "rdp")
        {
            // RDP requires both username and password
            if (string.IsNullOrWhiteSpace(config.Username))
            {
                result.Errors.Add("RDP protocol requires a username");
                result.IsValid = false;
            }
            if (string.IsNullOrWhiteSpace(config.Password))
            {
                result.Errors.Add("RDP protocol requires a password");
                result.IsValid = false;
            }

            // Warn about multi-monitor limitations
            result.Warnings.Add("RDP multi-monitor support requires Windows 7+ Enterprise/Ultimate and full-screen mode");
        }
        else if (config.Protocol.ToLowerInvariant() == "vnc")
        {
            // VNC can work with password-only
            if (string.IsNullOrWhiteSpace(config.Password))
            {
                result.Warnings.Add("VNC typically requires at least a password for authentication");
            }

            // Warn about multi-monitor limitations
            result.Warnings.Add("Standard VNC has limited multi-monitor support (single canvas display)");
        }
        else if (config.Protocol.ToLowerInvariant() == "kasmvnc")
        {
            // KasmVNC is flexible
            if (string.IsNullOrWhiteSpace(config.Password) && string.IsNullOrWhiteSpace(config.Username))
            {
                result.Warnings.Add("KasmVNC typically requires authentication (password or username+password)");
            }
        }

        // Validate default ports
        var defaultPorts = new Dictionary<string, int>
        {
            { "kasmvnc", 6901 },
            { "vnc", 5900 },
            { "rdp", 3389 }
        };

        if (defaultPorts.TryGetValue(config.Protocol.ToLowerInvariant(), out var defaultPort))
        {
            if (config.Port != defaultPort)
            {
                result.Warnings.Add($"Non-standard port for {config.Protocol} (default is {defaultPort})");
            }
        }

        return await Task.FromResult(result);
    }

    public async Task<bool> TestConnectionAsync(string id)
    {
        var config = await GetConnectionAsync(id);
        if (config == null)
        {
            return false;
        }

        try
        {
            // Basic connectivity test - try to connect to the port
            using var client = new System.Net.Sockets.TcpClient();
            var connectTask = client.ConnectAsync(config.Host, config.Port);
            var timeoutTask = Task.Delay(5000);

            var completedTask = await Task.WhenAny(connectTask, timeoutTask);

            if (completedTask == connectTask && client.Connected)
            {
                _logger.LogInformation("Connection test successful for {Name} ({Host}:{Port})",
                    config.Name, config.Host, config.Port);

                // Update last connected time
                config.LastConnected = DateTime.UtcNow;
                await UpdateConnectionAsync(config);

                return true;
            }

            _logger.LogWarning("Connection test failed for {Name} ({Host}:{Port}) - timeout or connection refused",
                config.Name, config.Host, config.Port);
            return false;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Connection test failed for {Name} ({Host}:{Port})",
                config.Name, config.Host, config.Port);
            return false;
        }
    }

    public async Task<ConnectionConfig?> GetActiveConnectionAsync()
    {
        await _lock.WaitAsync();
        try
        {
            return _connections.Values.FirstOrDefault(c => c.IsActive);
        }
        finally
        {
            _lock.Release();
        }
    }

    public async Task<bool> SetActiveConnectionAsync(string id)
    {
        await _lock.WaitAsync();
        try
        {
            if (!_connections.ContainsKey(id))
            {
                return false;
            }

            // Deactivate all connections
            foreach (var conn in _connections.Values)
            {
                conn.IsActive = false;
            }

            // Activate the specified connection
            _connections[id].IsActive = true;

            await SaveConnectionsAsync();

            _logger.LogInformation("Set active connection to {Name} ({Id})",
                _connections[id].Name, id);

            return true;
        }
        finally
        {
            _lock.Release();
        }
    }

    private async Task LoadConnectionsAsync()
    {
        await _lock.WaitAsync();
        try
        {
            if (!File.Exists(_storageFile))
            {
                _logger.LogInformation("No existing connections file found");
                return;
            }

            var json = await File.ReadAllTextAsync(_storageFile);
            var connections = JsonSerializer.Deserialize<List<ConnectionConfig>>(json);

            if (connections != null)
            {
                foreach (var conn in connections)
                {
                    _connections[conn.Id] = conn;
                }

                _logger.LogInformation("Loaded {Count} connections from storage", connections.Count);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to load connections from storage");
        }
        finally
        {
            _lock.Release();
        }
    }

    private async Task SaveConnectionsAsync()
    {
        try
        {
            var directory = Path.GetDirectoryName(_storageFile);
            if (!string.IsNullOrEmpty(directory) && !Directory.Exists(directory))
            {
                Directory.CreateDirectory(directory);
            }

            var json = JsonSerializer.Serialize(_connections.Values.ToList(), new JsonSerializerOptions
            {
                WriteIndented = true
            });

            await File.WriteAllTextAsync(_storageFile, json);

            _logger.LogDebug("Saved {Count} connections to storage", _connections.Count);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to save connections to storage");
        }
    }
}
