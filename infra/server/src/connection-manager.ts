/**
 * Connection Manager for Overlay Companion MCP
 *
 * Handles secure connection testing and proxy functionality
 * for various remote desktop protocols (KasmVNC, VNC, RDP)
 *
 * SECURITY: Implements SSRF protection with host validation
 */

import net from 'net';
import http from 'http';
import https from 'https';
import securityConfig, { SecurityConfig, KasmVncTarget } from './security-config.js';

export type Protocol = 'kasmvnc' | 'vnc' | 'rdp';

export interface ConnectionConfig {
  host?: string;
  port?: number;
  protocol?: string;
  ssl?: boolean;
  targetId?: string;
}

export interface TestResult {
  success: boolean;
  protocol: string;
  host?: string;
  port?: number;
  ssl?: boolean;
  statusCode?: number;
  message?: string;
  error?: string;
}

export interface ValidationResponse {
  valid: boolean;
  errors: string[];
}

export interface ProxyEntry extends ConnectionConfig {
  createdAt: Date;
  lastUsed: Date;
}

export interface ConnectionStats {
  activeProxies: number;
  connections: Array<{
    protocol?: string;
    host?: string;
    port?: number;
    createdAt: Date;
    lastUsed: Date;
  }>;
}

export interface ProtocolDefaults {
  port?: number;
  ssl?: boolean;
  description?: string;
}

export class ConnectionManager {
  private activeConnections: Map<string, ProxyEntry>;
  private kasmVncAllowlist: Record<string, KasmVncTarget>;
  private allowedHostPatterns: RegExp[];
  private blockedHostPatterns: RegExp[];
  private limits: SecurityConfig['limits'];
  private allowedProtocols: string[];
  private portRestrictions: SecurityConfig['portRestrictions'];
  private logging: SecurityConfig['logging'];

  constructor() {
    this.activeConnections = new Map();

    // SECURITY: Load explicit KasmVNC allowlist
    // Example format: { kasm1: { host: 'kasm1.example.com', port: 6901, ssl: true }, ... }
    this.kasmVncAllowlist = securityConfig.kasmVncAllowlist || {};

    // SECURITY: Load security configuration (legacy patterns, still used for other protocols)
    this.allowedHostPatterns = securityConfig.allowedHostPatterns;
    this.blockedHostPatterns = securityConfig.blockedHostPatterns;
    this.limits = securityConfig.limits;
    this.allowedProtocols = securityConfig.allowedProtocols;
    this.portRestrictions = securityConfig.portRestrictions;
    this.logging = securityConfig.logging;

    console.log('🔒 SECURITY: Connection manager initialized with explicit KasmVNC allowlist for SSRF protection');
    console.log(`🔒 SECURITY: ${Object.keys(this.kasmVncAllowlist).length} allowed KasmVNC targets configured`);
    console.log(`🔒 SECURITY: ${this.allowedHostPatterns.length} allowed host patterns configured`);
    console.log(`🔒 SECURITY: ${this.blockedHostPatterns.length} blocked host patterns configured`);
  }

