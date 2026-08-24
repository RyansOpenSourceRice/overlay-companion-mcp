/**
 * Origin/CSRF hostname normalization.
 *
 * The origin middleware compares the request `Host` against the `Origin` header
 * but must ignore the port, IPv6 brackets, scheme, and a trailing FQDN dot —
 * otherwise localhost:8080 vs localhost never match and every state-changing
 * browser request is rejected as cross-origin.
 */

export function bareHostname(authority: string): string {
  let s = String(authority || '').trim();
  // Defensive: drop an optional scheme prefix (e.g. "https://") if present.
  const scheme = s.indexOf('://');
  if (scheme >= 0) s = s.slice(scheme + 3);
  if (s.startsWith('[')) {
    // Bracketed IPv6 literal (e.g. "[::1]:8080" or "[::1]"): strip the
    // brackets and any trailing port.
    const close = s.indexOf(']');
    s = close >= 0 ? s.slice(1, close) : s.slice(1);
  } else {
    // Hostname (possibly "host:port"): drop the port if present.
    const colon = s.indexOf(':');
    if (colon >= 0) s = s.slice(0, colon);
  }
  // Normalize an FQDN trailing dot (e.g. "example.com.").
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}