using Microsoft.Playwright;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace OverlayCompanion.Tests.Playwright;

/// <summary>
/// End-to-end tests for saved VM connections (Playwright + FireFox): Add
/// Connection modal, card render, reload + persistence (server + SurrealDB),
/// edit, delete, and the Test Connection button. Requires a running server
/// with LOCAL_AUTH_ENABLED=true, SIGNUP_ALLOWED=true, and reachable SurrealDB.
/// </summary>
[TestClass]
public class ConnectionFlowTests : PlaywrightWebTestBase
{
    private const string TestUsername = "conn-pw-admin";
    private const string TestPassword = "TestPassphrase!2026"; // pragma: allowlist secret (test fixture)
    private const string ConnPassword = "VncPass123!"; // pragma: allowlist secret (test fixture)

    private static string UniqueConnName(string prefix) => $"{prefix} {System.DateTime.Now.Ticks}";

    [TestInitialize]
    public async Task TestInit()
    {
        await StartDriverAsync();
    }

    [TestMethod]
    public async Task AddConnection_RendersCard_AndPersistsAcrossReload()
    {
        var connName = UniqueConnName("VM");
        await RegisterOrLoginAsync(TestUsername, TestPassword);
        await GoToAsync("/");
        await GoToConnectionsPageAsync();
        await OpenAddModalAsync();
        await FillConnectionFormAsync(connName, "127.0.0.1", "5900", "vnc", ConnPassword);
        await SubmitConnectionFormAsync();

        var card = await WaitForConnectionCardAsync(connName);
        Assert.IsNotNull(card, $"Connection card for '{connName}' should appear after saving.");

        // Reload: connection must persist (server-backed).
        await GoToAsync("/");
        await GoToConnectionsPageAsync();
        var cardAfterReload = await WaitForConnectionCardAsync(connName);
        Assert.IsNotNull(cardAfterReload, "Connection should persist across a page reload (server-backed).");
    }

    [TestMethod]
    public async Task EditConnection_UpdatesTheCard()
    {
        var connName = UniqueConnName("VM");
        await RegisterOrLoginAsync(TestUsername, TestPassword);
        await GoToAsync("/");
        await GoToConnectionsPageAsync();
        await OpenAddModalAsync();
        await FillConnectionFormAsync(connName, "127.0.0.1", "5900", "vnc", ConnPassword);
        await SubmitConnectionFormAsync();
        await WaitForConnectionCardAsync(connName);

        await ClickConnectionButtonAsync(connName, ".btn-secondary");

        var renamed = connName + " (edited)";
        await Page!.Locator("#connection-name").WaitForAsync(new LocatorWaitForOptions { State = WaitForSelectorState.Visible });
        await Page.EvaluateAsync(
            "renamed => { const i = document.getElementById('connection-name'); i.value = renamed; i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new Event('change',{bubbles:true})); }",
            renamed);
        await SubmitConnectionFormAsync();

        var renamedCard = await WaitForConnectionCardAsync(renamed);
        Assert.IsNotNull(renamedCard, $"Connection card should show the updated name '{renamed}'.");
    }

    [TestMethod]
    public async Task DeleteConnection_RemovesCard()
    {
        var connName = UniqueConnName("VM");
        await RegisterOrLoginAsync(TestUsername, TestPassword);
        await GoToAsync("/");
        await GoToConnectionsPageAsync();
        await OpenAddModalAsync();
        await FillConnectionFormAsync(connName, "127.0.0.1", "5900", "vnc", ConnPassword);
        await SubmitConnectionFormAsync();
        await WaitForConnectionCardAsync(connName);

        // Delete; accept the native confirm dialog if one appears.
        var card = await WaitForConnectionCardAsync(connName);
        var deleteBtn = card!.Locator(".btn-danger").First;
        await deleteBtn.ClickAsync();
        Page.Dialog += (_, e) => _ = e.AcceptAsync();
        await Page.WaitForTimeoutAsync(300);

        Assert.IsTrue(await WaitUntilGoneAsync(connName), $"Connection card for '{connName}' should be removed after delete.");
    }

    [TestMethod]
    public async Task ConnectionCard_HasTestButton()
    {
        var connName = UniqueConnName("VM");
        await RegisterOrLoginAsync(TestUsername, TestPassword);
        await GoToAsync("/");
        await GoToConnectionsPageAsync();
        await OpenAddModalAsync();
        await FillConnectionFormAsync(connName, "127.0.0.1", "5900", "vnc", ConnPassword);
        await SubmitConnectionFormAsync();
        await WaitForConnectionCardAsync(connName);

        await OpenAddModalAsync();
        await Page!.Locator("#test-connection-btn").First.WaitForAsync(
            new LocatorWaitForOptions { State = WaitForSelectorState.Visible });
        Assert.IsTrue(await Page.Locator("#test-connection-btn").IsEnabledAsync(),
            "Test Connection button should be enabled.");
    }

    // ---- UI helpers -------------------------------------------------------

    private async Task GoToConnectionsPageAsync()
    {
        await Page!.Locator(".nav-btn[data-page='connections']").WaitForAsync();
        await Page.Locator(".nav-btn[data-page='connections']").ClickAsync();
        await Page.Locator("#connections-page").WaitForAsync();
    }

    private async Task OpenAddModalAsync()
    {
        await Page!.Locator("#add-connection-btn").WaitForAsync();
        await Page.Locator("#add-connection-btn").ClickAsync();
        await Page.Locator("#connection-form").WaitForAsync();
    }

    private async Task FillConnectionFormAsync(string name, string host, string port, string protocol, string password)
    {
        var nameInput = Page!.Locator("#connection-name");
        await nameInput.WaitForAsync();
        await nameInput.FillAsync(name);
        await Page.Locator("#connection-host").FillAsync(host);
        await Page.Locator("#connection-port").FillAsync(port);
        await Page.Locator("#connection-password").FillAsync(password);
        // Select the protocol via the native select + change event.
        await Page.EvaluateAsync(
            "args => { const s = document.getElementById('connection-protocol'); if (s) { s.value = args[0]; s.dispatchEvent(new Event('change',{bubbles:true})); } }",
            new[] { protocol });
    }

    private async Task SubmitConnectionFormAsync()
    {
        // Forms in this SPA use onSubmit; trigger it via the submit handler.
        await Page!.Locator("#connection-form").WaitForAsync();
        await Page.EvaluateAsync(
            "() => { const f = document.getElementById('connection-form'); if (f && f.requestSubmit){ f.requestSubmit(); } else if (f){ f.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); } }");
    }

    private async Task<ILocator?> WaitForConnectionCardAsync(string name)
    {
        var cards = Page!.Locator(".connection-card");
        var count = await cards.CountAsync();
        for (int i = 0; i < count; i++)
        {
            var card = cards.Nth(i);
            var text = await card.InnerTextAsync();
            if (text.Contains(name, StringComparison.Ordinal))
            {
                return card;
            }
        }
        return null;
    }

    private async Task<bool> WaitUntilGoneAsync(string name)
    {
        try
        {
            await Page!.Locator($".connection-card:has-text(\"{name}\")")
                .WaitForAsync(new LocatorWaitForOptions { State = WaitForSelectorState.Detached });
            return true;
        }
        catch (TimeoutException)
        {
            return false;
        }
    }

    private async Task ClickConnectionButtonAsync(string name, string buttonClass)
    {
        await Page!.Locator($".connection-card:has-text(\"{name}\") {buttonClass}").First.ClickAsync();
    }
}
