using System.Text.Json;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace OverlayCompanion.Tests.Playwright;

/// <summary>
/// Optional TOTP second-factor flow (build scope D). Covers enrolling TOTP,
/// the two-factor challenge on login, and the /auth/local/verify-totp step
/// wired in infra/server/src/server.ts. Requires LOCAL_AUTH_ENABLED=true and
/// the two-factor Better Auth plugin (always registered in better-auth.ts).
/// </summary>
[TestClass]
public class TwoFactorFlowTests : PlaywrightWebTestBase
{
    private const string TestUsername = "pw-2fa-admin@overlay.test";
    private const string TestPassword = "TestPassphrase!2026"; // pragma: allowlist secret (test fixture, not a real credential)

    [TestInitialize]
    public async Task TestInit()
    {
        await StartDriverAsync();
    }

    [TestMethod]
    public async Task TotpEnable_ThenLogin_RequiresAndVerifiesSecondFactor()
    {
        // 1. Register + sign in (a session is required to enable 2FA).
        await RegisterOrLoginAsync(TestUsername, TestPassword);

        // 2. Enable TOTP: the plugin returns an otpauth URI with the shared secret.
        var enable = await FetchJsonAsync(
            "/api/auth/two-factor/enable", "POST",
            $"{{\"method\":\"totp\",\"password\":\"{TestPassword}\"}}");
        Assert.AreEqual(200, enable.Status, $"Enable should succeed: {enable.Body}");
        string? totpUri = JsonPath(enable.Body, "totpURI");
        Assert.IsNotNull(totpUri, "Enable should return a TOTP URI.");
        string secret = Totp.SecretFromUri(totpUri!);

        // 3. Confirm enable by verifying a code (flips twoFactorEnabled=true).
        var confirm = await VerifyTotpAsync("/api/auth/two-factor/verify-totp", secret);
        Assert.AreEqual(200, confirm.Status, $"Confirm should succeed: {confirm.Body}");

        // 4. Drop the session so the next login triggers a 2FA challenge.
        await FetchStatusAsync("/auth/logout", "POST");

        // 5. Password login now returns a two-factor challenge, not a user.
        var login = await FetchJsonAsync(
            "/auth/local/login", "POST",
            $"{{\"username\":\"{TestUsername}\",\"password\":\"{TestPassword}\"}}");
        Assert.AreEqual(200, login.Status, $"Login should succeed: {login.Body}");
        Assert.AreEqual(true, JsonBool(login.Body, "twoFactor.required"),
            "Login should demand a second factor for a 2FA-enabled account.");
        Assert.IsTrue(JsonArrayContains(login.Body, "twoFactor.methods", "totp"),
            "The challenge should list totp as an available method.");

        // 6. Verify the code -> returns the signed-in user.
        var verify = await VerifyTotpAsync("/auth/local/verify-totp", secret);
        Assert.AreEqual(200, verify.Status, $"Verify-totp should succeed: {verify.Body}");

        // 7. The session is now established.
        await GoToAsync("/auth/me");
        var me = await BodyTextAsync();
        Assert.IsTrue(me.Contains(TestUsername) || me.Contains("\"user\""),
            "After 2FA verification, /auth/me should return the user.");
    }

    [TestMethod]
    public async Task TotpVerify_WrongCode_Returns401()
    {
        // Set up a 2FA-enabled account (same flow as above, up to confirmation).
        await RegisterOrLoginAsync(TestUsername, TestPassword);
        var enable = await FetchJsonAsync(
            "/api/auth/two-factor/enable", "POST",
            $"{{\"method\":\"totp\",\"password\":\"{TestPassword}\"}}");
        Assert.AreEqual(200, enable.Status, $"Enable should succeed: {enable.Body}");
        string secret = Totp.SecretFromUri(JsonPath(enable.Body, "totpURI")!);
        var confirm = await VerifyTotpAsync("/api/auth/two-factor/verify-totp", secret);
        Assert.AreEqual(200, confirm.Status, $"Confirm should succeed: {confirm.Body}");

        await FetchStatusAsync("/auth/logout", "POST");
        await FetchJsonAsync(
            "/auth/local/login", "POST",
            $"{{\"username\":\"{TestUsername}\",\"password\":\"{TestPassword}\"}}");

        // A wrong code must be rejected as 401 (auth_failed), never accepted.
        var bad = await FetchJsonAsync("/auth/local/verify-totp", "POST", "{\"code\":\"000000\"}");
        Assert.AreEqual(401, bad.Status, $"Wrong code should be 401: {bad.Body}");
    }

    /// <summary>
    /// Generate a fresh code, submit it, and retry once if a 30s window rolled
    /// over between generation and server verification. A 401 here means the
    /// code was rejected (expired/wrong), so a single regenerate is safe.
    /// </summary>
    private async Task<(int Status, string Body)> VerifyTotpAsync(string path, string secret)
    {
        for (int attempt = 0; attempt < 2; attempt++)
        {
            string code = Totp.Now(secret);
            var r = await FetchJsonAsync(path, "POST", $"{{\"code\":\"{code}\"}}");
            if (r.Status != 401) return r;
            await Task.Delay(1500);
        }
        return await FetchJsonAsync(path, "POST", $"{{\"code\":\"{Totp.Now(secret)}\"}}");
    }

    private static string? JsonPath(string json, string dotPath)
    {
        using var doc = JsonDocument.Parse(json);
        JsonElement el = doc.RootElement;
        foreach (string part in dotPath.Split('.'))
        {
            if (el.ValueKind == JsonValueKind.Object && el.TryGetProperty(part, out var next)) el = next;
            else return null;
        }
        return el.ValueKind == JsonValueKind.String ? el.GetString() : el.ToString();
    }

    private static bool? JsonBool(string json, string dotPath)
    {
        using var doc = JsonDocument.Parse(json);
        JsonElement el = doc.RootElement;
        foreach (string part in dotPath.Split('.'))
        {
            if (el.ValueKind == JsonValueKind.Object && el.TryGetProperty(part, out var next)) el = next;
            else return null;
        }
        return el.ValueKind is JsonValueKind.True or JsonValueKind.False ? el.GetBoolean() : null;
    }

    private static bool JsonArrayContains(string json, string dotPath, string value)
    {
        using var doc = JsonDocument.Parse(json);
        JsonElement el = doc.RootElement;
        foreach (string part in dotPath.Split('.'))
        {
            if (el.ValueKind == JsonValueKind.Object && el.TryGetProperty(part, out var next)) el = next;
            else return false;
        }
        if (el.ValueKind != JsonValueKind.Array) return false;
        foreach (JsonElement item in el.EnumerateArray())
            if (item.ValueKind == JsonValueKind.String && item.GetString() == value) return true;
        return false;
    }
}
