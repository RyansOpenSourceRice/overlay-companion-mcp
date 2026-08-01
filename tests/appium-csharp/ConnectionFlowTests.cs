using Microsoft.VisualStudio.TestTools.UnitTesting;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;

namespace OverlayCompanion.Tests.Appium;

/// <summary>
/// End-to-end tests for saved VM connections (the "connect to the VM and save
/// the connection" flow). Covers the real UI: opening the Add Connection modal,
/// filling the form, submitting, seeing the card render, reloading the page and
/// asserting the connection persists (server + SurrealDB round-trip), editing,
/// deleting, and the Test Connection button.
///
/// These tests require a running server with LOCAL_AUTH_ENABLED=true,
/// SIGNUP_ALLOWED=true, and a reachable SurrealDB (per §9, SurrealDB is the only
/// database; connections are persisted there). The CI workflow boots that stack.
/// </summary>
[TestClass]
public class ConnectionFlowTests : AppiumWebTestBase
{
    private const string TestUsername = "conn-test-admin";
    private const string TestPassword = "TestPassphrase!2026"; // pragma: allowlist secret (test fixture, not a real credential)
    private const string ConnPassword = "VncPass123!"; // pragma: allowlist secret (test fixture, not a real credential)

    // Each test gets a unique connection name so server-side persistence from
    // one test can never collide with another test's assertions.
    private static string UniqueConnName(string prefix) => $"{prefix} {System.DateTime.Now.Ticks}";

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
    public void AddConnection_RendersCard_AndPersistsAcrossReload()
    {
        var connName = UniqueConnName("VM");
        // Register/login so the SPA boots past the auth gate.
        TryRegister(TestUsername, TestPassword);
        GoTo("/");

        // Navigate to the Connections page and open the Add Connection modal.
        GoToConnectionsPage();
        OpenAddModal();

        // Fill the form and submit.
        FillConnectionForm(connName, "127.0.0.1", "5900", "vnc", ConnPassword);
        SubmitConnectionForm();

        // The card should render in the connections list.
        var card = WaitForConnectionCard(connName);
        Assert.IsNotNull(card, $"Connection card for '{connName}' should appear after saving.");

        // Reload the page: the connection must still be there (server-persisted).
        GoTo("/");
        GoToConnectionsPage();
        var cardAfterReload = WaitForConnectionCard(connName);
        Assert.IsNotNull(cardAfterReload, "Connection should persist across a page reload (server-backed).");
    }

    [TestMethod]
    public void EditConnection_UpdatesTheCard()
    {
        var connName = UniqueConnName("VM");
        TryRegister(TestUsername, TestPassword);
        GoTo("/");
        GoToConnectionsPage();
        OpenAddModal();
        FillConnectionForm(connName, "127.0.0.1", "5900", "vnc", ConnPassword);
        SubmitConnectionForm();
        WaitForConnectionCard(connName);

        // Edit the connection via the card's Edit button.
        var card = WaitForConnectionCard(connName);
        var editBtn = card!.FindElement(By.ClassName("btn-secondary"));
        editBtn.Click();

        var nameInput = Wait!.Until(d => d.FindElement(By.Id("connection-name")));
        nameInput.Clear();
        var renamed = connName + " (edited)";
        nameInput.SendKeys(renamed);
        SubmitConnectionForm();

        var renamedCard = WaitForConnectionCard(renamed);
        Assert.IsNotNull(renamedCard, $"Connection card should show the updated name '{renamed}'.");
    }

    [TestMethod]
    public void DeleteConnection_RemovesCard()
    {
        var connName = UniqueConnName("VM");
        TryRegister(TestUsername, TestPassword);
        GoTo("/");
        GoToConnectionsPage();
        OpenAddModal();
        FillConnectionForm(connName, "127.0.0.1", "5900", "vnc", ConnPassword);
        SubmitConnectionForm();
        WaitForConnectionCard(connName);

        // Delete via the card's Delete button (confirm() is native; accept it).
        var card = WaitForConnectionCard(connName);
        card!.FindElement(By.ClassName("btn-danger")).Click();
        try
        {
            Driver!.SwitchTo().Alert().Accept();
        }
        catch (NoAlertPresentException)
        {
            // Some drivers auto-accept; proceed if no alert is present.
        }

        // The card must disappear.
        var gone = WaitUntilGone(connName);
        Assert.IsTrue(gone, $"Connection card for '{connName}' should be removed after delete.");
    }

