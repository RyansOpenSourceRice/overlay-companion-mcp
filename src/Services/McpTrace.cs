using System.Diagnostics;
using System.Text;
using Microsoft.AspNetCore.Http;

namespace OverlayCompanion.Services;

/// <summary>
/// OpenTelemetry wiring for the MCP server.
///
/// Problem this solves: tool exceptions (e.g. set_display_actor invoked without
/// its required 'actor' argument) surface only as console `fail:` lines. With
/// OTEL_ENABLED=true they now produce queryable spans in Jaeger under the
/// configured service name, with the failing tool name and exception attached.
///
/// Layers:
/// 1. ASP.NET Core request spans (standard instrumentation).
/// 2. One span per JSON-RPC message POSTed to "/" or "/mcp" (McpRpcTraceMiddleware
///    below), named `mcp.{method}` and tagged with `mcp.tool` when present.
///    A JSON-RPC error response, `isError:true` result, HTTP 5xx, or a thrown
///    exception marks the span Error — those always reach Jaeger.
/// 3. Wildcard subscription to any diagnostic sources the ModelContextProtocol
///    SDK itself emits, so native spans are captured for free if present.
///
/// Console logging is intentionally untouched: local log tailing stays useful,
/// and backend volume is naturally bounded because these are discrete user
/// actions (tool calls), not high-frequency frame/telemetry loops.
/// </summary>
internal static class McpTrace
{
    /// <summary>ActivitySource name for our own middleware-emitted spans.</summary>
    public const string SourceName = "overlay-companion-mcp";

    public static readonly ActivitySource Source = new(SourceName);
}

/// <summary>
/// Emits one activity per MCP JSON-RPC request, annotated with the RPC method,
/// target tool, and failure details. Best-effort by design: any parse failure
/// or sniffing hiccup degrades to an unannotated pass-through rather than ever
/// breaking protocol traffic.
/// </summary>
public sealed class McpRpcTraceMiddleware
{
    private readonly RequestDelegate _next;

    public McpRpcTraceMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context)
    {
        // Only instrument JSON-RPC message posts; REST endpoints and GETs
        // (SSE stream + health) get their own AspNetCore-level spans instead.
        if (!HttpMethods.IsPost(context.Request.Method))
        {
            await _next(context).ConfigureAwait(false);
            return;
        }
        var path = context.Request.Path.Value ?? "";
        if (!path.Equals("/", StringComparison.Ordinal) && !path.Equals("/mcp", StringComparison.Ordinal))
        {
            await _next(context).ConfigureAwait(false);
            return;
        }

        var method = "unknown";
        string? toolName = null;
        try
        {
            // Peek-and-rewind so downstream handlers still read the raw body.
            context.Request.EnableBuffering();
            string body;
            using (var reader = new StreamReader(context.Request.Body, Encoding.UTF8,
                detectEncodingFromByteOrderMarks: false, bufferSize: 8192, leaveOpen: true))
            {
                body = await reader.ReadToEndAsync().ConfigureAwait(false);
            }
            context.Request.Body.Position = 0;

            (method, toolName) = TryExtractRpc(body);
        }
        catch
        {
            // Body peek is best-effort; never interfere with request handling.
        }

        using var activity = McpTrace.Source.StartActivity($"mcp.{method}");
        activity?.SetTag("rpc.system", "jsonrpc");
        activity?.SetTag("mcp.method", method);
        if (toolName != null)
        {
            activity?.SetTag("mcp.tool", toolName);
        }

        var sniffer = new ResponseHeadSniffer(context.Response.Body);
        Exception? thrown = null;
        try
        {
            context.Response.Body = sniffer;
            try
            {
                await _next(context).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                thrown = ex;
                throw;
            }
            finally
            {
                context.Response.Body = sniffer.Inner!;
            }

            var failed = thrown != null
                || context.Response.StatusCode >= 500
                || sniffer.Failed();

            if (activity != null && failed)
            {
                activity.SetStatus(ActivityStatusCode.Error, thrown?.Message ?? SniffedError(sniffer));
                if (thrown != null)
                {
                    activity.AddEvent(new ActivityEvent("exception", tags: new ActivityTagsCollection
                    {
                        ["exception.type"] = thrown.GetType().FullName ?? thrown.GetType().Name,
                        ["exception.message"] = thrown.Message,
                        ["exception.stacktrace"] = thrown.StackTrace ?? "",
                    }));
                }
                else
                {
                    activity.AddEvent(new ActivityEvent("jsonrpc.error",
                        tags: new ActivityTagsCollection { ["excerpt"] = SniffedError(sniffer) }));
                }
            }
        }
        finally
        {
            sniffer.Dispose();
        }
    }

    private static string SniffedError(ResponseHeadSniffer sniffer)
    {
        var text = sniffer.CapturedText ?? "";
        return text.Length > 300 ? text[..300] : text;
    }

    private static (string Method, string? Tool) TryExtractRpc(string body)
    {
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(body);
            var root = doc.RootElement;
            if (root.ValueKind == System.Text.Json.JsonValueKind.Array && root.GetArrayLength() > 0)
            {
                root = root[0];
            }
            var method = "unknown";
            if (root.TryGetProperty("method", out var m) && m.ValueKind == System.Text.Json.JsonValueKind.String)
            {
                method = m.GetString() ?? method;
            }
            string? tool = null;
            if (root.TryGetProperty("params", out var p) &&
                p.ValueKind == System.Text.Json.JsonValueKind.Object &&
                p.TryGetProperty("name", out var n) &&
                n.ValueKind == System.Text.Json.JsonValueKind.String)
            {
                tool = n.GetString();
            }
            return (method, tool);
        }
        catch
        {
            return ("unknown", null);
        }
    }
}

