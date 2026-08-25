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
    public async Task AuthStatusReportsPasskeyAndTotp()
    {
        // §7: the status contract now advertises the optional second factors.
        // TOTP has no origin requirement so is always enabled; passkey is only
        // reported enabled when BETTER_AUTH_PASSKEY_RP_ID is set (matches
        // better-auth.ts, which registers the passkey plugin conditionally).
        await GoToAsync("/auth/status");
        var body = await BodyTextAsync();
        Assert.IsTrue(body.Contains("\"passkey\""),
            "/auth/status should advertise the passkey field.");
        Assert.IsTrue(body.Contains("\"totp\""),
            "/auth/status should advertise the totp field.");
        Assert.IsTrue(body.Contains("\"enabled\"") && body.Contains("true"),
            "The second-factor fields should expose an enabled flag.");
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

        // Better Auth's native sign-out endpoint (the same one the header GUI
        // logout button hits) revokes the session and clears the cookie.
        await FetchStatusAsync("/api/auth/sign-out", "POST");

        await GoToAsync("/auth/me");
        var body = await BodyTextAsync();
        Assert.IsTrue(
            body.Contains("unauthenticated") || body.Contains("error") || body.Contains("Sign in"),
            "After logout, /auth/me should deny access.");
    }

    [TestMethod]
    public async Task GuiLoginAndLogout_HidesAndShowsNav()
    {
        // Drive the GUI (header Sign out button + login form), not the fetch
        // API. When logged out the login view replaces #app, so the nav
        // (Computers/Settings/Assistant) and the logout button must not exist.
        await RegisterOrLoginAsync(TestUsername, TestPassword);

        // The SPA boots asynchronously past the auth gate after the page load;
        // wait for the app shell (nav) to appear before asserting.
        await Page!.WaitForSelectorAsync(".main-nav", new() { State = WaitForSelectorState.Visible });
        Assert.IsTrue(await Page!.IsVisibleAsync(".main-nav"),
            "Nav should be visible when logged in.");
        Assert.IsTrue(await Page!.IsVisibleAsync("#logout-btn"),
            "Header sign-out button should be visible when logged in.");

        // Log out via the GUI button.
        await Page!.ClickAsync("#logout-btn");
        await Page!.WaitForSelectorAsync("form.login-local-form", new() { State = WaitForSelectorState.Visible });

        Assert.IsFalse(await Page!.IsVisibleAsync(".main-nav"),
            "Nav (Computers/Settings/Assistant) must not show when logged out.");
        Assert.IsFalse(await Page!.IsVisibleAsync("#logout-btn"),
            "Sign-out button must not show when logged out.");

        // Log back in via the GUI login form.
        await Page!.FillAsync("#username", TestUsername);
        await Page!.FillAsync("#password", TestPassword);
        await Page!.ClickAsync("form.login-local-form button[type='submit']");
        await Page!.WaitForSelectorAsync(".main-nav", new() { State = WaitForSelectorState.Visible });

        Assert.IsTrue(await Page!.IsVisibleAsync("#logout-btn"),
            "Sign-out button should be visible after GUI sign-in.");
    }
}
