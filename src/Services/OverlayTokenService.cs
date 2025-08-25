using System.Security.Cryptography;
using System.Text;

namespace OverlayCompanion.Services;

public class OverlayTokenService
{
    private readonly byte[]? _secret;
    private readonly TimeSpan _ttl;

    public OverlayTokenService()
    {
        var secret = Environment.GetEnvironmentVariable("OC_OVERLAY_WS_SECRET");
        _secret = string.IsNullOrEmpty(secret) ? null : Encoding.UTF8.GetBytes(secret);
        var ttlEnv = Environment.GetEnvironmentVariable("OC_OVERLAY_WS_TTL_SECONDS");
        if (!int.TryParse(ttlEnv, out var ttlSeconds) || ttlSeconds <= 0) ttlSeconds = 300;
        _ttl = TimeSpan.FromSeconds(ttlSeconds);
    }

    public bool IsProtectionEnabled => _secret != null;

    public string GenerateToken(string? audience = null)
    {
        // When no secret, return empty token (dev mode)
        if (_secret == null) return string.Empty;
        var exp = DateTimeOffset.UtcNow.Add(_ttl).ToUnixTimeSeconds();
        var payload = $"aud={audience ?? "viewer"}&exp={exp}";
        var sig = Sign(payload);
        var token = Convert.ToBase64String(Encoding.UTF8.GetBytes(payload)) + "." + sig;
        return token;
    }

    public bool ValidateToken(string? token, string? audience = null)
    {
        if (_secret == null) return true; // dev mode, allow all
        if (string.IsNullOrWhiteSpace(token)) return false;
        var parts = token.Split('.', 2);
        if (parts.Length != 2) return false;
        string payloadB64 = parts[0];
        string sig = parts[1];
        string payload;
        try { payload = Encoding.UTF8.GetString(Convert.FromBase64String(payloadB64)); }
        catch { return false; }
        if (!TimingSafeEquals(sig, Sign(payload))) return false;
        // Parse payload
        var dict = payload.Split('&')
                          .Select(kv => kv.Split('=', 2))
                          .Where(a => a.Length == 2)
                          .ToDictionary(a => a[0], a => a[1]);
        if (!dict.TryGetValue("exp", out var expStr) || !long.TryParse(expStr, out var exp)) return false;
        if (DateTimeOffset.UtcNow.ToUnixTimeSeconds() > exp) return false;
        if (audience != null && dict.TryGetValue("aud", out var aud) && aud != audience) return false;
        return true;
    }

    private string Sign(string data)
    {
        if (_secret == null) return string.Empty;
        using var hmac = new HMACSHA256(_secret);
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(data));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static bool TimingSafeEquals(string a, string b)
    {
        if (a.Length != b.Length) return false;
        int result = 0;
        for (int i = 0; i < a.Length; i++) result |= a[i] ^ b[i];
        return result == 0;
    }
}
