/**
 * Security Configuration for Overlay Companion MCP
 *
 * CRITICAL: This file contains SSRF protection settings.
 * Modify with extreme caution and always test changes thoroughly.
 */

module.exports = {
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
  }
};
