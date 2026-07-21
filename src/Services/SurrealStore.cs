using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SurrealDb.Net;
using SurrealDb.Net.Models;

namespace OverlayCompanion.Services;

/// <summary>
/// SurrealDB-backed store for connections, settings, and audit log.
/// SurrealDB is the only database (Ryan's preferences §9). This replaces the
/// JSON-file stores in ConnectionManagementService and SettingsService with a
/// shared, durable store that both the TS management server and the C# MCP
/// server read and write. The connection string comes from the SURREALDB_*
/// environment variables (bootstrap defaults; the GUI is the source of truth).
/// </summary>
public interface ISurrealStore
{
    Task InitializeAsync(CancellationToken cancellationToken = default);
    Task<List<ConnectionConfig>> GetAllConnectionsAsync(string userId, CancellationToken cancellationToken = default);
    Task<ConnectionConfig?> GetConnectionAsync(string id, CancellationToken cancellationToken = default);
    Task<ConnectionConfig> UpsertConnectionAsync(ConnectionConfig config, CancellationToken cancellationToken = default);
    Task<bool> DeleteConnectionAsync(string id, CancellationToken cancellationToken = default);
    Task<T?> GetSettingAsync<T>(string key, T? defaultValue = default, CancellationToken cancellationToken = default);
    Task SetSettingAsync<T>(string key, T value, CancellationToken cancellationToken = default);
    Task AppendAuditAsync(AuditRecord record, CancellationToken cancellationToken = default);
}

public class SurrealStoreOptions
{
    public string Endpoint { get; set; } = "http://surrealdb:8000";
    public string Namespace { get; set; } = "overlay";
    public string Database { get; set; } = "companion";
    public string Username { get; set; } = "root";
    public string Password { get; set; } = "root";
}

public class AuditRecord
{
    public string Id { get; set; } = $"audit_log:{Guid.NewGuid():N}";
    public DateTimeOffset Timestamp { get; set; } = DateTimeOffset.UtcNow;
    public string? UserId { get; set; }
    public string Actor { get; set; } = "system";
    public string Action { get; set; } = "";
    public string? IpAddress { get; set; }
    public object? Detail { get; set; }
}

/// <summary>
/// Record model for a saved connection row in SurrealDB. Implements IRecord so
/// the SDK's Upsert/Create generics accept it. The Id is a RecordId built from
/// the existing Guid-based id so prior data keeps working.
/// </summary>
public class SurrealConnectionRecord : IRecord
{
    public RecordId Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Host { get; set; } = string.Empty;
    public int Port { get; set; }
    public string Protocol { get; set; } = "kasmvnc";
    public string? Username { get; set; }
    public bool Active { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? LastConnected { get; set; }
}

public class SurrealSettingRecord : IRecord
{
    public RecordId Id { get; set; }
    public object Value { get; set; } = new { };
    public string Category { get; set; } = "general";
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class SurrealAuditRecord : IRecord
{
    public RecordId Id { get; set; }
    public DateTimeOffset Timestamp { get; set; } = DateTimeOffset.UtcNow;
    public string? UserId { get; set; }
    public string Actor { get; set; } = "system";
    public string Action { get; set; } = "";
    public string? IpAddress { get; set; }
    public object? Detail { get; set; }
}

public class SurrealStore : ISurrealStore
{
    private readonly ILogger<SurrealStore> _logger;
    private readonly SurrealStoreOptions _options;
    private readonly ISurrealDbClient _db;
    private int _initState; // 0=uninit, 1=initializing, 2=done

    public SurrealStore(ILogger<SurrealStore> logger, IOptions<SurrealStoreOptions> options)
    {
        _logger = logger;
        _options = options.Value;
        // SurrealDbClient is singleton-safe per the SDK lifetime table. The
        // connection auto-reconnects when the DB restarts.
        _db = new SurrealDbClient(_options.Endpoint);
    }

    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        if (Interlocked.CompareExchange(ref _initState, 1, 0) != 0) return;
        try
        {
            await _db.Use(_options.Namespace, _options.Database, cancellationToken);
            await _db.SignIn(new SurrealDb.Net.Models.Auth.RootAuth
            {
                Username = _options.Username,
                Password = _options.Password,
            }, cancellationToken);
            _initState = 2;
            _logger.LogInformation("SurrealDB store connected to {Endpoint} (ns={Ns}, db={Db})",
                _options.Endpoint, _options.Namespace, _options.Database);
        }
        catch (Exception ex)
        {
            _initState = 0;
            // Non-fatal: the file-based fallbacks in the services keep the app
            // working without a DB. The health endpoint reports reachability.
            _logger.LogWarning(ex, "SurrealDB connection failed; services will use file fallback");
        }
    }

