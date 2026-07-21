using Microsoft.VisualStudio.TestTools.UnitTesting;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;

namespace OverlayCompanion.Tests.Appium;

/// <summary>
/// Login flow tests (per build scope A). Covers the local-auth fallback and
/// the auth gate. OIDC is exercised end-to-end only in a full stack; here we
/// validate the local login form appears, accepts credentials, and that the
/// /auth/me endpoint reflects the session after login.
///
/// These tests require a running server with LOCAL_AUTH_ENABLED=true and
/// SIGNUP_ALLOWED=true (or a pre-seeded local user). In CI the test workflow
/// boots the compose stack with those flags set.
/// </summary>
[TestClass]
public class LoginFlowTests : AppiumWebTestBase
{
    private const string TestUsername = "appium-test-admin";
    private const string TestPassword = "TestPassphrase!2026"; // pragma: allowlist secret (test fixture, not a real credential)

    [ClassInitialize]
    public static void ClassInit(TestContext context)
    {
        EnsureAppiumAvailable();
    }

    [TestInitialize]
    public void TestInit()
    {
        StartDriver();
    }

    [TestMethod]
    public void AuthStatusReportsLocalAuthAvailable()
    {
        GoTo("/auth/status");
        var body = Driver!.FindElement(By.TagName("body")).Text;
        // When local auth is enabled, the status reports local.enabled=true.
        Assert.IsTrue(
            body.Contains("\"local\"") && body.Contains("true"),
            "Local auth should be enabled in the test environment.");
    }

    [TestMethod]
    public void LocalLoginFlow_SignsInAndExposesSession()
    {
        // Register the test user (idempotent-ish: if it exists, login instead).
        GoTo("/");
        TryRegister(TestUsername, TestPassword);

        // The session cookie is set by the login/register call. Verify /auth/me
        // now returns the user rather than 401.
        GoTo("/auth/me");
        var body = Driver!.FindElement(By.TagName("body")).Text;
        Assert.IsTrue(
            body.Contains(TestUsername) || body.Contains("\"user\""),
            "After local login, /auth/me should return the user.");
    }

    [TestMethod]
    public void LogoutClearsSession()
    {
        TryRegister(TestUsername, TestPassword);
        // Call logout via the API (the button does a fetch POST).
        ((IJavaScriptExecutor)Driver!).ExecuteScript(
            "return fetch('/auth/logout', { method: 'POST', credentials: 'include' }).then(r => r.status);");

        GoTo("/auth/me");
        var body = Driver!.FindElement(By.TagName("body")).Text;
        // After logout, /auth/me is 401 — the body will be an error JSON.
        Assert.IsTrue(
            body.Contains("unauthenticated") || body.Contains("error") || body.Contains("Sign in"),
            "After logout, /auth/me should deny access.");
    }

    private void TryRegister(string username, string password)
    {
        // Hit the register endpoint directly; the UI form does the same. If the
        // user already exists (from a prior run), fall back to login.
        var script =
            $"return fetch('/auth/local/register', {{ method: 'POST', headers: {{ 'Content-Type': 'application/json' }}, " +
            $"body: JSON.stringify({{ username: '{username}', password: '{password}' }}) }}).then(r => r.status);";
        var status = ((IJavaScriptExecutor)Driver!).ExecuteScript(script) as long?;
        if (status != 200)
        {
            // User exists or signups locked — try login.
            var loginScript =
                $"return fetch('/auth/local/login', {{ method: 'POST', headers: {{ 'Content-Type': 'application/json' }}, " +
                $"body: JSON.stringify({{ username: '{username}', password: '{password}' }}) }}).then(r => r.status);";
            ((IJavaScriptExecutor)Driver!).ExecuteScript(loginScript);
        }
    }
}
