using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;
using System.Text.Json;

namespace OverlayCompanion.MCP;

/// <summary>
/// MCP request model
/// </summary>
public class McpRequest
{
    public string JsonRpc { get; set; } = "2.0";
    public string Method { get; set; } = string.Empty;
    public Dictionary<string, object> Parameters { get; set; } = new();
    public string? Id { get; set; }
}

/// <summary>
/// MCP response model
/// </summary>
public class McpResponse
{
    public string JsonRpc { get; set; } = "2.0";
    public object? Result { get; set; }
    public McpError? Error { get; set; }
    public string? Id { get; set; }
}

/// <summary>
/// MCP error model
/// </summary>
public class McpError
{
    public int Code { get; set; }
    public string Message { get; set; } = string.Empty;
    public object? Data { get; set; }
}

/// <summary>
/// Base interface for MCP tools
/// </summary>
public interface IMcpTool
{
    string Name { get; }
    string Description { get; }
    Task<object> ExecuteAsync(Dictionary<string, object> parameters);
}

/// <summary>
/// MCP tool registry
/// </summary>
public class McpToolRegistry
{
    private readonly Dictionary<string, IMcpTool> _tools = new();

    public void RegisterTool(IMcpTool tool)
    {
        _tools[tool.Name] = tool;
    }

    public IMcpTool? GetTool(string name)
    {
        return _tools.TryGetValue(name, out var tool) ? tool : null;
    }

    public string[] GetToolNames()
    {
        return _tools.Keys.ToArray();
    }

    public IMcpTool[] GetAllTools()
    {
        return _tools.Values.ToArray();
    }
}

/// <summary>
/// Extension methods for parameter handling
/// </summary>
public static class ParameterExtensions
{
    [RequiresUnreferencedCode("JSON deserialization may require types that cannot be statically analyzed")]
    public static T GetValue<T>(this Dictionary<string, object> parameters, string key, T defaultValue = default!)
    {
        if (!parameters.TryGetValue(key, out var value))
            return defaultValue;

        if (value is JsonElement jsonElement)
        {
            return JsonSerializer.Deserialize<T>(jsonElement.GetRawText()) ?? defaultValue;
        }

        if (value is T directValue)
            return directValue;

        try
        {
            return (T)Convert.ChangeType(value, typeof(T));
        }
        catch
        {
            return defaultValue;
        }
    }

    public static bool HasValue(this Dictionary<string, object> parameters, string key)
    {
        return parameters.ContainsKey(key);
    }
}