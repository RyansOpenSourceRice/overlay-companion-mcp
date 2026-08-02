using System.Net.Http.Json;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace OverlayCompanion.Tests.Appium;

/// <summary>
/// Assembly-level bootstrap. Registers the shared admin user BEFORE any test
/// runs so that, in a fresh test database, the admin role (granted to the first
/// registered user) lands on the account the admin-gated tests rely on. It also
/// performs ONE login and captures the resulting session cookie, which tests
/// inject into their browser sessions — avoiding a flood of login requests that
/// would exhaust the server's login rate limit during a full-suite run.
/// </summary>
[TestClass]
public class AssemblyInit
{
    public const string AdminUsername = "admin-tls-e2e";
    public const string AdminPassword = "AdminTlsE2ePass!2026"; // pragma: allowlist secret (test fixture, not a real credential)

    // Captured once from the login response Set-Cookie, then shared with tests
    // that need an authenticated admin session without extra login calls.
    public static string SessionCookieValue { get; private set; } = "";

    [AssemblyInitialize]
    public static void Init(TestContext context)
    {
        var target = AppiumWebTestBase.BaseUrl.TrimEnd('/');
        using var hc = new HttpClient(new SeleniumCookieHandler());
        var reg = hc.PostAsJsonAsync($"{target}/auth/local/register",
            new { username = AdminUsername, password = AdminPassword }).GetAwaiter().GetResult();
        if ((int)reg.StatusCode != 200)
        {
            _ = hc.PostAsJsonAsync($"{target}/auth/local/login",
                new { username = AdminUsername, password = AdminPassword }).GetAwaiter().GetResult();
        }
        // Ensure an authenticated session by logging in explicitly (idempotent).
        _ = hc.PostAsJsonAsync($"{target}/auth/local/login",
            new { username = AdminUsername, password = AdminPassword }).GetAwaiter().GetResult();
        SessionCookieValue = SeleniumCookieHandler.LastSessionCookie;
    }
}

/// <summary>
/// Captures the session cookie (oc_session) from Set-Cookie so tests can inject
/// it into a browser session without more login requests.
/// </summary>
internal sealed class SeleniumCookieHandler : HttpClientHandler
{
    public static string LastSessionCookie { get; set; } = "";

    protected override System.Threading.Tasks.Task<HttpResponseMessage> SendAsync(
        System.Net.Http.HttpRequestMessage request,
        System.Threading.CancellationToken cancellationToken)
    {
        var respTask = base.SendAsync(request, cancellationToken).ContinueWith(t =>
        {
            var resp = t.Result;
            if (resp.Headers.TryGetValues("Set-Cookie", out var cookies))
            {
                foreach (var c in cookies)
                {
                    // e.g. oc_session=<value>; Max-Age=...; HttpOnly; ...
                    if (c.StartsWith("oc_session=", System.StringComparison.OrdinalIgnoreCase))
                    {
                        LastSessionCookie = c.Split(';')[0].Substring("oc_session=".Length);
                    }
                }
            }
            return resp;
        });
        return respTask;
    }
}