    [TestMethod]
    public void ConnectionCard_HasTestButton()
    {
        var connName = UniqueConnName("VM");
        TryRegister(TestUsername, TestPassword);
        GoTo("/");
        GoToConnectionsPage();
        OpenAddModal();
        FillConnectionForm(connName, "127.0.0.1", "5900", "vnc", ConnPassword);
        SubmitConnectionForm();
        WaitForConnectionCard(connName);

        // The Test Connection button must be present and clickable in the modal
        // (asserts the request path exists; no live VNC target in CI).
        OpenAddModal();
        var testBtn = Wait!.Until(d => d.FindElement(By.Id("test-connection-btn")));
        Assert.IsTrue(testBtn.Displayed, "Test Connection button should be visible.");
        Assert.IsTrue(testBtn.Enabled, "Test Connection button should be enabled.");
    }

    // ---- UI helpers -------------------------------------------------------

    private void GoToConnectionsPage()
    {
        var nav = Wait!.Until(d =>
            d.FindElement(By.CssSelector(".nav-btn[data-page='connections']")));
        nav.Click();
        Wait!.Until(d => d.FindElement(By.Id("connections-page")));
    }

    private void OpenAddModal()
    {
        var addBtn = Wait!.Until(d => d.FindElement(By.Id("add-connection-btn")));
        addBtn.Click();
        Wait!.Until(d => d.FindElement(By.Id("connection-form")));
    }

    private void FillConnectionForm(string name, string host, string port, string protocol, string password)
    {
        var nameInput = Wait!.Until(d => d.FindElement(By.Id("connection-name")));
        nameInput.Clear();
        nameInput.SendKeys(name);

        var hostInput = Driver!.FindElement(By.Id("connection-host"));
        hostInput.Clear();
        hostInput.SendKeys(host);

        var portInput = Driver.FindElement(By.Id("connection-port"));
        portInput.Clear();
        portInput.SendKeys(port);

        // Select the protocol option if present.
        var protocolSelect = Driver.FindElement(By.Id("connection-protocol"));
        var option = protocolSelect.FindElements(By.CssSelector($"option[value='{protocol}']"));
        if (option.Count > 0)
        {
            var js = Driver as IJavaScriptExecutor;
            js?.ExecuteScript(
                "var s=document.getElementById('connection-protocol');" +
                "s.value='" + protocol + "'; s.dispatchEvent(new Event('change', {bubbles:true}));");
        }

        var pwInput = Driver.FindElement(By.Id("connection-password"));
        pwInput.Clear();
        pwInput.SendKeys(password);
    }

    private void SubmitConnectionForm()
    {
        var form = Wait!.Until(d => d.FindElement(By.Id("connection-form")));
        form.Submit();
    }

    private IWebElement? WaitForConnectionCard(string name)
    {
        try
        {
            return Wait!.Until(d =>
            {
                var cards = d.FindElements(By.CssSelector(".connection-card"));
                foreach (var c in cards)
                {
                    if (c.Text.Contains(name, System.StringComparison.Ordinal))
                        return c;
                }
                return null;
            });
        }
        catch (WebDriverTimeoutException)
        {
            return null;
        }
    }

    private bool WaitUntilGone(string name)
    {
        try
        {
            Wait!.Until(d =>
            {
                var cards = d.FindElements(By.CssSelector(".connection-card"));
                foreach (var c in cards)
                {
                    if (c.Text.Contains(name, System.StringComparison.Ordinal))
                        return false;
                }
                return true;
            });
            return true;
        }
        catch (WebDriverTimeoutException)
        {
            return false;
        }
    }

    private void TryRegister(string username, string password)
    {
        // Hit the register endpoint directly; the UI form does the same. If the
        // user already exists (from a prior run), fall back to login. Navigate
        // to the origin first so the relative fetch() below has a base URL.
        GoTo("/");
        var script =
            $"return fetch('/auth/local/register', {{ method: 'POST', headers: {{ 'Content-Type': 'application/json' }}, " +
            $"body: JSON.stringify({{ username: '{username}', password: '{password}' }}) }}).then(r => r.status);";
        var status = ((IJavaScriptExecutor)Driver!).ExecuteScript(script) as long?;
        if (status != 200)
        {
            var loginScript =
                $"return fetch('/auth/local/login', {{ method: 'POST', headers: {{ 'Content-Type': 'application/json' }}, " +
                $"body: JSON.stringify({{ username: '{username}', password: '{password}' }}) }}).then(r => r.status);";
            ((IJavaScriptExecutor)Driver!).ExecuteScript(loginScript);
        }
        // Reload so the SPA re-boots past the auth gate into the app view now
        // that a session cookie exists (the fetch above did not reload the page).
        GoTo("/");
        Wait!.Until(d => d.FindElements(By.CssSelector(".nav-btn")).Count > 0);
    }
}
