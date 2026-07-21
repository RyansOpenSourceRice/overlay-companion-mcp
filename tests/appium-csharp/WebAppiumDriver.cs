using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using OpenQA.Selenium.Appium.Service;

namespace OverlayCompanion.Tests.Appium;

/// <summary>
/// Concrete Appium driver for a web browser (Chrome) on the test host.
/// Appium.WebDriver 5.x ships AppiumDriver as abstract with platform-specific
/// subclasses (AndroidDriver, IOSDriver, WindowsDriver, MacDriver, TizenDriver)
/// but no Linux/browser concrete subclass. This thin subclass lets the suite
/// drive Chrome under the Appium umbrella (preferences §9: Appium is the
/// unified framework; C# is the implementation language) using the official
/// Appium "chromium" driver (Web mode on macOS/Windows/Linux).
/// </summary>
public sealed class WebAppiumDriver : AppiumDriver
{
    public WebAppiumDriver(AppiumLocalService service, AppiumOptions options)
        : base(service, options.ToCapabilities())
    {
    }
}
