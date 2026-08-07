using System.Net.Http.Json;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace OverlayCompanion.Tests.Playwright;

/// <summary>
/// Assembly-level bootstrap. Registers the shared admin user BEFORE any test
/// runs so the admin role (granted to the first registered user) lands on the
/// account the admin-gated tests rely on. It also performs ONE login and
/// captures the session cookie, which tests inject into their FireFox sessions
/// — avoiding a flood of login requests that would exhaust the login rate
/// limit during a full-suite run.
/// </summary>
[TestClass]
public class AssemblyInit
{
    public const string AdminUsername = "admin-playwright-e2e";
    public const string AdminPassword = "AdminPwE2e!2026"; // pragma: allowlist secret (test fixture, not a real credential)

    public static string SessionCookieValue { get; private set; } = "";

    [AssemblyInitialize]
    public static void Init(TestContext context)
    {
        var target = PlaywrightWebTestBase.BaseUrl.TrimEnd('/');
        using var hc = new HttpClient(new SessionCookieHandler());
        var reg = hc.PostAsJsonAsync($"{target}/auth/local/register",
            new { username = AdminUsername, password = AdminPassword }).GetAwaiter().GetResult();
        if ((int)reg.StatusCode != 200)
        {
            _ = hc.PostAsJsonAsync($"{target}/auth/local/login",
                new { username = AdminUsername, password = AdminPassword }).GetAwaiter().GetResult();
        }
        _ = hc.PostAsJsonAsync($"{target}/auth/local/login",
            new { username = AdminUsername, password = AdminPassword }).GetAwaiter().GetResult();
        SessionCookieValue = SessionCookieHandler.LastSessionCookie;
    }
}

/// <summary>Captures the oc_session cookie from Set-Cookie for injection into browser contexts.</summary>
internal sealed class SessionCookieHandler : HttpClientHandler
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