    private bool IsReady => _initState == 2;

    public async Task<List<ConnectionConfig>> GetAllConnectionsAsync(string userId, CancellationToken cancellationToken = default)
    {
        if (!IsReady) return new List<ConnectionConfig>();
        try
        {
            var rows = await _db.Select<SurrealConnectionRecord>("connection", cancellationToken);
            return rows.Select(ToConfig).ToList();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "SurrealDB connection select failed");
            return new List<ConnectionConfig>();
        }
    }

    public async Task<ConnectionConfig?> GetConnectionAsync(string id, CancellationToken cancellationToken = default)
    {
        if (!IsReady) return null;
        try
        {
            var recordId = ParseRecordId(id, "connection");
            var row = await _db.Select<SurrealConnectionRecord>(recordId, cancellationToken);
            return row == null ? null : ToConfig(row);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "SurrealDB connection get failed for {Id}", id);
            return null;
        }
    }

    public async Task<ConnectionConfig> UpsertConnectionAsync(ConnectionConfig config, CancellationToken cancellationToken = default)
    {
        if (!IsReady)
        {
            return config;
        }
        try
        {
            var record = FromConfig(config);
            var saved = await _db.Upsert(record, cancellationToken);
            return ToConfig(saved);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "SurrealDB connection upsert failed");
            return config;
        }
    }

    public async Task<bool> DeleteConnectionAsync(string id, CancellationToken cancellationToken = default)
    {
        if (!IsReady) return false;
        try
        {
            var recordId = ParseRecordId(id, "connection");
            return await _db.Delete(recordId, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "SurrealDB connection delete failed for {Id}", id);
            return false;
        }
    }

    public async Task<T?> GetSettingAsync<T>(string key, T? defaultValue = default, CancellationToken cancellationToken = default)
    {
        if (!IsReady) return defaultValue;
        try
        {
            var recordId = ParseRecordId(key, "app_config");
            var row = await _db.Select<SurrealSettingRecord>(recordId, cancellationToken);
            if (row == null) return defaultValue;
            return System.Text.Json.JsonSerializer.Deserialize<T>(row.Value.ToString() ?? "");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "SurrealDB setting get failed for {Key}", key);
            return defaultValue;
        }
    }

    public async Task SetSettingAsync<T>(string key, T value, CancellationToken cancellationToken = default)
    {
        if (!IsReady) return;
        try
        {
            var recordId = ParseRecordId(key, "app_config");
            var record = new SurrealSettingRecord
            {
                Id = recordId,
                Value = value!,
                Category = key.Contains('.') ? key.Split('.')[0] : "general",
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            await _db.Upsert(record, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "SurrealDB setting set failed for {Key}", key);
        }
    }

    public async Task AppendAuditAsync(AuditRecord record, CancellationToken cancellationToken = default)
    {
        if (!IsReady) return;
        try
        {
            var row = new SurrealAuditRecord
            {
                Id = ParseRecordId(record.Id, "audit_log"),
                Timestamp = record.Timestamp,
                UserId = record.UserId,
                Actor = record.Actor,
                Action = record.Action,
                IpAddress = record.IpAddress,
                Detail = record.Detail,
            };
            await _db.Create(row, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "SurrealDB audit append failed");
        }
    }

    private static RecordId ParseRecordId(string id, string table)
    {
        // Accept either "table:id" or a bare id; normalize to a RecordId.
        var parts = id.Split(':', 2);
        if (parts.Length == 2)
        {
            return RecordId.From(parts[0], parts[1]);
        }
        return RecordId.From(table, id);
    }

    private static SurrealConnectionRecord FromConfig(ConnectionConfig config)
    {
        var id = ParseRecordId(config.Id, "connection");
        return new SurrealConnectionRecord
        {
            Id = id,
            Name = config.Name,
            Host = config.Host,
            Port = config.Port,
            Protocol = config.Protocol,
            Username = config.Username,
            Active = config.IsActive,
            CreatedAt = config.CreatedAt,
            UpdatedAt = DateTime.UtcNow,
            LastConnected = config.LastConnected,
        };
    }

    private static ConnectionConfig ToConfig(SurrealConnectionRecord row)
    {
        return new ConnectionConfig
        {
            Id = row.Id.ToString(),
            Name = row.Name,
            Host = row.Host,
            Port = row.Port,
            Protocol = row.Protocol,
            Username = row.Username,
            IsActive = row.Active,
            CreatedAt = row.CreatedAt.UtcDateTime,
            LastConnected = row.LastConnected?.UtcDateTime,
        };
    }
}