/// <summary>
/// Pass-through stream that retains the first bytes of the response so the
/// middleware can detect JSON-RPC error payloads without buffering entire
/// potentially large/successful responses.
/// </summary>
internal sealed class ResponseHeadSniffer : Stream
{
    private readonly Stream _inner;
    private readonly MemoryStream _captured = new();
    private const int CapBytes = 8192;

    public ResponseHeadSniffer(Stream inner) => _inner = inner;

    public Stream Inner => _inner;

    /// <summary>The first response bytes decoded leniently as UTF-8.</summary>
    public string CapturedText => Encoding.UTF8.GetString(_captured.ToArray());

    /// <summary>True when the captured head contains a JSON-RPC error or an isError:true tool result.</summary>
    public bool Failed()
    {
        // Whitespace-insensitive substring probes avoid brittle regexes while
        // matching both "error":{...} envelopes and isError:true results.
        var compact = System.Text.RegularExpressions.Regex.Replace(CapturedText, @"\s+", "");
        return compact.Contains("\"error\":", StringComparison.OrdinalIgnoreCase)
            || compact.Contains("\"isError\":true", StringComparison.OrdinalIgnoreCase);
    }

    public override bool CanRead => false;
    public override bool CanSeek => false;
    public override bool CanWrite => true;
    public override long Length => _inner.Length;
    public override long Position { get => _inner.Position; set => _inner.Position = value; }

    public override void Flush() => _inner.Flush();
    public override Task FlushAsync(CancellationToken cancellationToken) => _inner.FlushAsync(cancellationToken);

    public override void Write(byte[] buffer, int offset, int count)
    {
        Capture(buffer.AsSpan(offset, count));
        _inner.Write(buffer, offset, count);
    }

    public override async ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken cancellationToken = default)
    {
        Capture(buffer.Span);
        await _inner.WriteAsync(buffer, cancellationToken).ConfigureAwait(false);
    }

    public override IAsyncResult BeginWrite(byte[] buffer, int offset, int count, AsyncCallback? callback, object? state)
        => _inner.BeginWrite(buffer, offset, count, callback, state);

    public override void EndWrite(IAsyncResult asyncResult) => _inner.EndWrite(asyncResult);

    private void Capture(ReadOnlySpan<byte> chunk)
    {
        var remaining = CapBytes - (int)_captured.Length;
        if (remaining <= 0) return;
        if (chunk.Length > remaining) chunk = chunk[..remaining];
        _captured.Write(chunk);
    }

    public override void SetLength(long value) => _inner.SetLength(value);

    public override int Read(byte[] buffer, int offset, int count) => _inner.Read(buffer, offset, count);

    public override long Seek(long offset, SeekOrigin origin) => _inner.Seek(offset, origin);

    protected override void Dispose(bool disposing)
    {
        if (disposing) _captured.Dispose();
        base.Dispose(disposing);
    }
}
