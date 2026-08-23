using System.Security.Cryptography;
using System.Text;

namespace OverlayCompanion.Tests.Playwright;

/// <summary>
/// Minimal RFC 6238 / RFC 4226 TOTP generator for the second-factor E2E tests.
/// The two-factor plugin is configured with 6 digits and a 30s period
/// (infra/server/src/better-auth.ts), so the code here matches that exactly.
/// </summary>
internal static class Totp
{
    /// <summary>Generate the current 6-digit TOTP code for a base32 secret.</summary>
    public static string Now(string base32Secret)
    {
        long counter = DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 30L;
        return Generate(base32Secret, counter);
    }

    /// <summary>Generate a 6-digit code for a specific counter (deterministic tests).</summary>
    public static string Generate(string base32Secret, long counter)
    {
        byte[] secret = Base32Decode(base32Secret);
        var msg = new byte[8];
        for (int i = 7; i >= 0; i--)
        {
            msg[i] = (byte)(counter & 0xff);
            counter >>= 8;
        }

        byte[] hash = HMACSHA1.HashData(secret, msg);
        int offset = hash[^1] & 0x0f;
        int binary = ((hash[offset] & 0x7f) << 24)
                     | (hash[offset + 1] << 16)
                     | (hash[offset + 2] << 8)
                     | hash[offset + 3];
        return (binary % 1_000_000).ToString("D6");
    }

    /// <summary>Pull the base32 secret out of an otpauth:// TOTP URI.</summary>
    public static string SecretFromUri(string otpauthUri)
    {
        var uri = new Uri(otpauthUri);
        string query = uri.Query.TrimStart('?');
        foreach (string part in query.Split('&'))
        {
            int eq = part.IndexOf('=');
            if (eq < 0) continue;
            if (part[..eq].Equals("secret", StringComparison.OrdinalIgnoreCase))
            {
                return part[(eq + 1)..].Trim();
            }
        }
        throw new InvalidOperationException($"No 'secret' parameter in TOTP URI: {otpauthUri}");
    }

    private static byte[] Base32Decode(string input)
    {
        const string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // pragma: allowlist secret (RFC 4648 base32 alphabet, not a credential)
        string clean = input.TrimEnd('=').ToUpperInvariant();
        var result = new List<byte>();
        int buffer = 0, bitsLeft = 0;
        foreach (char c in clean)
        {
            int val = alphabet.IndexOf(c);
            if (val < 0) throw new FormatException($"Invalid base32 character: {c}");
            buffer = (buffer << 5) | val;
            bitsLeft += 5;
            if (bitsLeft >= 8)
            {
                result.Add((byte)((buffer >> (bitsLeft - 8)) & 0xff));
                bitsLeft -= 8;
            }
        }
        return result.ToArray();
    }
}
