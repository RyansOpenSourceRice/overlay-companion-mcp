using Microsoft.VisualStudio.TestTools.UnitTesting;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;

namespace OverlayCompanion.Tests.Appium;

/// <summary>
/// Web UI smoke tests. These run under the Appium umbrella (preferences §9)
/// and cover the app's reachability, the auth gate, and navigation. They do
/// not exercise the MCP tools — those are covered by the Python harness and
/// the C# integration tests. The goal here is a real test job in CI that
/// catches regressions in the web layer and the login flow.
/// </summary>
[TestClass]
public class WebSmokeTests : AppiumWebTestBase
{
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
    public void HomePageLoads_AndShowsAppName()
    {
        GoTo("/");
        // The header, loading screen, or login view should mention the app
        // name. Wait for rendered text rather than asserting immediately, so a
        // transient blank-body read during SPA bootstrap cannot flake.
        var body = Wait!.Until(d =>
        {
            var text = d.FindElement(By.TagName("body")).Text;
            return text.Contains("Overlay Companion") || text.Contains("Initializing") ? text : null;
        });
        Assert.IsNotNull(body, "Expected the app name or loading screen on the home page.");
    }

    [TestMethod]
    public void HealthEndpointReportsHealthy()
    {
        GoTo("/health");
        var body = Driver!.FindElement(By.TagName("body")).Text;
        // The health JSON should at least mention a status field. We do not
        // hard-assert 'healthy' because downstream services (SurrealDB, MCP)
        // may be down in a bare test env — only the web server must respond.
        Assert.IsTrue(body.Contains("status"), "Health endpoint should return a status field.");
    }

    [TestMethod]
    public void AuthStatusEndpointResponds()
    {
        GoTo("/auth/status");
        var body = Driver!.FindElement(By.TagName("body")).Text;
        Assert.IsTrue(body.Contains("enabled"), "Auth status should report the enabled flag.");
    }
}