  /**
   * SECURITY: Validate host to prevent SSRF attacks
   * @param host - Host to validate
   * @returns True if host is allowed
   */
  validateHost(host: string | undefined | null): boolean {
    if (!host || typeof host !== 'string') {
      return false;
    }

    // Normalize host (remove protocol, port, path)
    let normalizedHost = host.toLowerCase().trim();

    // Remove protocol if present
    normalizedHost = normalizedHost.replace(/^https?:\/\//, '');

    // Remove port if present
    normalizedHost = normalizedHost.split(':')[0];

    // Remove path if present
    normalizedHost = normalizedHost.split('/')[0];

    // Check against blocked patterns first (security priority)
    for (const pattern of this.blockedHostPatterns) {
      if (pattern.test(normalizedHost)) {
        if (this.logging.logBlockedHosts) {
          console.warn(`🚫 SECURITY: Blocked host access attempt: ${host} (matched pattern: ${pattern})`);
        }
        return false;
      }
    }

    // Check against allowed patterns
    for (const pattern of this.allowedHostPatterns) {
      if (pattern.test(normalizedHost)) {
        return true;
      }
    }

    // If no explicit allow pattern matches, check if it's a valid external host
    // Only allow well-formed hostnames/IPs that are not in private ranges
    const isValidExternalHost = this.isValidExternalHost(normalizedHost);
    if (!isValidExternalHost) {
      console.warn(`🚫 SECURITY: Invalid or private host rejected: ${host}`);
    }

    return isValidExternalHost;
  }

  /**
   * SECURITY: Check if host is a valid external host (not private/internal)
   * @param host - Normalized host
   * @returns True if valid external host
   */
  isValidExternalHost(host: string): boolean {
    // Basic hostname/IP validation - simplified for security
    const hostnameRegex = /^[a-zA-Z0-9.-]+$/; // Simple character validation
    const ipRegex = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/; // Simple IP format

    if (!hostnameRegex.test(host) && !ipRegex.test(host)) {
      return false;
    }

    // If it's an IP, ensure it's not in private ranges (already checked in blockedHostPatterns)
    if (ipRegex.test(host)) {
      const parts = host.split('.').map(Number);

      // Additional IP validation
      if (parts.some((part) => part < 0 || part > 255)) {
        return false;
      }

      // Block additional dangerous ranges
      if (parts[0] === 0 || parts[0] === 255) {
        return false;
      }
    }

    return true;
  }

  /**
   * SECURITY: Sanitize and normalize host for safe network operations
   * @param host - Host to sanitize
   * @returns Sanitized host or null if invalid
   */
  sanitizeHost(host: string | undefined | null): string | null {
    if (!host || typeof host !== 'string') {
      return null;
    }

    // Normalize host (remove protocol, port, path)
    let sanitizedHost = host.toLowerCase().trim();

    // Remove protocol if present
    sanitizedHost = sanitizedHost.replace(/^https?:\/\//, '');

    // Remove port if present
    sanitizedHost = sanitizedHost.split(':')[0];

    // Remove path if present
    sanitizedHost = sanitizedHost.split('/')[0];

    // Additional sanitization - only allow alphanumeric, dots, and hyphens
    if (!/^[a-zA-Z0-9.-]+$/.test(sanitizedHost)) {
      return null;
    }

    // Ensure it's not empty after sanitization
    if (!sanitizedHost || sanitizedHost.length === 0) {
      return null;
    }

    return sanitizedHost;
  }

  /**
   * Test connection to a remote desktop server
   * @param connection - Connection configuration
   * @returns Test result
   */
  async testConnection(connection: ConnectionConfig): Promise<TestResult> {
    const { protocol } = connection;

    try {
      switch (protocol) {
        case 'kasmvnc': {
          // SECURITY: Only accept connection.targetId and map from allowlist
          const { targetId } = connection;
          if (!targetId || typeof targetId !== 'string' || !(targetId in this.kasmVncAllowlist)) {
            throw new Error('KasmVNC target not allowed');
          }
          const target = this.kasmVncAllowlist[targetId];
          // Optionally: Validate further (host/port non-falsy, correct types)
          return await this.testKasmVNC(target.host, target.port, !!target.ssl);
        }
        case 'vnc': {
          // Legacy: Still allow host/port, but require host pattern validation
          const { host, port } = connection;
          if (!this.validateHost(host)) {
            throw new Error('Host not allowed - potential security risk detected');
          }
          if (!port || port < 1 || port > 65535) {
            throw new Error('Invalid port number');
          }
          return await this.testVNC(host as string, port);
        }
        case 'rdp': {
          const { host, port } = connection;
          if (!this.validateHost(host)) {
            throw new Error('Host not allowed - potential security risk detected');
          }
          if (!port || port < 1 || port > 65535) {
            throw new Error('Invalid port number');
          }
          return await this.testRDP(host as string, port);
        }
        default:
          throw new Error(`Unsupported protocol: ${protocol}`);
      }
    } catch (error) {
      // SECURITY: Sanitize user-controlled values for logging to prevent format string attacks
      const sanitizedHost = String(connection.host || '(unknown)').replace(/[^\w.-]/g, '');
      const sanitizedPort = parseInt(String(connection.port)) || 0;
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('🚫 Connection test failed for %s:%s: %s', sanitizedHost, sanitizedPort, errMsg);
      return {
        success: false,
        error: errMsg,
        protocol: protocol || 'unknown',
        host: connection.host,
        port: connection.port,
      };
    }
  }

  /**
   * Resolve an operator-defined KasmVNC target by id, or null if not allowed.
   * This is the single gate for proxying KasmVNC traffic — never a raw host.
   */
  getKasmVncTarget(targetId: string | null | undefined): KasmVncTarget | null {
    if (!targetId || typeof targetId !== 'string') return null;
    const target = this.kasmVncAllowlist[targetId];
    return target && typeof target.host === 'string' && Number.isInteger(target.port) ? target : null;
  }

  /** Snapshot of the operator-defined KasmVNC allowlist (id -> target). */
  getKasmVncAllowlist(): Record<string, KasmVncTarget> {
    return { ...this.kasmVncAllowlist };
  }

  /**
   * Test KasmVNC connection with SSRF protection
   * SECURITY: Uses POST with fixed URL to avoid user-controlled URL construction
   */
  async testKasmVNC(host: string, port: number, ssl = false): Promise<TestResult> {
    // SECURITY: Re-validate host immediately before network operation
    if (!this.validateHost(host)) {
      throw new Error('Host validation failed - potential SSRF attack blocked');
    }

    // SECURITY: Create validated host variable to prevent SSRF
    const validatedHost = this.sanitizeHost(host);
    if (!validatedHost) {
      throw new Error('Host sanitization failed - invalid host format');
    }

    return new Promise((resolve) => {
      const client = ssl ? https : http;
      const timeout = 5000; // SECURITY: Short timeout to prevent resource exhaustion

      // The KasmVNC target serves its web UI on this port (typically TLS
      // self-signed). A reachability probe is the "Test Connection" signal:
      // any HTTP response means the desktop is up (a 401 auth challenge is
      // still "reachable"). There is no separate /api/health endpoint.
      const options: https.RequestOptions = {
        hostname: validatedHost,
        port: port,
        path: '/', // Fixed path - no user input
        method: 'GET',
        timeout,
        headers: {
          'User-Agent': 'OverlayCompanion-HealthCheck/1.0',
          Accept: '*/*',
        },
        // Self-signed TLS certs are the norm for KasmVNC desktops; the probe
        // carries no sensitive data so cert verification is disabled.
        rejectUnauthorized: false,
        // SECURITY: Prevent following redirects that could lead to SSRF
        // (Node's http types omit maxRedirects, but it is honored at runtime)
        ...({ maxRedirects: 0 } as object),
      };

      // SECURITY: POST request with validated host in options, not URL
      const req = client.request(options, (res) => {
        // SECURITY: Limit response size to prevent memory exhaustion
        let data = '';
        const maxResponseSize = 1024; // 1KB limit for health check

        res.on('data', (chunk: Buffer | string) => {
          data += chunk;
          if (data.length > maxResponseSize) {
            req.destroy();
            resolve({
              success: false,
              protocol: 'kasmvnc',
              host,
              port,
              ssl,
              error: 'Response too large',
            });
          }
        });

        res.on('end', () => {
          const reachable = res.statusCode !== undefined;
          resolve({
            success: reachable,
            protocol: 'kasmvnc',
            host,
            port,
            ssl,
            statusCode: res.statusCode,
            message: reachable ? 'KasmVNC server is reachable' : 'KasmVNC server did not respond',
          });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          success: false,
          protocol: 'kasmvnc',
          host,
          port,
          ssl,
          error: 'Connection timeout',
        });
      });

      req.on('error', (error: Error) => {
        resolve({
          success: false,
          protocol: 'kasmvnc',
          host,
          port,
          ssl,
          error: error.message,
        });
      });

      // End the request (GET has no body)
      req.end();
    });
  }

  /**
   * Test VNC connection with SSRF protection
   * SECURITY: Host validation performed before network operations
   */
  async testVNC(host: string, port: number): Promise<TestResult> {
    // SECURITY: Re-validate host immediately before network operation
    if (!this.validateHost(host)) {
      throw new Error('Host validation failed - potential SSRF attack blocked');
    }

    // SECURITY: Create validated host variable to prevent SSRF
    const validatedHost = this.sanitizeHost(host);
    if (!validatedHost) {
      throw new Error('Host sanitization failed - invalid host format');
    }

    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timeout = 5000; // SECURITY: Short timeout to prevent resource exhaustion

      socket.setTimeout(timeout);

      // SECURITY: Set socket options to prevent abuse
      socket.setNoDelay(true);
      socket.setKeepAlive(false);

      // SECURITY: Use sanitized host to prevent SSRF attacks
      socket.connect(port, validatedHost, () => {
        socket.destroy();
        resolve({
          success: true,
          protocol: 'vnc',
          host,
          port,
          message: 'VNC server is accessible',
        });
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve({
          success: false,
          protocol: 'vnc',
          host,
          port,
          error: 'Connection timeout',
        });
      });

      socket.on('error', (error: Error) => {
        socket.destroy();
        resolve({
          success: false,
          protocol: 'vnc',
          host,
          port,
          error: error.message,
        });
      });

      // SECURITY: Force cleanup after timeout
      setTimeout(() => {
        if (!socket.destroyed) {
          socket.destroy();
        }
      }, timeout + 1000);
    });
  }

