using Microsoft.Playwright;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace OverlayCompanion.Tests.Playwright;

/// <summary>
/// Web UI smoke tests (Playwright, FireFox). Cover the app's reachability,
/// the auth gate, and the health/auth status endpoints — the real CI test job
/// for the web layer, superseding the Appium suite.
/// </summary>
[TestClass]
public class WebSmokeTests : PlaywrightWebTestBase
{
    [TestInitialize]
    public async Task TestInit()
    {
        await StartDriverAsync();
    }

    [TestMethod]
    public async Task HomePageLoads_AndShowsAppName()
    {
        await GoToAsync("/");
        // Wait for rendered text rather than asserting immediately so a transient
        // blank body during SPA bootstrap cannot flake.
        await Page!.WaitForFunctionAsync(
            "() => { const t = document.body.innerText; return t.includes('Overlay Companion') || t.includes('Initializing'); }");
        var body = await BodyTextAsync();
        StringAssert.Contains(body, "Overlay");
    }

    [TestMethod]
    public async Task HealthEndpointReportsHealthy()
    {
        await GoToAsync("/health");
        var body = await BodyTextAsync();
        Assert.IsTrue(body.Contains("status"), "Health endpoint should return a status field.");
    }

    [TestMethod]
    public async Task AuthStatusEndpointResponds()
    {
        await GoToAsync("/auth/status");
        var body = await BodyTextAsync();
        Assert.IsTrue(body.Contains("enabled"), "Auth status should report the enabled flag.");
    }
}
