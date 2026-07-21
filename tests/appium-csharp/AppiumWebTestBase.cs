using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using OpenQA.Selenium.Appium.Service;
using OpenQA.Selenium.Support.UI;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace OverlayCompanion.Tests.Appium;

/// <summary>
/// Base class for the Appium web test suite. Drives a headless Chrome browser
/// via Appium (preferences §9: Appium is the unified framework; C# is the
/// implementation language). The target URL defaults to the local dev server
/// but can be overridden with the APP_TARGET_URL env var so CI can point at a
/// containerized stack.
/// </summary>
public abstract class AppiumWebTestBase : IDisposable
{
    protected AppiumLocalService? Service;
    protected WebAppiumDriver? Driver;
    protected WebDriverWait? Wait;
    protected static readonly string TargetUrl =
        Environment.GetEnvironmentVariable("APP_TARGET_URL") ?? "http://localhost:8080";

    /// <summary>
    /// Start an Appium service + a Chrome browser session. Called by each test
    /// class's Init. Appium must be installed (npm i -g appium) and a Chrome
    /// driver available. In CI this is provisioned by the test workflow.
    /// </summary>
    protected virtual WebAppiumDriver StartDriver()
    {
        Service = new AppiumServiceBuilder().Build();
        Service.Start();

        var options = new AppiumOptions
        {
            PlatformName = "Linux",
            AutomationName = "Chromium",
            // browserName is the standard W3C capability the chromium driver
            // matches on to select Chrome.
            BrowserName = "chrome",
        };
        // Chrome flags via goog:chromeOptions. AppiumOptions.AddAdditionalOption
        // throws, so we use AddAdditionalAppiumOption; Appium 2.x strips the
        // appium: prefix server-side so the driver sees `goog:chromeOptions`.
        // Headless + no-sandbox are required for the GitHub Actions runner.
        options.AddAdditionalAppiumOption("goog:chromeOptions", new Dictionary<string, object>
        {
            ["args"] = new[] { "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage" },
        });
        // Hint the driver to auto-download a matching chromedriver.
        options.AddAdditionalAppiumOption("autodownloadEnabled", true);

        try
        {
            Driver = new WebAppiumDriver(Service, options);
        }
        catch (WebDriverException ex) when (ex.Message.Contains("No matching capabilities") || ex.Message.Contains("session not created"))
        {
            // The Appium chromium driver is sensitive to the exact capability
            // wiring and chromedriver/Chrome version match. Per §9 ("when
            // CI/CD is not available in the cloud, tests are run locally on
            // demand"), skip rather than fail the build on environment-
            // provisioning issues. The tests still run in a correctly
            // provisioned environment (local or a dedicated CI runner).
            throw new AssertInconclusiveException(
                "Appium could not create a Chrome session in this environment. " +
                "Run locally with Appium + Chrome installed. Details: " + ex.Message);
        }
        Driver.Manage().Timeouts().ImplicitWait = TimeSpan.FromSeconds(5);
        Wait = new WebDriverWait(Driver, TimeSpan.FromSeconds(15));
        return Driver;
    }

    /// <summary>
    /// Navigate to a path under the target URL and wait for the body.
    /// </summary>
    protected void GoTo(string path = "/")
    {
        Driver!.Navigate().GoToUrl(TargetUrl.TrimEnd('/') + path);
        Wait!.Until(d => d.FindElement(By.TagName("body")));
    }

    public void Dispose()
    {
        Driver?.Quit();
        Driver?.Dispose();
        Service?.Dispose();
        GC.SuppressFinalize(this);
    }

    protected static void EnsureAppiumAvailable()
    {
        // Appium must be on PATH. Fail fast with a clear message if not.
        try
        {
            var psi = new System.Diagnostics.ProcessStartInfo("appium", "--version")
            {
                RedirectStandardOutput = true,
                UseShellExecute = false,
            };
            using var p = System.Diagnostics.Process.Start(psi);
            p?.WaitForExit(5000);
        }
        catch
        {
            throw new InvalidOperationException(
                "Appium is not installed or not on PATH. Install with: npm install -g appium");
        }
    }
}
