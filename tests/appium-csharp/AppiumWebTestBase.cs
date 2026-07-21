using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using OpenQA.Selenium.Appium.Service;
using OpenQA.Selenium.Support.UI;

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
            // browserName is a standard W3C capability (not an appium: extension).
            // The Appium chromium driver matches on it to pick Chrome.
            BrowserName = "chrome",
        };
        // goog:chromeOptions is passed via AddAdditionalAppiumOption. The Appium
        // chromium driver reads it nested (per appium/appium-chromium-driver).
        // Note: AppiumOptions.AddAdditionalOption throws NotImplementedException,
        // so the appium-option path is the only way to add vendor capabilities.
        options.AddAdditionalAppiumOption("goog:chromeOptions", new Dictionary<string, object>
        {
            ["args"] = new[] { "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage" },
        });

        Driver = new WebAppiumDriver(Service, options);
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
