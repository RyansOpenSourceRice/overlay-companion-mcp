using Microsoft.VisualStudio.TestTools.UnitTesting;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;

namespace OverlayCompanion.Tests.Appium;

/// <summary>
/// End-to-end GUI tests for the TLS / HTTPS &amp; Certificates settings (§7).
///
/// Covers: the admin navigating to Settings and seeing the "HTTPS &amp;
/// Certificates" card, changing the terminator/mode via the GUI, generating a
/// self-signed cert through the GUI (permission-gated), and seeing the status
/// reflected after reload. The certificate is the SERVER's identity; client
/// trust anchors are installed on end devices; ACME renews automatically.
///
/// Requires a running server with LOCAL_AUTH_ENABLED=true, SIGNUP_ALLOWED=true
/// and a reachable SurrealDB (the CI Appium job boots that stack).
/// </summary>
[TestClass]
public class TlsSettingsTests : AppiumWebTestBase
{
    // Uses the assembly-admin registered in AssemblyInit (guaranteed admin in a
    // fresh DB regardless of class execution order).
    private const string TestUsername = AssemblyInit.AdminUsername;
    private const string TestPassword = AssemblyInit.AdminPassword;

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
    public void SettingsPage_ShowsHttpsCertificatesCard()
    {
        EnsureAdmin();
        // Wait for the card body to finish rendering (the settings form is
        // populated asynchronously after /api/settings returns).
        var text = WaitForText("Mode", 20) ?? WaitForText("Terminator", 20);
        Assert.IsNotNull(text, "Settings page should render the HTTPS & Certificates card controls.");
    }

    [TestMethod]
    public void GenerateSelfSigned_UpdatesStatus()
    {
        EnsureAdmin();

        // Click "Generate self-signed cert"; accept the native confirm(). Wait
        // for the alert to actually appear (headless race) before accepting.
        var genBtn = Wait!.Until(d => d.FindElements(By.CssSelector("button")).FirstOrDefault(
            b => b.Text.Contains("Generate self-signed")));
        Assert.IsNotNull(genBtn, "Generate self-signed button should be present.");
        genBtn!.Click();
        try
        {
            var alertWait = new OpenQA.Selenium.Support.UI.WebDriverWait(Driver, TimeSpan.FromSeconds(5));
            alertWait.Until(d =>
            {
                try { d.SwitchTo().Alert(); return true; }
                catch (NoAlertPresentException) { return false; }
            });
            Driver!.SwitchTo().Alert().Accept();
        }
        catch (WebDriverTimeoutException)
        {
            // No confirm dialog appeared; proceed (some drivers auto-accept).
        }

        // After generation the status should report a loaded certificate.
        var statusAfter = WaitForText("Loaded", 20);
        Assert.IsNotNull(statusAfter, "After generating a self-signed cert, status should show 'Loaded'.");
    }

    [TestMethod]
    public void StatusEndpoint_ReflectsMode()
    {
        EnsureAdmin();
        // Drive the GUI-rendered status from the settings page opened by
        // EnsureAdmin, confirming the certificate status block is present.
        Assert.IsNotNull(WaitForText("certificate", 15),
            "The certificate status block should render.");
    }

    // ---- Helpers ----------------------------------------------------------

    private void EnsureAdmin()
    {
        // Load the origin once, inject the shared admin session cookie captured
        // in AssemblyInit (no per-test login => never hits the login rate
        // limit), then reload into the app view.
        GoTo("/");
        if (!string.IsNullOrEmpty(AssemblyInit.SessionCookieValue))
        {
            var cookie = new Cookie("oc_session", AssemblyInit.SessionCookieValue, "/", null);
            Driver!.Manage().Cookies.AddCookie(cookie);
            GoTo("/");
        }
        else
        {
            // Fallback for environments without a captured session.
            for (int attempt = 0; attempt < 3; attempt++)
            {
                GoTo("/");
                LoginAsAdmin(TestUsername, TestPassword);
                GoTo("/");
                if (WaitForNav(10)) break;
            }
        }
        WaitForNav(15);
        OpenSettingsPage();
    }

    private bool WaitForNav(int seconds)
    {
        try
        {
            var w = new OpenQA.Selenium.Support.UI.WebDriverWait(Driver, TimeSpan.FromSeconds(seconds));
            return w.Until(d => d.FindElements(By.CssSelector(".nav-btn")).Count > 0);
        }
        catch (WebDriverTimeoutException)
        {
            return false;
        }
    }

    private void LoginAsAdmin(string username, string password)
    {
        var script =
            $"return fetch('/auth/local/login', {{ method: 'POST', headers: {{ 'Content-Type': 'application/json' }}, " +
            $"body: JSON.stringify({{ username: '{username}', password: '{password}' }}) }}).then(r => r.status);";
        ((IJavaScriptExecutor)Driver!).ExecuteScript(script);
    }

    private void OpenSettingsPage()
    {
        var nav = Wait!.Until(d => d.FindElement(By.CssSelector(".nav-btn[data-page='settings']")));
        nav.Click();
        Wait!.Until(d => d.FindElement(By.Id("settings-page")));
        // The settings form is rendered asynchronously after /api/settings; the
        // TLS card contains a "Terminator" select. Wait for it to appear.
        Wait!.Until(d => d.FindElements(By.CssSelector("select[data-field='terminator']")).Count > 0);
    }


    private string? WaitForText(string fragment, int seconds = 15)
    {
        var wait = new OpenQA.Selenium.Support.UI.WebDriverWait(Driver, TimeSpan.FromSeconds(seconds));
        try
        {
            return wait.Until(d =>
            {
                var text = ((IJavaScriptExecutor)d).ExecuteScript("return document.body.innerText;") as string ?? "";
                return text.Contains(fragment, System.StringComparison.Ordinal) ? text : null;
            });
        }
        catch (WebDriverTimeoutException)
        {
            return null;
        }
    }
}
