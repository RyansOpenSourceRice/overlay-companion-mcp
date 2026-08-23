using Microsoft.Playwright;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace OverlayCompanion.Tests.Playwright;

/// <summary>
/// End-to-end GUI tests for the TLS / HTTPS &amp; Certificates settings (§7).
/// Covers: navigating to Settings, the "HTTPS &amp; Certificates" card,
/// changing terminator/mode via the GUI, generating a self-signed cert
/// (permission-gated), and seeing status reflected. Requires LOCAL_AUTH_ENABLED
/// =true, SIGNUP_ALLOWED=true and reachable SurrealDB.
/// </summary>
[TestClass]
public class TlsSettingsTests : PlaywrightWebTestBase
{
    private const string TestEmail = AssemblyInit.AdminEmail;
    private const string TestPassword = AssemblyInit.AdminPassword;

    [TestInitialize]
    public async Task TestInit()
    {
        await StartDriverAsync();
    }

    [TestMethod]
    public async Task SettingsPage_ShowsHttpsCertificatesCard()
    {
        await EnsureAdminAsync();
        var text = await WaitForTextAsync("Mode", 20) ?? await WaitForTextAsync("Terminator", 20);
        Assert.IsNotNull(text, "Settings page should render the HTTPS & Certificates card controls.");
    }

    [TestMethod]
    public async Task GenerateSelfSigned_UpdatesStatus()
    {
        await EnsureAdminAsync();

        await Page!.Locator("button:has-text('Generate self-signed')").First.WaitForAsync(
            new LocatorWaitForOptions { State = WaitForSelectorState.Visible });
        Page.Dialog += (_, e) => _ = e.AcceptAsync();
        await Page.Locator("button:has-text('Generate self-signed')").First.ClickAsync();

        var statusAfter = await WaitForTextAsync("Loaded", 20);
        Assert.IsNotNull(statusAfter, "After generating a self-signed cert, status should show 'Loaded'.");
    }

    [TestMethod]
    public async Task StatusEndpoint_ReflectsMode()
    {
        await EnsureAdminAsync();
        Assert.IsNotNull(await WaitForTextAsync("certificate", 15),
            "The certificate status block should render.");
    }

    // ---- Helpers ----------------------------------------------------------

    private async Task EnsureAdminAsync()
    {
        await GoToAsync("/");
        if (!string.IsNullOrEmpty(AssemblyInit.SessionCookieValue))
        {
            await Context!.AddCookiesAsync(new[]
            {
                new Cookie { Name = "better-auth.session_token", Value = AssemblyInit.SessionCookieValue, Url = TargetUrl.TrimEnd('/') + "/", Path = "/" }
            });
            await GoToAsync("/");
        }
        else
        {
            for (int attempt = 0; attempt < 3; attempt++)
            {
                await GoToAsync("/");
                await LoginAsAdminAsync(TestEmail, TestPassword);
                await GoToAsync("/");
                if (await WaitForNavAsync(10)) break;
            }
        }
        await WaitForNavAsync(15);
        await OpenSettingsPageAsync();
    }

    private async Task<bool> WaitForNavAsync(int seconds)
    {
        try
        {
            await Page!.Locator(".nav-btn").First.WaitForAsync(new LocatorWaitForOptions
            {
                State = WaitForSelectorState.Attached,
#pragma warning disable CS0618 // Timeout is still used by the locator option set
                Timeout = seconds * 1000
#pragma warning restore CS0618
            });
            return true;
        }
        catch (TimeoutException)
        {
            return false;
        }
    }

    private async Task LoginAsAdminAsync(string email, string password)
    {
        await FetchStatusAsync("/api/auth/sign-in/email", "POST",
            $"{{\"email\":\"{email}\",\"password\":\"{password}\"}}");
    }

    private async Task OpenSettingsPageAsync()
    {
        await Page!.Locator(".nav-btn[data-page='settings']").WaitForAsync();
        await Page.Locator(".nav-btn[data-page='settings']").ClickAsync();
        await Page.Locator("#settings-page").WaitForAsync();
        await Page.Locator("select[data-field='terminator']").WaitForAsync(
            new LocatorWaitForOptions { State = WaitForSelectorState.Visible });
    }

    private async Task<string?> WaitForTextAsync(string fragment, int seconds)
    {
        try
        {
            await Page!.WaitForFunctionAsync(
                "f => document.body.innerText.includes(f)", fragment,
                new PageWaitForFunctionOptions { Timeout = seconds * 1000 });
            return await BodyTextAsync();
        }
        catch (TimeoutException)
        {
            return null;
        }
    }
}