  /**
   * Test RDP connection with SSRF protection
   * SECURITY: Host validation performed before network operations
   */
  async testRDP(host: string, port: number): Promise<TestResult> {
    // SECURITY: Re-validate host immediately before network operation
    if (!this.validateHost(host)) {
      throw new Error('Host validation failed - potential SSRF attack blocked');
    }

    // SECURITY: Create validated host variable to prevent SSRF
    const validatedHost = this.sanitizeHost(host);
    if (!validatedHost) {
      throw new Error('Host sanitization failed - invalid host format');
    }

    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timeout = 5000; // SECURITY: Short timeout to prevent resource exhaustion

      socket.setTimeout(timeout);

      // SECURITY: Set socket options to prevent abuse
      socket.setNoDelay(true);
      socket.setKeepAlive(false);

      // SECURITY: Use sanitized host to prevent SSRF attacks
      socket.connect(port, validatedHost, () => {
        socket.destroy();
        resolve({
          success: true,
          protocol: 'rdp',
          host,
          port,
          message: 'RDP server is accessible',
        });
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve({
          success: false,
          protocol: 'rdp',
          host,
          port,
          error: 'Connection timeout',
        });
      });

      socket.on('error', (error: Error) => {
        socket.destroy();
        resolve({
          success: false,
          protocol: 'rdp',
          host,
          port,
          error: error.message,
        });
      });

      // SECURITY: Force cleanup after timeout
      setTimeout(() => {
        if (!socket.destroyed) {
          socket.destroy();
        }
      }, timeout + 1000);
    });
  }

  /**
   * Create a proxy URL for non-KasmVNC connections
   * This allows the web UI to connect to standard VNC/RDP servers
   * through a WebSocket proxy
   */
  createProxyUrl(connection: ConnectionConfig): string {
    const { host, port, protocol } = connection;
    // Note: ssl parameter available but not used in current implementation
    const proxyId = `${protocol}-${host}-${port}-${Date.now()}`;

    this.activeConnections.set(proxyId, {
      ...connection,
      createdAt: new Date(),
      lastUsed: new Date(),
    });

    // Clean up old connections (older than 1 hour)
    this.cleanupOldConnections();

    return `/proxy/${proxyId}`;
  }

  /**
   * Get connection details for a proxy ID
   */
  getProxyConnection(proxyId: string): ProxyEntry | null {
    const connection = this.activeConnections.get(proxyId);
    if (connection) {
      connection.lastUsed = new Date();
      return connection;
    }
    return null;
  }

  /**
   * Clean up old proxy connections
   */
  cleanupOldConnections(): void {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    for (const [proxyId, connection] of this.activeConnections.entries()) {
      if (connection.lastUsed < oneHourAgo) {
        this.activeConnections.delete(proxyId);
      }
    }
  }

  /**
   * Get statistics about active connections
   */
  getStats(): ConnectionStats {
    return {
      activeProxies: this.activeConnections.size,
      connections: Array.from(this.activeConnections.values()).map((conn) => ({
        protocol: conn.protocol,
        host: conn.host,
        port: conn.port,
        createdAt: conn.createdAt,
        lastUsed: conn.lastUsed,
      })),
    };
  }

  /**
   * Validate connection configuration with security checks
   */
  validateConnection(connection: ConnectionConfig): ValidationResponse {
    const errors: string[] = [];

    // SECURITY: Basic input validation
    if (!connection.host || typeof connection.host !== 'string') {
      errors.push('Host is required and must be a string');
    } else {
      // SECURITY: Validate host against SSRF patterns
      if (!this.validateHost(connection.host)) {
        errors.push('Host not allowed - potential security risk detected');
      }
    }

    // SECURITY: Port validation with restrictions
    if (!connection.port || !Number.isInteger(connection.port)) {
      errors.push('Port must be a valid integer');
    } else if (connection.port < this.portRestrictions.min || connection.port > this.portRestrictions.max) {
      errors.push(`Port must be between ${this.portRestrictions.min} and ${this.portRestrictions.max}`);
    }

    // SECURITY: Protocol validation
    if (!connection.protocol || !this.allowedProtocols.includes(connection.protocol)) {
      errors.push(`Protocol must be one of: ${this.allowedProtocols.join(', ')}`);
    }

    // Protocol-specific validation (warnings, not errors)
    if (connection.protocol === 'rdp' && connection.port === 6901) {
      console.warn('⚠️  RDP typically uses port 3389, not 6901');
    }

    if (connection.protocol === 'vnc' && connection.port === 3389) {
      console.warn('⚠️  VNC typically uses ports 5900-5999, not 3389');
    }

    const isValid = errors.length === 0;

    if (this.logging.logSecurityEvents && !isValid) {
      console.warn('🚫 SECURITY: Connection validation failed:', errors);
    }

    return {
      valid: isValid,
      errors,
    };
  }

  /**
   * Get recommended settings for a protocol
   */
  getProtocolDefaults(protocol: string): ProtocolDefaults {
    const defaults: Record<string, ProtocolDefaults> = {
      kasmvnc: {
        port: 6901,
        ssl: false,
        description: 'KasmVNC provides web-native remote desktop with multi-monitor support',
      },
      vnc: {
        port: 5901,
        ssl: false,
        description: 'Standard VNC protocol for remote desktop access',
      },
      rdp: {
        port: 3389,
        ssl: false,
        description: 'Microsoft Remote Desktop Protocol',
      },
    };

    return defaults[protocol] || {};
  }
}

export default ConnectionManager;
