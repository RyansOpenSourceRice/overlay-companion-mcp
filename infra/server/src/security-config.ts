/**
 * Security Configuration for Overlay Companion MCP
 *
 * CRITICAL: This file contains SSRF protection settings.
 * Modify with extreme caution and always test changes thoroughly.
 */

export interface SecurityLimits {
  connectionTimeout: number;
  maxResponseSize: number;
  maxRedirects: number;
  rateLimitWindow: number;
  rateLimitMax: number;
}

export interface PortRestrictions {
  min: number;
  max: number;
  blocked?: number[];
}

export interface SecurityLogging {
  logConnectionAttempts: boolean;
  logBlockedHosts: boolean;
  logSecurityEvents: boolean;
}

export interface KasmVncTarget {
  host: string;
  port: number;
  ssl: boolean;
  username?: string;
  password?: string;
}

export interface SecurityConfig {
  allowedHostPatterns: RegExp[];
  blockedHostPatterns: RegExp[];
  limits: SecurityLimits;
  allowedProtocols: string[];
  portRestrictions: PortRestrictions;
  logging: SecurityLogging;
  kasmVncAllowlist?: Record<string, KasmVncTarget>;
}

/**
 * Operator-defined KasmVNC allowlist. KasmVNC connections are proxied by the
 * management server, so the targets must be an explicit allowlist (never a raw
 * user-supplied host:port — that would be SSRF). Populated from the
 * `KASMVNC_ALLOWLIST_JSON` env var as a JSON map:
 *   { "sample": { "host": "localhost", "port": 6901, "ssl": true, "username": "kasm_user", "password": "vncpassword" } }
 * The optional `username`/`password` are applied as HTTP Basic auth when the
 * management server proxies the target's web UI and WebSocket, so a browser
 * can reach the desktop without being challenged for KasmVNC credentials.
 */
function loadKasmVncAllowlist(): Record<string, KasmVncTarget> {
  const raw = process.env.KASMVNC_ALLOWLIST_JSON;
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, KasmVncTarget>;
    const out: Record<string, KasmVncTarget> = {};
    for (const [id, t] of Object.entries(parsed)) {
      if (typeof t?.host !== 'string' || !Number.isInteger(t?.port)) continue;
      out[id] = {
        host: t.host,
        port: t.port,
        ssl: Boolean(t.ssl),
        username: typeof t.username === 'string' ? t.username : undefined,
        password: typeof t.password === 'string' ? t.password : undefined,
      };
    }
    return out;
  } catch {
    console.warn('🔒 SECURITY: KASMVNC_ALLOWLIST_JSON is not valid JSON; no KasmVNC targets loaded.');
    return {};
  }
}

export const securityConfig: SecurityConfig = {
  // SECURITY: Allowed host patterns for connection testing
  // Add your specific development/production hosts here
  allowedHostPatterns: [
    // Development environments
    /^192\.168\.1\.\d{1,3}$/,        // Local network range
    /^10\.0\.0\.\d{1,3}$/,           // Docker network range
    /^172\.17\.0\.\d{1,3}$/,         // Docker bridge network

    // Production environments (uncomment and modify as needed)
    // /^prod-kasmvnc\.example\.com$/,  // Production KasmVNC server
    // /^staging-vm\.example\.com$/,    // Staging environment

    // Cloud environments (be very specific)
    // /^ec2-\d+-\d+-\d+-\d+\.compute-1\.amazonaws\.com$/,  // AWS EC2 instances
    // /^vm-\w+\.cloudapp\.azure\.com$/,                     // Azure VMs
  ],

  // SECURITY: Blocked host patterns (DO NOT MODIFY unless you understand SSRF risks)
  blockedHostPatterns: [
    // Localhost variations
    /^localhost$/i,
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,

    // Private network ranges (RFC 1918)
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,          // 10.0.0.0/8
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/, // 172.16.0.0/12
    /^192\.168\.\d{1,3}\.\d{1,3}$/,             // 192.168.0.0/16

    // Link-local and special use
    /^169\.254\.\d{1,3}\.\d{1,3}$/,             // Link-local (AWS metadata)
    /^224\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,         // Multicast
    /^0\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,           // Invalid range
    /^255\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,         // Broadcast

    // IPv6 localhost and link-local
    /^::1$/,                                     // IPv6 localhost
    /^fe80::/i,                                  // IPv6 link-local
    /^fc00::/i,                                  // IPv6 unique local
    /^fd00::/i,                                  // IPv6 unique local

    // Cloud metadata endpoints (CRITICAL - DO NOT REMOVE)
    /^169\.254\.169\.254$/,                      // AWS/GCP metadata
    /^metadata\.google\.internal$/i,             // GCP metadata
    /^metadata\.azure\.com$/i,                   // Azure metadata
  ],

  // SECURITY: Connection limits and timeouts
  limits: {
    connectionTimeout: 5000,        // 5 seconds max per connection test
    maxResponseSize: 1024,          // 1KB max response size for health checks
    maxRedirects: 0,                // No redirects allowed (prevents SSRF)
    rateLimitWindow: 60 * 1000,     // 1 minute rate limit window
    rateLimitMax: 10,               // Max 10 connection tests per IP per minute
  },

  // SECURITY: Allowed protocols
  allowedProtocols: ['kasmvnc', 'vnc', 'rdp'],

  // SECURITY: Port restrictions
  portRestrictions: {
    min: 1,
    max: 65535,
    // Common dangerous ports to block (optional - uncomment if needed)
    // blocked: [22, 23, 25, 53, 80, 110, 143, 443, 993, 995]
  },

  // SECURITY: Logging configuration
  logging: {
    logConnectionAttempts: true,
    logBlockedHosts: true,
    logSecurityEvents: true,
  },

  // SECURITY: Operator-defined KasmVNC target allowlist (KASMVNC_ALLOWLIST_JSON).
  kasmVncAllowlist: loadKasmVncAllowlist(),
};

export default securityConfig;
