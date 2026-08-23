using Microsoft.Playwright;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace OverlayCompanion.Tests.Playwright;

/// <summary>
/// Login flow tests (build scope A). Covers the local-auth fallback and the
/// auth gate. Requires LOCAL_AUTH_ENABLED=true and SIGNUP_ALLOWED=true.
/// </summary>
[TestClass]
public class LoginFlowTests : PlaywrightWebTestBase
{
    private const string TestUsername = "pw-test-admin@overlay.test";
    private const string TestPassword = "TestPassphrase!2026"; // pragma: allowlist secret (test fixture, not a real credential)

    [TestInitialize]
    public async Task TestInit()
    {
        await StartDriverAsync();
    }

    [TestMethod]
    public async Task AuthStatusReportsLocalAuthAvailable()
    {
        await GoToAsync("/auth/status");
        var body = await BodyTextAsync();
        Assert.IsTrue(body.Contains("\"local\"") && body.Contains("true"),
            "Local auth should be enabled in the test environment.");
    }

    [TestMethod]
    public async Task LocalLoginFlow_SignsInAndExposesSession()
    {
        await RegisterOrLoginAsync(TestUsername, TestPassword);
        await GoToAsync("/auth/me");
        var body = await BodyTextAsync();
        Assert.IsTrue(body.Contains(TestUsername) || body.Contains("\"user\""),
            "After local login, /auth/me should return the user.");
    }

    [TestMethod]
    public async Task LogoutClearsSession()
    {
        await RegisterOrLoginAsync(TestUsername, TestPassword);
        var meRaw = await Page!.EvaluateAsync<string>("fetch('/auth/me', { credentials: 'include' }).then(r => r.text())");
        var csrf = RegexExtract(meRaw, "\"csrfToken\"\\s*:\\s*\"([^\"]+)\"");
        await FetchStatusAsync("/auth/logout", "POST", csrf: csrf);

        await GoToAsync("/auth/me");
        var body = await BodyTextAsync();
        Assert.IsTrue(
            body.Contains("unauthenticated") || body.Contains("error") || body.Contains("Sign in"),
            "After logout, /auth/me should deny access.");
    }

    private static string RegexExtract(string? input, string pattern)
    {
        var m = System.Text.RegularExpressions.Regex.Match(input ?? "", pattern);
        return m.Success ? m.Groups[1].Value : "";
    }
}
